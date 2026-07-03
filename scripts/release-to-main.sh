#!/usr/bin/env bash
# Merge dev into main, strip dev-only paths, tag, push, and publish a GitHub Release.
# Usage: ./scripts/release-to-main.sh v2026.06.31
# Requires: gh auth login (once) for the GitHub Release step.
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

if [[ ! "$TAG" =~ ^v[0-9] ]]; then
  echo "Tag must start with v (e.g. v2026.06.31), got: ${TAG}" >&2
  exit 1
fi

tag_commit() {
  git rev-parse "${1}^{commit}" 2>/dev/null
}

remote_tag_commit() {
  local sha
  sha="$(git ls-remote origin "refs/tags/${1}^{}" 2>/dev/null | awk 'NR==1 {print $1}')"
  [[ -n "$sha" ]] || return 1
  git rev-parse "${sha}^{commit}" 2>/dev/null
}

ensure_release_tag() {
  local tag="$1"
  local head
  head="$(git rev-parse HEAD)"
  if git show-ref --tags --verify --quiet "refs/tags/${tag}"; then
    local existing
    existing="$(tag_commit "$tag")"
    if [[ "$existing" == "$head" ]]; then
      echo "Tag ${tag} already exists locally on current HEAD — reusing."
      return 0
    fi
    echo "Tag ${tag} already exists locally on ${existing}, but HEAD is ${head}." >&2
    echo "Use a new version tag, or delete the old tag:" >&2
    echo "  git tag -d ${tag} && git push origin :refs/tags/${tag}" >&2
    exit 1
  fi
  git tag "$tag"
  echo "Created tag ${tag}."
}

push_main_and_tag() {
  local tag="$1"
  local head tagged remote_tagged

  head="$(git rev-parse HEAD)"
  tagged="$(tag_commit "$tag")"

  git push origin main

  if remote_tag_commit "$tag"; then
    remote_tagged="$(remote_tag_commit "$tag")"
    if [[ "$remote_tagged" == "$tagged" ]]; then
      echo "Tag ${tag} already exists on origin — skipping tag push."
      return 0
    fi
    echo "Tag ${tag} on origin points to ${remote_tagged}, local tag is ${tagged}." >&2
    echo "Refusing to move an existing release tag. Bump the version or delete the remote tag first." >&2
    exit 1
  fi

  git push origin "refs/tags/${tag}"
  echo "Pushed tag ${tag} to origin."
}

extract_changelog_notes() {
  local tag="$1"
  local version="${tag#v}"
  if [[ ! -f CHANGELOG.md ]]; then
    return 1
  fi
  awk -v ver="$version" '
    $0 ~ "^## v" ver " " { found=1; next }
    found && /^---$/ { exit }
    found { print }
  ' CHANGELOG.md
}

publish_github_release() {
  local tag="$1"

  if ! command -v gh >/dev/null 2>&1; then
    echo "Note: gh not found; skipped GitHub Release. Install with: brew install gh" >&2
    return 0
  fi

  if ! gh auth status >/dev/null 2>&1; then
    echo "Note: gh not logged in; skipped GitHub Release. Run once: gh auth login" >&2
    return 0
  fi

  local notes_file
  notes_file="$(mktemp)"
  if extract_changelog_notes "$tag" > "$notes_file" 2>/dev/null; then
    :
  else
    echo "Release ${tag}" > "$notes_file"
  fi

  if gh release view "$tag" >/dev/null 2>&1; then
    gh release edit "$tag" --notes-file "$notes_file" --latest
    rm -f "$notes_file"
    echo "Updated GitHub Release ${tag} (latest)."
    return 0
  fi

  gh release create "$tag" --title "$tag" --notes-file "$notes_file" --latest
  rm -f "$notes_file"
  echo "Published GitHub Release ${tag} (latest)."
}

git config merge.ours.driver true

git checkout main
if ! git merge dev --no-edit; then
  echo "Resolving modify/delete conflicts for dev-only paths on main..."
  while IFS= read -r path; do
    [[ -n "$path" ]] || continue
    case "$path" in
      static/js/*|static/css/*|templates/*|locales/*)
        git checkout --theirs -- "$path" 2>/dev/null || true
        git add -- "$path" 2>/dev/null || true
        ;;
      *)
        git rm -f "$path" >/dev/null 2>&1 || true
        ;;
    esac
  done < <(git diff --name-only --diff-filter=UD)

  if git diff --name-only --diff-filter=U | grep -q .; then
    echo "Unresolved merge conflicts remain. Fix manually, then commit on main." >&2
    exit 1
  fi

  git commit --no-edit
fi

PRUNE_DIRS=(
  docs
  test-results
  playwright-report
  node_modules
)

for dir in "${PRUNE_DIRS[@]}"; do
  git rm -rf --ignore-unmatch "$dir" >/dev/null 2>&1 || true
done

git rm --ignore-unmatch \
  .github/pull_request_template.md \
  ca_profile.xml \
  favicon.ico \
  favicon.png \
  >/dev/null 2>&1 || true

if ! git diff --cached --quiet; then
  git commit -m "Prune dev-only files after merge from dev."
fi

ensure_release_tag "$TAG"
push_main_and_tag "$TAG"
publish_github_release "$TAG"
git checkout dev

echo "Released $TAG on main."
