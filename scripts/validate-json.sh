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

echo "Validating whats-new index matches release files…"
python3 << 'PY'
import json, os, sys
out = "static/data/whats-new"
with open(f"{out}/index.json", encoding="utf-8") as f:
    manifest = json.load(f)
files = {
    name[:-5]
    for name in os.listdir(out)
    if name.endswith(".json") and name != "index.json"
}
ids = []
for entry in manifest:
    entry_id = entry.get("id") or entry.get("tag")
    if not entry_id:
        print("index entry missing id/tag", file=sys.stderr)
        sys.exit(1)
    ids.append(entry_id)
    if entry_id not in files:
        print(f"index lists {entry_id} but {entry_id}.json is missing", file=sys.stderr)
        sys.exit(1)
orphans = sorted(files - set(ids))
if orphans:
    print(f"orphan release JSON not in index: {', '.join(orphans[:5])}", file=sys.stderr)
    sys.exit(1)
print(f"  ok index.json ({len(manifest)} releases)")
PY

# The checks above prove the files parse. These three prove they agree with the
# code: the feature catalogue names a locale key per field, and a key removed
# from under it renders as an English fallback in every language rather than as
# an error. That is exactly how 199 catalogue strings were pruned unnoticed --
# these ran only when someone remembered to, and CI never did.
echo "Validating feature catalogue and locale key sets…"
node scripts/validate-overview-features.cjs
node scripts/validate-locale-parity.cjs
node scripts/validate-locale-duplicates.cjs
node scripts/validate-locale-placeholders.cjs
