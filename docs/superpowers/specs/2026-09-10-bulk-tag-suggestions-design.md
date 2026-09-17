# Bulk tag suggestions from URL patterns and page text

**Date:** 2026-09-10
**Status:** Design approved, not yet implemented

## What this is for

A collection grows faster than anyone tags it. nextDash already knows a great
deal about each bookmark — its host, its path, the name you gave it, and for
many of them a fetched title and description — but none of that turns into
tags without typing. This feature proposes tags in bulk and lets you accept
them a group at a time.

It proposes. It never applies anything on its own.

## Decisions, and why

**Everything is local.** No LLM, no external categorisation API. Karakeep is
the reference implementation for the LLM route and it is a good one, but it
either ships your bookmark URLs to a cloud model or asks you to run Ollama;
commercial URL-categorisation APIs (Klazify, WebShrinker, WhoisXML) send every
address off the machine and answer with IAB categories rather than with the
words you actually use. Neither fits an app whose first line is *no accounts,
no cloud, no noise*.

**Suggestions come from four sources, ranked.** A bookmark gets at most two
proposals, and the highest-ranked source wins a conflict:

1. **Your own rule** — a pattern you wrote. Always decisive.
2. **What you already did** — eight of your ten `github.com` bookmarks carry
   `#code`, so the other two are offered `#code`.
3. **The catalogue, by host** — `github.com → dev`, renamed to your own tag
   where you have one.
4. **The catalogue, by page text** — keywords extracted from the page, used
   only when 1 to 3 found nothing.

**Your vocabulary wins.** The catalogue supplies the *subject*; your existing
tags supply the *name*. If the catalogue says `dev` and you already tag GitHub
links `#code`, the suggestion is `#code`. Without this rule a shipped
catalogue splits a tidy collection into two tags for one thing.

**Patterns match host plus first path segment.** `github.com` as a whole, and
`reddit.com/r/selfhosted` separately. Enough for the sites where one domain
carries several subjects; short of building a pattern language.

**Page text is fetched only when you ask.** A round is started by a button,
reports its progress, and can be stopped. Nothing is fetched on a schedule and
nothing rides along quietly in the background.

**The app asks now and then, from a card rather than a modal.** A review
offer that throws a dialog in your face is a dialog you learn to dismiss
without reading. `health-review-notice.js` already solved this for link
review — a card in the corner, *Start · Not today · Remind me in 30 days* —
and this follows it. The modal opens only after you press Start.

**Only derived keywords are stored,** never page text. A dozen keywords per
bookmark is tens of bytes; two kilobytes of text per bookmark is megabytes in
the data directory and in every backup ZIP.

## Architecture

Two halves, split by what each side can see.

**Client (JS)** owns the half that needs the whole collection: grouping
bookmarks by pattern, counting which tags you already use per group, and
ranking proposals. It runs against the bookmarks the page already holds — the
config section loads them for its tag manager, and the dashboard keeps them in
memory for multi-select — so a suggestion is never stale and never costs a
round trip.

**Server (Go)** owns the half the browser cannot reach: fetching pages,
extracting keywords, and caching them.

The matcher — *does this URL match a rule or a catalogue entry* — is written
as one pure function with a narrow contract (`url, rules[], catalogue →
tags[]`), independent of the DOM and of the collection. That is the piece
worth moving to Go later, if suggestions are ever wanted in the browser
extension, the add-bookmark form, or the MCP endpoint. The derivation half is
deliberately *not* duplicated server-side: two copies of the same statistic
drift, and the server has no use for it.

## Data

### The catalogue — `static/data/tag-patterns.json`

Served like `overview-features.json` and the what's-new files. Flat, versioned,
one row per tag:

```json
{
  "version": 1,
  "tags": [
    {
      "tag": "dev",
      "aliases": ["code", "programming", "development"],
      "hosts": ["github.com", "gitlab.com", "stackoverflow.com"],
      "keywords": ["repository", "compiler", "framework", "sdk"]
    }
  ]
}
```

Target is roughly 500 tags. `aliases` is what makes "your vocabulary wins"
work: a catalogue tag is renamed to whichever of its aliases you already use.
It also keeps a 500-tag vocabulary from proposing four near-synonyms for one
bookmark.

Curation is tiered: start with the tags and hosts that actually appear in this
audience's collections, grow the file afterwards. It is data, so growing it
costs nothing structurally. An unknown host yields no suggestion — never an
error. A missing or malformed file drops sources 3 and 4 and logs once;
sources 1 and 2 carry on.

### Your rules — `Settings`

Beside `Collections`, sanitised in Go the same way: `{pattern, tag}`, where
`pattern` is a host or a host plus first path segment.

### Derived keywords — the preview cache

One new field, `keywords []string`, on the existing `BookmarkPreview` entry in
`data/preview-cache.json`, keyed by the canonical URL key already used there.
Capped at twelve keywords of at most forty characters.

## The scan round

Three routes, in the shape the app already uses for long work:

| Route | Does |
|---|---|
| `POST /api/tags/scan` | Starts a round over every bookmark on every page that has no keywords yet |
| `GET /api/tags/scan` | Reports `{total, done, failed, running}` |
| `POST /api/tags/scan/stop` | Ends the round |

The panel states the cost before you start — *"312 bookmarks have no keywords
yet"* — so the number of outbound requests is never a surprise.

