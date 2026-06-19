#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "Validating locale JSON…"
for f in locales/*.json; do
  python3 -m json.tool "$f" > /dev/null
  echo "  ok $f"
done

echo "Validating whats-new JSON…"
for f in static/data/whats-new/*.json; do
  python3 -m json.tool "$f" > /dev/null
  echo "  ok $f"
done

echo "All JSON files valid."
