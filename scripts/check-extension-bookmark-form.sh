#!/usr/bin/env sh
# Fail if extension bookmark-form modules drift from static/js/bookmark-form.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/static/js/bookmark-form"
DEST="$ROOT/extension/bookmark-form"

drift=0
for file in bookmark-url-utils.js bookmark-preview-service.js bookmark-form-preview.js; do
  if ! cmp -s "$SRC/$file" "$DEST/$file"; then
    echo "extension drift: $file (run ./scripts/sync-extension-bookmark-form.sh)" >&2
    drift=1
  fi
done

if [ "$drift" -ne 0 ]; then
  exit 1
fi

echo "extension bookmark-form in sync"
