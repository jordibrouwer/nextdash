# Integrations

Everything here talks to one route:

```
GET /add?url=<address>&title=<optional title>[&token=<capture token>]
```

It saves to the **Inbox** — the same place the extension and the share sheet
save to, with the same duplicate handling — and answers with a page a person can
read, so a bookmarklet or a Shortcut can simply open it.

That is the whole contract. Anything that can open a URL or run `curl` is an
integration; the files here are the ones worth keeping around.

The other half of the surface is the share target — `GET /share?title=…&text=…&url=…`
— which is what the installed app declares to a phone's share sheet, and which
accepts the same token. Everything else nextDash does is behind `/api/`, needs
the write token in a header, and is not what these are for: the point of a
capture route is that it is the one thing you can reach from a place that cannot
set headers.

| | |
|---|---|
| [`shell/nextdash-add`](shell/nextdash-add) | The one-line saver. Quick Actions, Keyboard Maestro, cron, an alias — anything that runs a command. |
| [`raycast/save-to-nextdash.sh`](raycast/save-to-nextdash.sh) | Raycast: type a URL, save it. |
| [`raycast/save-current-tab.sh`](raycast/save-current-tab.sh) | Raycast: save the front tab of Safari, Chrome, Arc, Brave or Edge. |
| [`shortcuts/README.md`](shortcuts/README.md) | Apple Shortcuts, for the macOS and iOS share sheets. |
| [`alfred/README.md`](alfred/README.md) | Alfred: a keyword workflow, and a hotkey for the front tab. |
| [`dropzone/nextDash.dzbundle.rb`](dropzone/nextDash.dzbundle.rb) | Dropzone: drop a link on the target, or click it to save the clipboard. |
| [`ulauncher/`](ulauncher/) | Ulauncher, on Linux: `nd <url>`. |

## The one-liner

Nothing to install, and the thing to paste when someone asks how to save from a
script:

```sh
curl -s --get --data-urlencode "url=https://example.com/article" \
     --data-urlencode "title=An article" \
     https://nextdash.example.com/add >/dev/null
```

Add `--data-urlencode "token=…"` when the install has a capture token. Use
`--data-urlencode` rather than building the query by hand: an address carrying
its own `?x=1&y=2`, or a title with an ampersand, is exactly what breaks that.

## Configuration

Two environment variables, used by every script here:

- `NEXTDASH_URL` — where nextDash lives. Defaults to `http://localhost:8080`.
- `NEXTDASH_TOKEN` — only needed when the install runs with
  `NEXTDASH_WRITE_TOKEN`. Use its `NEXTDASH_CAPTURE_TOKEN`: that one opens the
  two capture routes and nothing else, so a copy of it sitting in a script or a
  browser's history can at worst add a link to your inbox.

```sh
export NEXTDASH_URL=https://nextdash.example.com
export NEXTDASH_TOKEN=…              # only if the install has a capture token
./shell/nextdash-add "https://example.com/article" "An article"
```

## The bookmarklet

Not a file, because the useful half of it is your own address: **Config → Help →
Inbox** builds it for you, with the token filled in if you have one. It works in
Safari, Firefox, Orion and every mobile browser the Chrome extension will never
reach.

## What is tested, and what is not

`shell/nextdash-add` and `raycast/save-to-nextdash.sh` were run against a live
nextDash while they were written — including a URL carrying its own query string
and a title with spaces and an ampersand, which is where hand-built query strings
usually break, and against an install with a write token set, where the script
exits non-zero and prints *Not saved* without a capture token, and saves with
one.

`raycast/save-current-tab.sh` reads the front tab through AppleScript, which
needs a browser, a desktop session and macOS automation permission; it has not
been run here. The Dropzone action and the Ulauncher extension are syntax-checked
but not run — each needs its host app — and the Alfred and Shortcuts steps cannot
be tested from a repository at all. Where a file could not be exercised, it says
so rather than implying otherwise.
