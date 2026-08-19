#!/bin/bash
# Raycast script command: save a link to the nextDash inbox.
#
# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Save to nextDash
# @raycast.mode compact
#
# Optional parameters:
# @raycast.icon 🔖
# @raycast.packageName nextDash
# @raycast.argument1 { "type": "text", "placeholder": "URL" }
# @raycast.argument2 { "type": "text", "placeholder": "title", "optional": true }
#
# Documentation:
# @raycast.description Save a link to your nextDash inbox
# @raycast.author nextDash

# Point these at your install. The token is only needed when nextDash runs with
# a write token; use its NEXTDASH_CAPTURE_TOKEN, which opens capture and nothing
# else, so this file is not worth stealing.
NEXTDASH_URL="${NEXTDASH_URL:-http://localhost:8080}"
NEXTDASH_TOKEN="${NEXTDASH_TOKEN:-}"

export NEXTDASH_URL NEXTDASH_TOKEN
exec "$(dirname "$0")/../shell/nextdash-add" "$1" "${2:-}"
