#!/usr/bin/env bash
#
# parse-checklist.sh — parse the user-edited checklist.md and emit a JSON
# array of items on stdout. Surfaces parse errors with line numbers on stderr.
#
# Usage:
#   parse-checklist.sh <path-to-checklist.md>
#
# Output on stdout: JSON array, one object per item.
#   [
#     {
#       "id": 1,
#       "title": "Polish the user avatar fallback",
#       "action": "fix",
#       "files": ["app/views/users/_avatar.html.erb"],
#       "surface": "view",
#       "status": "manageable",
#       "notes": "Free text from the notes block."
#     }
#   ]
#
# On parse error, prints error lines to stderr and exits non-zero. Each
# error has the form: `ERROR: line N: <message>`.
#
# Checklist item format (one repeating block per item):
#
#   ## Item 1 — Polish the user avatar fallback
#   - action: fix
#   - files: app/views/users/_avatar.html.erb
#   - surface: view
#   - status: manageable
#   - notes: |
#     Free text describing what to fix.
#     May span multiple lines until the next ## header.
#
# Allowed action values: keep, skip, fix, note, stacked, replan
# Allowed status values: manageable, oversized
# Pinning rule: oversized items must have action=stacked (classifier-enforced).
# User elevation: action=stacked is also accepted on manageable items, treated
# as user judgment that the classifier missed an oversized item. SKILL.md 4.9
# rewrites the per-item stacked seed with `user_judgment: yes`.
# Users cannot set `action: fix` (or any non-stacked action) on an oversized
# item — parse rejects.

set -u

CHECKLIST_PATH="${1:-}"
if [ -z "$CHECKLIST_PATH" ] || [ ! -f "$CHECKLIST_PATH" ]; then
  echo "ERROR: usage: parse-checklist.sh <path-to-checklist.md>" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is required but not installed" >&2
  exit 1
fi

ALLOWED_ACTIONS="keep skip fix note stacked replan"
ALLOWED_STATUSES="manageable oversized"

ERRORS=0
ITEMS_JSON="[]"

current_id=""
current_title=""
current_action=""
current_files=""
current_surface=""
current_status=""
current_notes=""
in_notes_block=0

reset_item() {
  current_id=""
  current_title=""
  current_action=""
  current_files=""
  current_surface=""
  current_status=""
  current_notes=""
  in_notes_block=0
}

commit_item() {
  if [ -z "$current_id" ]; then return; fi

  local line_ref="$1"

  # Validate action
  if ! grep -qw "$current_action" <<< "$ALLOWED_ACTIONS"; then
    echo "ERROR: line $line_ref: unknown action '$current_action' (allowed: $ALLOWED_ACTIONS)" >&2
    ERRORS=$((ERRORS + 1))
    reset_item
    return
  fi

  # Validate status
  if ! grep -qw "$current_status" <<< "$ALLOWED_STATUSES"; then
    echo "ERROR: line $line_ref: unknown status '$current_status' (allowed: $ALLOWED_STATUSES)" >&2
    ERRORS=$((ERRORS + 1))
    reset_item
    return
  fi

  # Pinning rule: oversized items must remain action=stacked
  if [ "$current_status" = "oversized" ] && [ "$current_action" != "stacked" ]; then
    echo "ERROR: line $line_ref: item $current_id is oversized — action must remain 'stacked' (see stacked-pr-<n>.md); found '$current_action'" >&2
    ERRORS=$((ERRORS + 1))
    reset_item
    return
  fi

  # `action: stacked` is allowed on `manageable` items as user elevation —
  # the user judges it too big even though the classifier said otherwise.
  # SKILL.md 4.9 rewrites the per-item stacked seed with `user_judgment: yes`.
  # No parse error.

  # Build file list: split comma-separated, trim whitespace
  local files_json
  files_json=$(
    printf '%s' "$current_files" \
      | awk -F, '{ for (i=1;i<=NF;i++) { gsub(/^ +| +$/, "", $i); if ($i != "") print $i } }' \
      | jq -Rs 'split("\n") | map(select(length > 0))'
  )

  local item_json
  item_json=$(jq -nc \
    --argjson id "$current_id" \
    --arg title "$current_title" \
    --arg action "$current_action" \
    --argjson files "$files_json" \
    --arg surface "$current_surface" \
    --arg status "$current_status" \
    --arg notes "$current_notes" \
    '{id: $id, title: $title, action: $action, files: $files, surface: $surface, status: $status, notes: $notes}')

  ITEMS_JSON=$(jq -c --argjson item "$item_json" '. + [$item]' <<< "$ITEMS_JSON")
  reset_item
}

# Helper: parse a single "- <key>: <value>" field line into current_* vars.
# Returns 0 if the line matched a field line, 1 otherwise. Extracted so the
# notes-block terminator path can re-dispatch the terminator line through the
# same parser instead of silently dropping it.
parse_field_line() {
  if [[ "$1" =~ ^-[[:space:]]+([a-z_]+):[[:space:]]*(.*)$ ]]; then
    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    case "$key" in
      action)  current_action="$value" ;;
      files)   current_files="$value" ;;
      surface) current_surface="$value" ;;
      status)  current_status="$value" ;;
      notes)
        if [ "$value" = "|" ]; then
          in_notes_block=1
          current_notes=""
        else
          current_notes="$value"
        fi
        ;;
      *) ;;  # unknown key — ignore, future-compat
    esac
    return 0
  fi
  return 1
}

line_no=0
while IFS= read -r line || [ -n "$line" ]; do
  line_no=$((line_no + 1))

  # Item header: "## Item N — <title>"  (em-dash or hyphen accepted)
  if [[ "$line" =~ ^##[[:space:]]+Item[[:space:]]+([0-9]+)[[:space:]]*[—-][[:space:]]*(.+)$ ]]; then
    commit_item "$line_no"
    current_id="${BASH_REMATCH[1]}"
    current_title="${BASH_REMATCH[2]}"
    in_notes_block=0
    continue
  fi

  if [ -z "$current_id" ]; then continue; fi

  # Field lines are only parsed outside a notes block. Inside a notes block,
  # field-shaped lines terminate the block (see below) instead of being
  # appended as prose.
  if [ "$in_notes_block" -eq 0 ] && parse_field_line "$line"; then
    continue
  fi

  # Inside a notes block, accumulate until the next item header or EOF.
  if [ "$in_notes_block" -eq 1 ]; then
    # Terminator: a new field line closes the notes block and is re-dispatched
    # as a field (otherwise users who forget to indent continuation lines see
    # their terminator line silently dropped and a later field overwrites
    # state from an unrelated item).
    if [[ "$line" =~ ^-[[:space:]]+[a-z_]+: ]]; then
      in_notes_block=0
      parse_field_line "$line"
      continue
    fi
    if [ -n "$current_notes" ]; then
      current_notes="${current_notes}
${line}"
    else
      current_notes="$line"
    fi
    continue
  fi
done < "$CHECKLIST_PATH"

commit_item "$line_no"

if [ "$ERRORS" -gt 0 ]; then
  echo "ERROR: $ERRORS problem(s) found — fix the checklist and reply ready again" >&2
  exit 1
fi

echo "$ITEMS_JSON"
