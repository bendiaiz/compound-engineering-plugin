#!/usr/bin/env bash
#
# extract-surfaces.sh — read the diff against a base ref, classify each
# changed file into a surface category, and emit a JSON array of
# `{file, surface}` objects on stdout.
#
# Usage:
#   extract-surfaces.sh <base-ref>
#
# <base-ref> is typically the output of resolve-base.sh (e.g., "abc123..."
# or "main"). The script calls `git diff --name-only <base>...HEAD` and
# classifies each returned path.
#
# Surface categories (single-token, in priority order when multiple match):
#   test        - test files (spec/, test/, *_test.*, *_spec.*, *.test.*, *.spec.*)
#   config      - config files (config/, .env*, Gemfile, package.json, *.json, *.yml, *.yaml)
#   asset       - frontend assets (*.css, *.scss, *.js if in assets/, images)
#   view        - templates, components (app/views/, app/components/, src/components/, pages/, src/app/)
#   controller  - HTTP endpoints / controllers (app/controllers/, src/routes/, api/)
#   model       - persistence / domain models (app/models/, src/models/, db/)
#   api         - OpenAPI / gRPC / serializers (app/serializers/, schema.rb, *.proto)
#   other       - none of the above
#
# Classification is path-first. A file matches the first category whose
# pattern matches, so priority order above = priority order below.
#
# Output shape:
#   [
#     {"file": "app/views/users/show.html.erb", "surface": "view"},
#     {"file": "db/migrate/001_init.rb",        "surface": "model"}
#   ]
#
# Empty diff emits "[]".

set -u

BASE_REF="${1:-}"
if [ -z "$BASE_REF" ]; then
  echo "ERROR: base ref is required as the first argument" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is required but not installed" >&2
  exit 1
fi

classify() {
  local path="$1"

  # Tests first (a view component's test file should classify as 'test', not 'view')
  case "$path" in
    test/*|spec/*|tests/*|*_test.*|*_spec.*|*.test.*|*.spec.*)
      echo "test"; return
      ;;
  esac

  # Config
  case "$path" in
    config/*|.env|.env.*|Gemfile|Gemfile.lock|package.json|package-lock.json|pnpm-lock.yaml|yarn.lock|bun.lock|bun.lockb|tsconfig.json|*.config.js|*.config.ts|*.config.mjs|*.config.cjs)
      echo "config"; return
      ;;
  esac

  # Assets
  case "$path" in
    *.css|*.scss|*.sass|*.less|*.png|*.jpg|*.jpeg|*.gif|*.svg|*.webp|*.ico|app/assets/*|public/*|static/*)
      echo "asset"; return
      ;;
  esac

  # Views / components / templates
  case "$path" in
    app/views/*|app/components/*|app/javascript/components/*|src/components/*|components/*|pages/*|src/pages/*|src/app/*|app/*/page.*|app/*/layout.*)
      echo "view"; return
      ;;
  esac

  # Controllers / HTTP endpoints
  case "$path" in
    app/controllers/*|src/routes/*|routes/*|api/*|src/api/*|app/api/*)
      echo "controller"; return
      ;;
  esac

  # Models / persistence
  case "$path" in
    app/models/*|src/models/*|models/*|db/*|migrations/*|prisma/*)
      echo "model"; return
      ;;
  esac

  # API-shape files
  case "$path" in
    app/serializers/*|db/schema.rb|*.proto|*.graphql|openapi.*|swagger.*)
      echo "api"; return
      ;;
  esac

  echo "other"
}

# Run git diff to get the file list. Status `D` (deleted) files are still
# polish surfaces -- their removal is part of what the user tests.
FILES=$(git diff --name-only "${BASE_REF}...HEAD" 2>/dev/null || true)

if [ -z "$FILES" ]; then
  echo "[]"
  exit 0
fi

# Build a JSON array one entry at a time without pulling jq into per-line
# invocation (slow on large diffs). Accumulate as a quoted JSON-safe list.
ENTRIES=""
SEP=""
while IFS= read -r file; do
  if [ -z "$file" ]; then continue; fi
  surface=$(classify "$file")
  # Escape quotes in filenames for JSON safety.
  escaped=$(printf '%s' "$file" | jq -Rs .)
  ENTRIES="${ENTRIES}${SEP}{\"file\":${escaped},\"surface\":\"${surface}\"}"
  SEP=","
done <<< "$FILES"

printf '[%s]\n' "$ENTRIES"
