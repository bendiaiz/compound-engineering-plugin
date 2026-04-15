#!/usr/bin/env bash
#
# detect-project-type.sh — inspect signature files at the repo root and emit
# a single project-type identifier on stdout.
#
# Usage:
#   detect-project-type.sh
#
# Output (one line on stdout):
#   rails       - bin/dev exists and Gemfile is present
#   next        - next.config.js, next.config.mjs, or next.config.ts is present
#   vite        - vite.config.js, vite.config.ts, vite.config.mjs, or vite.config.cjs
#   procfile    - Procfile or Procfile.dev is present (and no Rails signature)
#   multiple    - two or more disjoint signatures match (caller must prompt)
#   unknown     - no signatures match
#
# `multiple` vs `rails`: Rails apps commonly ship a Procfile.dev alongside
# bin/dev. To avoid treating every Rails app as a monorepo, the `rails`
# signature takes precedence over a bare `procfile` match. `multiple` is
# reserved for genuine disambiguation cases (e.g., Rails + Next, Next + Vite).

set -u

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -z "$REPO_ROOT" ]; then
  echo "ERROR: not in a git repository" >&2
  exit 1
fi

cd "$REPO_ROOT" || { echo "ERROR: cannot cd to repo root" >&2; exit 1; }

MATCHES=()

# Rails: bin/dev AND Gemfile together. A Gemfile alone (or bin/dev alone) is
# insufficient -- plenty of gems have Gemfiles without bin/dev, and bin/dev
# may exist in non-Rails projects.
if [ -f "bin/dev" ] && [ -f "Gemfile" ]; then
  MATCHES+=("rails")
fi

# Next.js
if [ -f "next.config.js" ] || [ -f "next.config.mjs" ] || [ -f "next.config.ts" ] || [ -f "next.config.cjs" ]; then
  MATCHES+=("next")
fi

# Vite
if [ -f "vite.config.js" ] || [ -f "vite.config.ts" ] || [ -f "vite.config.mjs" ] || [ -f "vite.config.cjs" ]; then
  MATCHES+=("vite")
fi

# Procfile / Overmind / Foreman — only if we didn't already detect rails
if [ ${#MATCHES[@]} -eq 0 ] || [ "${MATCHES[0]}" != "rails" ]; then
  if [ -f "Procfile" ] || [ -f "Procfile.dev" ]; then
    MATCHES+=("procfile")
  fi
fi

case ${#MATCHES[@]} in
  0) echo "unknown" ;;
  1) echo "${MATCHES[0]}" ;;
  *) echo "multiple" ;;
esac
