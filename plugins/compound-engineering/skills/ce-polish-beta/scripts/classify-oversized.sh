#!/usr/bin/env bash
#
# classify-oversized.sh — decide whether a checklist item is manageable or
# oversized, based on file count, surface count, and diff-line volume.
#
# Usage:
#   classify-oversized.sh <base-ref> <file-list-json>
#
# Arguments:
#   <base-ref>         - the base ref for the diff (same arg used by extract-surfaces.sh)
#   <file-list-json>   - a JSON array of objects with at least `file` and `surface` keys.
#                        Typically a subset of extract-surfaces.sh output for one
#                        checklist item.
#
# Output (stdout, single line):
#   {"status": "manageable" | "oversized", "reason": "<string or empty>",
#    "file_count": N, "surface_count": N, "diff_lines": N}
#
# Thresholds (intentionally conservative starting points; revisit after beta):
#   - files     > 5 distinct file paths
#   - surfaces  > 2 distinct surface categories
#   - diff      > 300 total changed lines (added + removed) across the item's files
#
# Any single threshold exceeded tips the item to `oversized`.

set -u

BASE_REF="${1:-}"
FILE_LIST_JSON="${2:-}"

if [ -z "$BASE_REF" ] || [ -z "$FILE_LIST_JSON" ]; then
  echo "ERROR: usage: classify-oversized.sh <base-ref> <file-list-json>" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is required but not installed" >&2
  exit 1
fi

FILE_COUNT=$(jq '[.[].file] | unique | length' <<< "$FILE_LIST_JSON")
SURFACE_COUNT=$(jq '[.[].surface] | unique | length' <<< "$FILE_LIST_JSON")

# Compute diff line volume using git numstat. Each line in numstat output is
# "added<TAB>deleted<TAB>filename"; sum the first two columns for files that
# are in the item's file list.
FILES_ARG=$(jq -r '[.[].file] | unique | .[]' <<< "$FILE_LIST_JSON")

DIFF_LINES=0
if [ -n "$FILES_ARG" ]; then
  # Convert the newline-separated file list into git's positional args, but
  # do it safely via a null-delimited xargs-free approach using a while loop.
  # git diff --numstat does not accept stdin for paths, so we rely on `--`.
  #
  # Build a bash array of files.
  FILES_ARRAY=()
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    FILES_ARRAY+=("$line")
  done <<< "$FILES_ARG"

  if [ ${#FILES_ARRAY[@]} -gt 0 ]; then
    NUMSTAT=$(git diff --numstat "${BASE_REF}...HEAD" -- "${FILES_ARRAY[@]}" 2>/dev/null || true)
    if [ -n "$NUMSTAT" ]; then
      # Sum added+deleted. Binary files show "-\t-" in numstat; skip them.
      DIFF_LINES=$(awk '
        $1 != "-" && $2 != "-" { total += $1 + $2 }
        END { print total + 0 }
      ' <<< "$NUMSTAT")
    fi
  fi
fi

STATUS="manageable"
REASON=""

if [ "$FILE_COUNT" -gt 5 ]; then
  STATUS="oversized"
  REASON="file_count > 5"
elif [ "$SURFACE_COUNT" -gt 2 ]; then
  STATUS="oversized"
  REASON="surface_count > 2"
elif [ "$DIFF_LINES" -gt 300 ]; then
  STATUS="oversized"
  REASON="diff_lines > 300"
fi

jq -nc \
  --arg status "$STATUS" \
  --arg reason "$REASON" \
  --argjson file_count "$FILE_COUNT" \
  --argjson surface_count "$SURFACE_COUNT" \
  --argjson diff_lines "$DIFF_LINES" \
  '{status: $status, reason: $reason, file_count: $file_count, surface_count: $surface_count, diff_lines: $diff_lines}'
