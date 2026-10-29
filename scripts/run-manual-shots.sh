#!/usr/bin/env bash
# Take the manual's screenshots over a seed from scripts/make-manual-seed.sh.
#
#   scripts/run-manual-shots.sh <seed-dir> [out-dir]
#
# out-dir defaults to screenshots/manual.md (the directory is called that,
# literally). Pass a scratch directory first to look before replacing anything:
#
#   scripts/run-manual-shots.sh /tmp/seed /tmp/trial
#   cp /tmp/trial/* screenshots/manual.md/
#
# Six specs write there; between them they own every file in the directory
# (a few names are taken twice, and both versions are made to match). The run
# is about two minutes with eight workers. The browser's clock is the moment
# the seed was made, so a seed older than the run is fine, a stale one is not:
# make a fresh seed for every run.
#
# Output goes to a file and the exit code is read from the run itself: piping
# Playwright through tail reports 0 whatever happened.
set -u

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
SEED="${1:-}"
OUT="${2:-$ROOT/screenshots/manual.md}"
if [ -z "$SEED" ] || [ ! -f "$SEED/health-history.json" ]; then
  echo "usage: scripts/run-manual-shots.sh <seed-dir> [out-dir]" >&2
  echo "(<seed-dir> comes from scripts/make-manual-seed.sh and holds health-history.json)" >&2
  exit 2
fi
case "$SEED" in
  */data-demo|*/data-demo/) echo "refusing data-demo: it holds personal bookmarks" >&2; exit 2 ;;
esac
if [ ! -e "$ROOT/node_modules" ]; then
  echo "no node_modules in $ROOT: in a worktree, symlink the main checkout's (ln -s <main>/node_modules node_modules)" >&2
  exit 2
fi

mkdir -p "$OUT"
LOG="${TMPDIR:-/tmp}/manual-shots-$$.log"
cd "$ROOT" || exit 1
MANUAL_SHOTS=1 NEXTDASH_DATA_DIR="$SEED" SHOTS_OUT="$OUT" PW_WORKERS=8 \
  npx playwright test \
    tests/manual-screenshots.spec.js \
    tests/manual-screenshots-v1-21.spec.js \
    tests/manual-screenshots-glances.spec.js \
    tests/manual-screenshots-v1-22.spec.js \
    tests/manual-screenshots-v1-23.spec.js \
    tests/manual-screenshots-v1-22-4.spec.js \
    --reporter=line --retries=2 >"$LOG" 2>&1
status=$?
grep -E '^\s+[0-9]+ (passed|failed|flaky|skipped)' "$LOG"
echo "exit $status, log $LOG, shots in $OUT"
exit $status
