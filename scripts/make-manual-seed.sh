#!/usr/bin/env bash
# Make the data directory the manual's screenshots are taken over.
#
#   scripts/make-manual-seed.sh <output-dir>
#
# The server seeds itself in demo mode (NEXTDASH_DEMO=1): public sites on three
# pages, an inbox in use, ninety days of opens, eleven monitors with outages and
# a ninety-day health trend. Demo mode fetches only some of the favicons, so the
# rest are fetched afterwards in normal mode, a few at a time with a pause (a
# burst is refused by the sites). The history is written relative to the moment
# this script runs, and tests/helpers/manual-shot-kit.js takes that moment from
# health-history.json as the browser's clock: make a fresh seed for every run.
#
# NEVER point the shots at ./data-demo: it holds personal bookmarks.
# Needs: go, curl, lsof. Takes about four minutes. Uses PORT (default 8087), never 8080.
set -u

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
OUT="${1:-}"
PORT="${PORT:-8087}"
if [ -z "$OUT" ]; then
  echo "usage: scripts/make-manual-seed.sh <output-dir>" >&2
  exit 2
fi
case "$OUT" in
  */data-demo|*/data-demo/|./data|*/data|*/data/) echo "refusing $OUT: not a scratch directory" >&2; exit 2 ;;
esac
if [ "$PORT" = "8080" ]; then echo "port 8080 is the user's" >&2; exit 2; fi
if lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port $PORT is in use; set PORT=<free port>" >&2
  exit 2
fi

WORK="$(mktemp -d)"
BIN="$WORK/nextdash"
PID=""
cleanup() {
  [ -n "$PID" ] && kill "$PID" 2>/dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT

stop_server() {
  [ -n "$PID" ] && kill "$PID" 2>/dev/null
  [ -n "$PID" ] && wait "$PID" 2>/dev/null
  PID=""
}

echo "building the server"
(cd "$ROOT" && go build -o "$BIN" .) || { echo "build failed" >&2; exit 1; }

# 1. The server seeds itself, fetching favicons and link previews once.
rm -rf "$OUT" "$WORK/demo"
mkdir -p "$WORK/demo"
PORT="$PORT" NEXTDASH_DEMO=1 NEXTDASH_DEMO_RESET_MINUTES=600 NEXTDASH_DATA_DIR="$WORK/demo" \
  "$BIN" >"$WORK/demo.log" 2>&1 &
PID=$!
for _ in $(seq 1 90); do
  grep -q 'demo: kept' "$WORK/demo.log" && break
  sleep 2
done
# The previews arrive after the favicons: wait until their count stops moving.
last=-1
for _ in $(seq 1 30); do
  n=$(ls "$WORK/demo/preview-images" 2>/dev/null | wc -l | tr -d ' ')
  [ "$n" = "$last" ] && break
  last=$n
  sleep 4
done
stop_server
echo "seeded: $(grep 'demo: kept' "$WORK/demo.log" | tail -1 | sed 's/^.*INFO server //')"

# 2. The favicons demo mode left out, in normal mode, page by page.
cp -R "$WORK/demo" "$OUT"
PORT="$PORT" NEXTDASH_DATA_DIR="$OUT" "$BIN" >"$WORK/icons.log" 2>&1 &
PID=$!
for _ in $(seq 1 30); do
  curl -s -o /dev/null "localhost:$PORT/api/pages" && break
  sleep 1
done
for pass in 1 2 3; do
  for page in 2 3 1; do
    for offset in 0 8 16 24 32 40 48; do
      reply=$(curl -s -m 90 -X POST "localhost:$PORT/api/bookmarks/prefetch-icons" \
        -H 'Content-Type: application/json' \
        -d "{\"pageId\":$page,\"limit\":8,\"refreshAll\":true,\"offset\":$offset}")
      sleep 3
      case "$reply" in *'"done":true'*) break ;; esac
    done
  done
done
stop_server

echo "favicons: $(ls "$OUT/icons" 2>/dev/null | wc -l | tr -d ' ') files in $OUT/icons"
echo "ready: $OUT"
echo "take the shots with: scripts/run-manual-shots.sh $OUT"