Fetching reuses `outboundHTTPClient` for its timeout and redirect bound and
`validateHTTPURL` for the same address rules every other outbound feature
obeys, four at a time. Extraction extends `preview_metadata.go` to read `meta
keywords`, `article:tag`, `og:section` and the first `h1`; its bounded 512 KB
head read is unchanged.

A page that cannot be read is a skip, not a failure: the round reports *"43 of
210 could not be read"* at the end and does not retry them within the round.

## The review panel

**Config → Bookmarks**, between the tag cloud and the bulk bar — beside the
cloud's existing *"Select these bookmarks"*, which is the same gesture. One
row per proposal:

```
#code   github.com/*        47 bookmarks   your own tags (8 of 10)   [ ] Apply
#video  youtube.com/*      112 bookmarks   catalogue                 [ ] Apply
#k8s    (page text)          9 bookmarks   kubernetes, helm          [ ] Apply
```

Every row says where it came from, because a suggestion you cannot account for
is one you cannot judge. Expanding a row lists the bookmarks under it. Ticking
fills `bmSelected`; applying goes through the existing `bulkTags()`, so
snapshots, the undo toast and the off-screen-selection warning all work
unchanged. The list is row-windowed, so a panel that highlights matching rows
must respect `bookmarkRowWindow`.

**Dashboard**, same engine and a smaller surface: with bookmarks selected,
multi-select offers a *Suggestions* section beside its existing tags popover,
applied through `applyTagToSelection()` and its undo.

No new mutation path is built. Bulk tagging already exists in both places;
what was missing was the proposal.

## Being asked, without being interrupted

A notice card, `tag-suggestions-notice`, defined through `NoticeCard.define()`
in the shape `health-review-notice.js` already uses:

- **Title** — *"47 bookmarks could take a tag"*.
- **Actions** — *Start* (opens the review modal), *Not today* (silent until
  tomorrow), *Remind me in 30 days*.
- **`canShow` gates** — the setting on, at least ten confident suggestions,
  not already answered today, not snoozed, and the corner free. After you apply a round it
  waits until ten *new* suggestions have accumulated, so it does not
  immediately return for the remainder of the same pile.

The card leans only on the sources that need no network — your rules, your own
tags, and the catalogue by host. A card that appeared because of page text
would be implicitly asking for a scan round, which is the thing the button was
put there to keep deliberate.

### Switching the offer off

Two checkboxes in **Behavior → General**, in the *Onboarding* group where
`enableSessionTips` already lives — the one group that collects the cards
which appear on their own. Both default to on, and both are real settings
fields rather than panel-local checkboxes, because only registered fields turn
up in the *Find settings* search.

| Setting | Default | Gates |
|---|---|---|
| `enableTagSuggestionNotice` | on | the new tag-suggestions card |
| `enableHealthReviewNotice` | on | the existing link-review card |

The health card has no switch today — it only falls silent when health itself
is off, which is a heavier thing to give up than the offer. Adding its gate is
a small change to `canShow` in `health-review-notice.js` and belongs with this
work because the two cards should be answerable in the same place.

Both keys need the backfill the other opt-out booleans use (`models.go`, where
an absent key is written as `true` on load): an existing install must keep
seeing the health card it has always seen, rather than silently losing it to a
missing field. The group's note — *"The quick-start card, the occasional
keyboard tip, and the release summary"* — is extended to say that the review
offers live there too.

**Start opens a modal** holding the review panel. That makes the panel one
component with three hosts: the section in Config → Bookmarks, the popover in
dashboard multi-select, and this modal. The modal takes the scroll lock through
`window.ScrollLock` rather than writing `body.style.overflow`, which is
refcounted for exactly this reason.

## Testing

**Go** — extraction against fixtures (keywords, `article:tag`, `og:section`, a
missing head, an oversized page); the scan round against `httptest` servers
covering 200, 404 and a timeout; the keyword and length caps; refusal of an
address `validateHTTPURL` rejects.

**JS** — the derivation as a pure function: grouping by host and by host plus
segment, the dominant-tag rule, alias mapping onto an existing tag, the
two-proposal ceiling, and a user rule beating both catalogue and derivation.

**End to end** — a scan round with routed fetches; applying a proposal and
asserting it went through the existing bulk path by checking that undo still
restores the previous tags; the notice card appearing at its threshold and
staying away below it, *Not today* silencing it for the day, *Start* opening
the modal with the same rows the Config panel shows, and each of the two
checkboxes silencing its own card while leaving the other alone. A Go test
covers the backfill: settings written before these keys existed load with both
set to true.

## Build order

Four steps, each shippable on its own:

1. **The engine and the panel in Config → Bookmarks**, on sources 1 and 2 only
   — your rules and what you already did. No fetching, no catalogue. This is
   the half that needs no network at all and already answers the original
   question.
2. **The catalogue file**, adding sources 3 and 4's host half. Pure data; the
   panel gains rows without gaining mechanism.
3. **The scan round and keyword extraction**, which turns on source 4.
4. **The dashboard surface**, reusing the engine against the current
   selection, and the notice card that offers the modal. The card comes last
   deliberately: it should only start asking once the panel behind it is worth
   opening.

## Out of scope for v1

- Any LLM, local or hosted, and any external categorisation API.
- Applying a suggestion without review, at any confidence.
- Storing page text rather than derived keywords.
- The Go matcher for the browser extension, the add-bookmark form and MCP.
  The pure-function contract is chosen so this is a later addition rather than
  a redesign.
