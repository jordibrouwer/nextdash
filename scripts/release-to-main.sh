#!/usr/bin/env bash
# Put origin/dev's tree on main as one commit, strip dev-only paths, tag, push, and publish a GitHub Release.
# dev's history is not merged in, so tests/, docs/ and site/ never enter main's history.
# Run it on dev, with every dev commit pushed: the release is origin/dev, and CI ran on it.
# Usage: ./scripts/release-to-main.sh v1.19.0 [--skip-scan] [--skip-ci]
#   --skip-scan  skip the local govulncheck + Trivy preflight (emergencies only)
#   --skip-ci    release without a green CI run on dev's HEAD (emergencies only)
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
SKIP_CI=0
for arg in "$@"; do
  case "$arg" in
    --skip-scan) SKIP_SCAN=1 ;;
    --skip-ci) SKIP_CI=1 ;;
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
  echo "Usage: $0 <tag> [--skip-scan] [--skip-ci]   e.g. v1.19.0" >&2
  exit 1
fi

if [[ ! "$TAG" =~ ^v[0-9] ]]; then
  echo "Tag must start with v (e.g. v1.19.0), got: ${TAG}" >&2
  exit 1
fi

# What main receives is origin/dev, and the local dev has to be exactly that:
# the CI check below looks at origin/dev's tip, so a local commit that was never
# pushed would be released without a CI run, or silently left out.
git fetch --quiet origin dev
RELEASE_REF="origin/dev"
if [[ "$(git rev-parse HEAD)" != "$(git rev-parse "$RELEASE_REF")" ]]; then
  echo "Local dev and origin/dev differ; push dev (or pull) and let CI run first." >&2
  exit 1
fi

# CI has to have passed on the exact commit being released. Nothing else in
# this script runs the tests, the validators or go vet, so a dev tip whose
# CI run was red -- or never finished, or never started because dev was not
# pushed -- would otherwise go to main as it is.
if [[ "$SKIP_CI" -eq 1 ]]; then
  echo "Warning: --skip-ci given; releasing without a green CI run on dev." >&2
else
  if ! command -v gh >/dev/null 2>&1; then
    echo "gh is needed to check CI on dev (or pass --skip-ci)." >&2
    exit 1
  fi
  head_sha="$(git rev-parse "$RELEASE_REF")"
  ci_run="$(gh run list --workflow ci.yml --branch dev --commit "$head_sha" --limit 1 \
    --json status,conclusion,url --jq '.[0] | "\(.status)|\(.conclusion)|\(.url)"')"
  if [[ -z "$ci_run" ]]; then
    echo "No CI run found for ${head_sha:0:8} on dev." >&2
    exit 1
  fi
  IFS='|' read -r ci_status ci_conclusion ci_url <<<"$ci_run"
  if [[ "$ci_status" != "completed" ]]; then
    echo "CI is still running for ${head_sha:0:8}: ${ci_url}" >&2
    exit 1
  fi
  if [[ "$ci_conclusion" != "success" ]]; then
    echo "CI did not pass for ${head_sha:0:8} (${ci_conclusion}): ${ci_url}" >&2
    exit 1
  fi
  echo "CI passed for ${head_sha:0:8}."
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
KEEP_FILES=(
  scripts/docker-entrypoint.sh
  scripts/gen-asset-hashes.go
  .github/workflows/docker-publish.yml
)

is_kept() {
  local candidate="$1"
  local k
  for k in "${KEEP_FILES[@]}"; do
    [[ "$candidate" == "$k" ]] && return 0
  done
  return 1
}

# main gets one commit per release: the tree of RELEASE_REF with the dev-only
# paths pruned, on top of main's own history. dev is not merged in, so the
# tests, docs and site/ commits never become part of main's history. The tree
# is taken whole, so what main ships is what dev has: CHANGELOG.md, static/data
# and asset_hashes_gen.go come along, files dev dropped are dropped here too,
# and nothing hand-edited on main survives a release.
git checkout main
git read-tree --reset -u "$RELEASE_REF"


PRUNE_DIRS=(
  tests
  scripts
  .github/workflows
  docs
  site
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

# -f on every git rm below: the index now differs from main's HEAD (it holds
# dev's tree), and without -f git refuses and the || true hides the refusal.
git rm -f --ignore-unmatch \
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
  [[ -n "$file" ]] && git rm -f --ignore-unmatch "$file" >/dev/null 2>&1 || true
done < <(git ls-files '*_test.go')

# The rm calls above swallow their errors, so check the result: nothing of the
# dev-only paths may reach main, history aside, and a refusal must not pass.
leftover="$(git ls-files tests site docs test-results playwright-report node_modules Makefile package.json '*_test.go' | head -n 5)"
if [[ -n "$leftover" ]]; then
  echo "The prune left dev-only files in the release; stopping before the commit:" >&2
  echo "$leftover" >&2
  exit 1
fi
for f in "${KEEP_FILES[@]}"; do
  if ! git cat-file -e ":${f}" 2>/dev/null; then
    echo "${f} is missing from the release tree (it must exist on dev); stopping before the commit." >&2
    exit 1
  fi
done

if ! git diff --cached --quiet; then
  git commit -m "Release ${TAG} (dev $(git rev-parse --short "$RELEASE_REF"))"
fi

ensure_release_tag "$TAG"
push_main_and_tag "$TAG"
publish_github_release "$TAG"
git checkout dev

echo "Released $TAG on main."
