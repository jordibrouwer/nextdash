#!/usr/bin/env bash
# Merge dev into main, strip dev-only paths, tag, push, and publish a GitHub Release.
# Usage: ./scripts/release-to-main.sh v1.19.0 [--skip-scan]
#   --skip-scan  skip the local govulncheck + Trivy preflight (emergencies only)
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

TAG=""
SKIP_SCAN=0
for arg in "$@"; do
  case "$arg" in
    --skip-scan) SKIP_SCAN=1 ;;
    -*) echo "Unknown option: ${arg}" >&2; exit 1 ;;
    *)
      if [[ -n "$TAG" ]]; then
        echo "Only one tag allowed, got: ${TAG} and ${arg}" >&2
        exit 1
      fi
      TAG="$arg" ;;
  esac
done
if [[ -z "$TAG" ]]; then
  echo "Usage: $0 <tag> [--skip-scan]   e.g. v1.19.0" >&2
  exit 1
fi

if [[ ! "$TAG" =~ ^v[0-9] ]]; then
  echo "Tag must start with v (e.g. v1.19.0), got: ${TAG}" >&2
  exit 1
fi

# The same vulnerability checks docker-publish.yml runs, but here, before
# anything is merged, tagged or pushed. That workflow only starts once the
# GitHub Release exists; a finding there leaves a release with no image and
# no way out but a new patch version. It scans dev; main ships the same code
# minus the pruned dev-only paths, so a clean dev scan stands for the image.
if [[ "$SKIP_SCAN" -eq 1 ]]; then
  echo "Warning: --skip-scan given; releasing without the vulnerability preflight." >&2
else
  bash "${ROOT}/scripts/release-preflight.sh"
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
  if extract_changelog_notes "$tag" > "$notes_file" 2>/dev/null && [[ -s "$notes_file" ]]; then
    :
  else
    # Said out loud rather than swallowed. A silent fallback here is how three
    # releases went out with a one-line body: the changelog had been dropped by
    # the merge above, extract_changelog_notes returned 1, and nothing on
    # screen distinguished that from a release that genuinely had no notes.
    echo "Warning: no CHANGELOG.md section for ${tag} — publishing a bare release body." >&2
    if [[ ! -f CHANGELOG.md ]]; then
      echo "         CHANGELOG.md is missing on this branch entirely." >&2
    fi
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

# Files that must exist on main regardless of PRUNE_DIRS — the Dockerfile
# needs the two scripts/ entries to build at all, and docker-publish.yml is
# the workflow that builds and publishes that same image on every release.
#
# Defined here (before the merge) rather than down by PRUNE_DIRS because a
# file deleted on main in an earlier release and left untouched on dev since
# is resolved by git as a clean, silent delete — not a conflict. It never
# shows up in the modify/delete conflict loop below, so it's already gone
# from the merged tree by the time PRUNE_DIRS would otherwise have spared
# it. These have to be restored explicitly after the merge, every time.
KEEP_FILES=(
  scripts/docker-entrypoint.sh
  scripts/gen-asset-hashes.go
  .github/workflows/docker-publish.yml
)

# Files main takes from dev whole, every release. main's copy is never edited
# on purpose, but a line added there by hand once (a "latest release" blurb)
# survived every merge since: dev never touched that line, so git kept it.
# Taking dev's copy outright means what main shows is what dev has.
MIRROR_FILES=(
  README.md
)

is_kept() {
  local candidate="$1"
  local k
  for k in "${KEEP_FILES[@]}"; do
    [[ "$candidate" == "$k" ]] && return 0
  done
  return 1
}

git config merge.ours.driver true

git checkout main
if ! git merge dev --no-edit; then
  # A content conflict in a mirrored file is settled by dev's copy.
  for f in "${MIRROR_FILES[@]}"; do
    if git diff --name-only --diff-filter=U | grep -qx -- "$f"; then
      git checkout --theirs -- "$f" 2>/dev/null || true
      git add -- "$f" 2>/dev/null || true
    fi
  done
  echo "Resolving modify/delete conflicts for dev-only paths on main..."
  while IFS= read -r path; do
    [[ -n "$path" ]] || continue
    # Paths that belong on main and must survive a modify/delete conflict.
    #
    # The catch-all below deletes anything not listed here, on the assumption
    # that a file main does not have is a dev-only file. That held while the
    # list covered only code and translations, but it silently took three
    # things with it that main needs:
    #
    #   CHANGELOG.md          — and with it the release notes, because
    #                           extract_changelog_notes runs on main and
    #                           returns 1 when the file is absent, which is
    #                           why published releases kept reading
    #                           "Release <tag>" with an empty body
    #   static/data/*         — the What's new manifest lives here; without
    #                           index.json the modal and the version shown in
    #                           Config → Overview have nothing to read, even
    #                           though all 131 release files ship
    #   internal/app/asset_hashes_gen.go
    #                         — generated, but committed, and main has no
    #                           scripts/ to regenerate it, so without it main
    #                           does not compile at all. The path is matched
    #                           literally, so it moves whenever the package
    #                           does.
    #
    # None of these were in PRUNE_DIRS or the explicit git rm list, so they
    # were never deliberately dropped — they just fell through this case.
    if is_kept "$path"; then
      git checkout --theirs -- "$path" 2>/dev/null || true
      git add -- "$path" 2>/dev/null || true
      continue
    fi
    case "$path" in
      static/js/*|static/css/*|static/data/*|templates/*|locales/*|CHANGELOG.md|internal/app/asset_hashes_gen.go)
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

# Belt-and-braces: restore any KEEP_FILES entry that the merge silently
# dropped (no conflict shown, because it was unchanged on dev since main
# deleted it in an earlier release). Safe to run even when the file was
# never touched by the merge at all — checkout + add is a no-op then.
for f in "${KEEP_FILES[@]}"; do
  if git cat-file -e "dev:${f}" 2>/dev/null; then
    git checkout dev -- "$f" 2>/dev/null || true
    git add -- "$f" 2>/dev/null || true
  fi
done

# And outside a conflict: a merge that went clean still keeps main-only lines.
for f in "${MIRROR_FILES[@]}"; do
  if git cat-file -e "dev:${f}" 2>/dev/null; then
    git checkout dev -- "$f" 2>/dev/null || true
    git add -- "$f" 2>/dev/null || true
  fi
done
if ! git diff --cached --quiet -- "${MIRROR_FILES[@]}"; then
  git commit -m "Take ${MIRROR_FILES[*]} from dev." -- "${MIRROR_FILES[@]}"
fi

PRUNE_DIRS=(
  tests
  scripts
  .github/workflows
  docs
  test-results
  playwright-report
  node_modules
)

for dir in "${PRUNE_DIRS[@]}"; do
  while IFS= read -r f; do
    [[ -n "$f" ]] || continue
    is_kept "$f" && continue
    git rm -f --ignore-unmatch "$f" >/dev/null 2>&1 || true
  done < <(git ls-files "$dir")
done

git rm --ignore-unmatch \
  .github/pull_request_template.md \
  Makefile \
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

ensure_release_tag "$TAG"
push_main_and_tag "$TAG"
publish_github_release "$TAG"
git checkout dev

echo "Released $TAG on main."
