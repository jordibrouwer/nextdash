#!/usr/bin/env sh
# Sync shared bookmark-form modules from the dashboard static tree into the Chrome extension.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/static/js/bookmark-form"
DEST="$ROOT/extension/bookmark-form"

for file in bookmark-url-utils.js bookmark-preview-service.js bookmark-form-preview.js; do
  cp "$SRC/$file" "$DEST/$file"
  echo "synced $file"
done
