# Alfred

Alfred workflows are `.alfredworkflow` bundles — a zip with a plist inside. One
shipped from a repository is a binary you would have to trust; these four steps
take a minute and you can see what they do.

## "Save to nextDash" — a keyword workflow

1. **Alfred → Workflows → + → Blank Workflow.** Name it *nextDash*.
2. Right-click the canvas → **Inputs → Keyword**. Keyword `nd`, *with space*,
   argument **Required**, title *Save to nextDash*.
3. Right-click → **Actions → Run Script**. Language `/bin/bash`, with input as
   **argv**:

   ```bash
   NEXTDASH_URL="https://nextdash.example.com" \
   NEXTDASH_TOKEN="" \
   /path/to/nextdash/integrations/shell/nextdash-add "$1"
   ```

4. Connect the keyword to the script, then right-click the script → **Post
   Notification** if you want the result on screen; the script prints *Saved to
   the inbox* or *Already in the inbox*.

`nd https://example.com/article` now saves.

## "Save the front tab"

Same workflow, but step 2 becomes a **Hotkey** input and the script reads the
browser first:

```bash
url=$(osascript -e 'tell application "Safari" to get URL of front document')
title=$(osascript -e 'tell application "Safari" to get name of front document')
NEXTDASH_URL="https://nextdash.example.com" \
/path/to/nextdash/integrations/shell/nextdash-add "$url" "$title"
```

For Chrome, Arc, Brave or Edge, replace the two AppleScript lines with the ones
in [`../raycast/save-current-tab.sh`](../raycast/save-current-tab.sh), which
already handles all five browsers and asks the front app which it is.

## The token

Only needed when the install runs with `NEXTDASH_WRITE_TOKEN`. Put its
`NEXTDASH_CAPTURE_TOKEN` in `NEXTDASH_TOKEN` above — that one opens capture and
nothing else, which is what you want in a workflow file you might share.
