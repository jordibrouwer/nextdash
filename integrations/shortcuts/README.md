# macOS and iOS Shortcuts

Two shortcuts are worth making. Both are four steps, and both use the same `/add`
route as everything else in this folder.

A `.shortcut` file is a signed binary that Apple's Shortcuts app produces; there
is no honest way to ship one from a repository that you could trust more than
the four steps below, so here are the four steps.

## "Save to nextDash" — from the share sheet

1. **Shortcuts → new shortcut → Shortcut Details → Show in Share Sheet.**
   Accept **URLs** and **Safari web pages** as input.
2. **Text** action: `https://nextdash.example.com/add?url=` — your own address.
   (Add `&token=…` at the end if your install has a capture token.)
3. **URL Encode** the shortcut input, then **Text** again to join the two:
   `[step 2][encoded input]`.
4. **Open URLs** with that text. Rename it *Save to nextDash*.

Sharing a page from Safari — on the Mac and on the phone — now ends in your
inbox. On iOS this is the route that works: Safari does not implement the web
share target the installed app declares, so the Shortcut is what puts nextDash
in the share sheet.

## "Save current tab" — from a keystroke

Same as above, but step 1 becomes **Get Current URL from Safari** and there is no
share-sheet input. Assign it a keyboard shortcut in **System Settings → Keyboard
→ Keyboard Shortcuts → Services**, and saving the page you are reading is one
key away.

## If it does nothing

The most common cause is a capture token: an install with `NEXTDASH_WRITE_TOKEN`
set refuses an unauthenticated capture, and Shortcuts shows the returned page
only if you add a **Show Web Page** step. Add `&token=…` to the text in step 2 —
use `NEXTDASH_CAPTURE_TOKEN`, not the write token, so a shortcut on a shared Mac
cannot do more than add a link.
