#!/bin/bash
# Raycast script command: save whatever the front browser tab is showing.
#
# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Save current tab to nextDash
# @raycast.mode compact
#
# Optional parameters:
# @raycast.icon 🔖
# @raycast.packageName nextDash
#
# Documentation:
# @raycast.description Save the front tab of Safari, Chrome or Arc to your nextDash inbox
# @raycast.author nextDash
#
# The first time this runs, macOS asks whether Raycast may control the browser.
# That prompt is the price of reading the front tab; the bookmarklet needs no
# permission at all and is the better route if you would rather not grant it.
set -euo pipefail

NEXTDASH_URL="${NEXTDASH_URL:-http://localhost:8080}"
NEXTDASH_TOKEN="${NEXTDASH_TOKEN:-}"
export NEXTDASH_URL NEXTDASH_TOKEN

front_app=$(osascript -e 'tell application "System Events" to name of first application process whose frontmost is true')

read_tab() {
    case "$1" in
        Safari)
            osascript -e 'tell application "Safari" to get {URL, name} of front document' ;;
        "Google Chrome"|Chromium|Arc|Brave\ Browser|"Microsoft Edge")
            osascript -e "tell application \"$1\" to get {URL, title} of active tab of front window" ;;
        *)
            return 1 ;;
    esac
}

if ! tab=$(read_tab "$front_app" 2>/dev/null); then
    echo "No readable browser in front ($front_app)"
    exit 1
fi

# AppleScript returns "url, title"; the title may itself contain a comma, so
# only the first separator counts.
url=${tab%%, *}
title=${tab#*, }
exec "$(dirname "$0")/../shell/nextdash-add" "$url" "$title"
