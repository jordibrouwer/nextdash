#!/usr/bin/env bash
# Merge dev into main and strip dev-only paths from main.
# Usage: ./scripts/release-to-main.sh v2026.06.29
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

if [[ "$(git branch --show-current)" != "dev" ]]; then
  echo "Run this script from the dev branch." >&2
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Commit or stash changes before releasing." >&2
  exit 1
fi

TAG="${1:-}"
if [[ -z "$TAG" ]]; then
  echo "Usage: $0 <tag>   e.g. v2026.06.29" >&2
  exit 1
fi

git config merge.ours.driver true

git checkout main
if ! git merge dev --no-edit; then
  # modify/delete: main removed dev-only files; keep them deleted on main
  while IFS= read -r path; do
    [[ -n "$path" ]] && git rm -f "$path" >/dev/null 2>&1 || true
  done < <(git diff --name-only --diff-filter=UD)

  if git diff --name-only --diff-filter=U | grep -q .; then
    echo "Unresolved merge conflicts remain. Fix manually, then commit on main." >&2
    exit 1
  fi

  git commit --no-edit
fi

PRUNE_DIRS=(
  tests
  docs
  scripts
  .github/workflows
  test-results
  playwright-report
  node_modules
)

for dir in "${PRUNE_DIRS[@]}"; do
  git rm -rf --ignore-unmatch "$dir" >/dev/null 2>&1 || true
done

git rm --ignore-unmatch \
  .github/pull_request_template.md \
  package.json \
  package-lock.json \
  playwright.config.js \
  ca_profile.xml \
  favicon.ico \
  favicon.png \
  >/dev/null 2>&1 || true

while IFS= read -r file; do
  [[ -n "$file" ]] && git rm --ignore-unmatch "$file" >/dev/null 2>&1 || true
done < <(git ls-files '*_test.go')

if ! git diff --cached --quiet; then
  git commit -m "Prune dev-only files after merge from dev."
fi

git tag "$TAG"
git push origin main --tags
git checkout dev

echo "Released $TAG on main."
