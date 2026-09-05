# System metrics widgets — design

**Date:** 5 September 2026
**Status:** approved for implementation planning
**Scope:** four built-in widgets (CPU, memory, disks, Docker) reading host metrics, each on its own refresh interval

---

## What this adds

Four new built-in widget types, configured like every other widget and placed
through the same block order:

| Type | Shows | Configurable |
|---|---|---|
| `cpu` | CPU percentage and load average in one tile | interval, show/hide load, per-core bars |
| `memory` | RAM total and in use, with a meter | interval, GiB or percentage emphasis |
| `disks` | free/total per filesystem, several in one tile | which mountpoints, interval, custom labels |
| `docker` | container count, running vs total | interval, split by status |

They are built-in, not custom widgets: no URL to configure, no credential, and
they appear in the Types catalogue beside Health and Uptime.

## The constraint that shapes everything

nextDash ships as a container. A container reading `/proc/meminfo` sees its own
cgroup, `statfs` sees only what is mounted into it, and there is no Docker
socket unless one is passed in. Built naively, these widgets would report on
nextDash itself — a number nobody wants — while looking like they report on the
host.

So the host is read through explicit, opt-in, read-only mounts, the convention
node-exporter and Homepage already use. Nothing is inferred and nothing is
guessed: if a source is not mounted, the widget says so plainly instead of
showing a plausible wrong number.

This was measured during design rather than assumed. A container run with
`-v /:/host/root:ro` reported **0.8 GB total** for its own rootfs and
**977.8 GB** for the mounted host filesystem — two entirely different answers
to "how much space is there". Reading the wrong one produces a number that
looks right and is not, which is the failure this whole arrangement exists to
prevent. The `/proc` mount was verified the same way: `/host/proc/meminfo` and
`/host/proc/stat` are readable inside a container in exactly the format the
parsers expect.

```yaml
# docker-compose.yml — additions, all read-only.
# On Unraid these are three Path rows and three Variable rows in the
# container template; see the Unraid section below.
volumes:
  - /proc:/host/proc:ro
  - /mnt:/host/mnt:ro,rslave          # Unraid/NAS: the array, cache and shares
  - /var/run/docker.sock:/var/run/docker.sock:ro
environment:
  - NEXTDASH_HOST_PROC=/host/proc
  - NEXTDASH_HOST_ROOT=/host/mnt
  - NEXTDASH_DOCKER_SOCKET=/var/run/docker.sock
```

Each variable is independent and each is optional, following the existing
`ResolveDataDir` convention (`internal/app/data_dir.go:11`): set, it is used;
unset, the source is reported unavailable. A user who wants disk figures but
not the Docker socket adds two of the three and the container widget simply is
not offered.

`/mnt` is the Unraid and NAS case and the one the documentation leads with.
Mount `/:/host/root:ro,rslave` instead to reach paths outside the array. Running
outside a container — a plain Linux server with the binary — needs no variables
at all, since `/proc` and `/` are already the host.

### The Docker socket is a privilege, and is treated as one

Read-only access to `docker.sock` still exposes the daemon's full read API:
every container, its image, its environment, its mounts. It is off unless the
variable is set, the widget is not offered until it is, and the documentation
says what is being granted rather than only how to grant it. A user who wants a
container count without that exposure is pointed at a socket proxy.

## Architecture

### Backend: one endpoint, four sources

```
GET /api/system/metrics?want=cpu,memory,disks,docker
```

Returns only what was asked for, so a page with one memory widget does not read
disks. Response shape, per source, always including availability:

```json
{
  "cpu":    { "available": true, "percent": 12.4, "load1": 0.07, "load5": 0.15,
              "load15": 0.11, "cores": 4 },
  "memory": { "available": true, "totalBytes": 8318418944, "usedBytes": 6281429504 },
  "disks":  { "available": true, "mounts": [
                { "path": "/", "label": "System", "totalBytes": 0, "freeBytes": 0 }] },
  "docker": { "available": true, "running": 12, "total": 17, "byStatus": {} }
}
```

An unavailable source returns `{"available": false, "reason": "no-host-proc"}`
rather than zeros. The renderer prints the reason; a widget showing `0 GB free`
because a mount is missing is the failure mode this avoids.

Files, one per source, no new dependencies:

- `internal/app/system_cpu.go` — `/proc/stat` and `/proc/loadavg`
- `internal/app/system_mem.go` — `/proc/meminfo`
- `internal/app/system_disk.go` — `syscall.Statfs` per configured mountpoint,
  resolved against `NEXTDASH_HOST_ROOT`: the user configures the path as the
  host knows it (`/mnt/user`) and the server prefixes it (`/host/mnt/user`)
  when the variable is set, so nothing in the settings UI leaks the container's
  view. Unset, the path is used as given. Resolved paths are cleaned and must
  stay within the prefix, so a configured `../..` cannot escape the mount.
- `internal/app/system_docker.go` — Docker Engine API over the unix socket
- `internal/app/system_metrics.go` — the cache, the handler, availability
- `internal/app/handlers_system.go` — route wiring

**CPU percentage needs two samples.** `/proc/stat` is cumulative, so a
percentage is the delta between two reads. The server keeps the previous sample
and computes against it; the first call after startup reports `available: true`
with `percent: null`, and the widget shows load average until the second tick.
Inventing a number from one sample would be wrong, and blocking a second inside
the request would make every first paint slow.

**Docker over the socket uses stdlib only** — an `http.Client` with a
`DialContext` onto the unix socket, against `/v1.41/containers/json?all=1`.
Verified during design that this needs no Docker SDK. The API version is pinned
low enough to be widely compatible and the call is read-only.

**Caching.** One in-memory cache with a ~1s floor, shared by all callers, so
four widgets polling at 1s cause one read per source per second rather than
four. Disk reads get a longer floor (5s) because free space does not move that
fast and `statfs` on a spun-down drive can block.

**Platform targeting.** The deployment target is Linux: Unraid above all, then
Synology and other NAS boxes, and plain Linux servers. Everything here is built
for that and tested against it. macOS is a development machine only — `/proc`
does not exist there, so CPU and memory report `available: false, reason:
"unsupported-platform"`, which keeps local development honest rather than
fabricating numbers. No effort is spent making macOS or Windows report real
metrics; that is not where this runs.

### Frontend: generalising the poll gate

The refresh machinery already exists and is good — one timer per widget id in a
`Map`, stops when the tab is hidden, stops itself when its DOM body is gone
(`dashboard-render-core.js:597-654`). It is only gated to custom widgets:

```js
if (!widget || widget.type !== 'custom' || !widget.id) return;   // :598
```

That gate becomes a per-type predicate, and `tickCustomWidget`'s hardcoded
`DashboardWidgets.custom` (:638) becomes `DashboardWidgets[widget.type]`. The
timers map, the visibility check, and the self-cleaning stay exactly as they
are — this is a widening, not a rewrite, and the naming moves from
`startCustomWidgetTimer` to `startWidgetTimer` with the custom path preserved.

Interval is stored per widget as `config.refreshSeconds`, declared in both
schema tables. Bounds: **1 second minimum for CPU** (the shortest interval that
measures anything real), 2 seconds for memory and Docker, 5 for disks. Maximum
3600 everywhere. The custom widget keeps its own `ttl` field and its 30-second
floor untouched — that field is a cache expiry as well as a cadence, and
conflating the two would change custom widget behaviour.

Each widget caches its last reading on the dash object and must register in
`forgetWidgetCaches()` (`dashboard-render-core.js:723-732`), or a config change
redraws from pre-edit data.

### Why one endpoint rather than four

Four widgets on a page at 1s would otherwise be four requests per second. One
endpoint with a `want` parameter and a shared cache makes that one request,
and keeps the availability logic in a single place. The cost is a slightly
wider handler; the benefit is that adding a fifth source later does not add a
fifth route.

## Unraid, Synology and NAS specifics

Unraid is the primary target, and it differs from a plain Docker host in ways
that matter here.

**Containers are configured through templates, not compose.** An Unraid user
adds paths and variables in the Docker template UI, so the documentation must
give template rows — Config Type *Path*, Name, Container Path, Host Path,
Access Mode *Read Only* — not only a compose snippet. The three mounts and
three variables map one-to-one onto template entries, which is why each source
is an independent variable: a user can add the disk mount and skip the socket.

**The array is the point.** An Unraid box's interesting storage is `/mnt/user`
(the user share pool), `/mnt/cache` and the individual `/mnt/disk1..N`. These
are exactly what the reference dashboard's "System / Jellyfin / Files" tiles
are showing. Because mountpoints are an explicit list, an Unraid user names
`/mnt/user` and `/mnt/cache` and gets what they expect; nothing needs to know
what Unraid is. Documentation ships these as the suggested starting values.

**`/mnt` is enough, `/` is not required.** The spec's `/:/host/root:ro` mount
is the general case. On Unraid the narrower `/mnt:/host/mnt:ro` covers the
array and cache, which is what most users want and a smaller grant. The docs
lead with the narrow mount and mention the broad one for people who want the
boot device or a non-array path.

**Free space on a user share is not a plain `statfs`.** `/mnt/user` is a FUSE
overlay across array disks; `statfs` on it reports the pool total, which is the
number Unraid's own dashboard shows and the one users expect. Individual
`/mnt/diskN` paths report per-disk. Both work through the same code path — this
is noted so nobody later "fixes" the pool number into a per-disk sum.

**Synology and QNAP** run Docker with volumes configured through their own UI,
and their shares live under `/volume1`, `/volume2`. The same explicit-list
design covers them without special-casing.

**Unraid's Docker socket** sits at the standard `/var/run/docker.sock`, so the
container widget needs no platform-specific handling — only the same opt-in.

## Widget settings

Every field is declared twice — Go `widgetFields` (`widgets_config.go:80`) and
JS `WIDGET_SETTINGS` (`dashboard-config.js:15335`) — because the two tables are
deliberate mirrors and a field in one but not the other is a bug that shows
immediately.

```go
WidgetTypeCPU: {
    {Key: "refreshSeconds", Kind: "int", Min: 1, Max: 3600},
    {Key: "showLoad", Kind: "bool"},
    {Key: "showCores", Kind: "bool"},
},
WidgetTypeMemory: {
    {Key: "refreshSeconds", Kind: "int", Min: 2, Max: 3600},
    {Key: "display", Kind: "string", Allowed: []string{"bytes", "percent"}},
},
WidgetTypeDisks: {
    {Key: "refreshSeconds", Kind: "int", Min: 5, Max: 3600},
    {Key: "mounts", Kind: "list"},
    {Key: "showMeter", Kind: "bool"},
},
WidgetTypeDocker: {
    {Key: "refreshSeconds", Kind: "int", Min: 2, Max: 3600},
    {Key: "splitByStatus", Kind: "bool"},
},
```

**Mountpoints are an explicit list, never automatic.** A container sees dozens
of overlay and tmpfs mounts; enumerating them would produce a tile of noise.
The user names the paths they care about — `/`, `/mnt/media`, `/mnt/files` —
and may label each one, which is what makes "System / Jellyfin / Files" read as
it does in the reference dashboard. On Unraid that list is typically
`/mnt/user` and `/mnt/cache`; on Synology, `/volume1`. An empty list falls back
to the data directory's filesystem, which is the one mount nextDash certainly
has.

## Registration checklist

Each new type touches eleven places. Two of them fail loudly, which is a
feature: `widgetTypeNames()` panics at runtime if a type is missing
(`widgets_config.go:378`), and `tests/dashboard-widgets-ring0.spec.js:44-47`
asserts every offered type declares settings.

1. `internal/app/widgets.go` — type constant and `knownWidgetTypes`
2. `internal/app/widgets_config.go:357` — `widgetTypeNames` ordered slice
3. `internal/app/widgets_config.go:80` — `widgetFields` schema
4. `static/js/dashboard/dashboard-widget-<type>.js` — the renderer
5. `templates/dashboard.html:439` — the script tag
6. `dashboard-config.js:15318` — `WIDGET_TYPES`
7. `dashboard-config.js:15335` — `WIDGET_SETTINGS`
8. `dashboard-config.js:13411` — `WIDGET_TYPE_GROUPS` (a new `system` group)
9. `dashboard-config.js:16988` — `widgetTypeAbout` description
10. `locales/{en,nl,de,fr,zh}.json` — type name, about text, widget strings
11. `internal/app/asset_hashes_gen.go` — via `go generate`

## Testing

**Go, table-driven against fixtures.** `/proc/stat`, `/proc/meminfo` and
`/proc/loadavg` are plain text files, so the parsers take a root path and the
tests point it at a fixture directory. This makes the Linux-only code fully
testable on macOS — verified during design. Covered: a normal read, a
cumulative-delta CPU percentage across two samples, the first-sample null case,
a malformed file, a missing file, and unavailable-source reporting.

The Docker source is tested against a stub unix socket serving a canned JSON
array, which exercises the dial path and the counting without needing a daemon.
`statfs` is tested against the real filesystem for sanity (total > 0, free ≤
total) rather than exact numbers.

**Playwright.** Route-intercept `/api/system/metrics` so the tests never depend
on the host: assert each widget renders its numbers, that an `available: false`
response prints the reason rather than zeros, that the settings panel writes
`refreshSeconds`, and that one widget keeps exactly one timer across a redraw
(the existing `customWidgetTimerCount` assertion, widened).

Every fix gets falsified — the fix reverted, the test confirmed to fail.

## Documentation

Per the release convention: CHANGELOG, MANUAL, Config → Help in five locales,
and the What's New entry once a version is set. The compose files gain the
mounts commented out, with the Docker socket carrying a note about what
read-only access still exposes.

The MANUAL section is written for the actual audience — an Unraid user adding
a container through the template UI — and gives, in this order: the three
template Path rows with Access Mode Read Only, the three Variable rows, the
suggested mountpoint list (`/mnt/user`, `/mnt/cache`), and a plain statement of
what the Docker socket grants. A compose snippet follows for Synology, plain
Docker and bare-metal Linux. Someone who reads only the first screen should be
able to finish the setup.

## Deliberately not in scope

- **Network throughput and temperature.** The reference dashboard shows them;
  they are separate sources with their own edge cases, and this is already four
  widgets and a new subsystem.
- **Per-container detail.** The Docker widget counts. Listing containers, their
  health, or controlling them is a different feature with a much larger surface.
- **Historical graphs.** These widgets show now. Trend storage is its own design.
- **Alerting on thresholds.** No notifications when a disk fills.
- **Auto-discovery of mountpoints.** Explained above: explicit beats noisy.

## Risks

- **The Docker socket is the sharpest edge.** Mitigated by being off by default,
  documented honestly, and pointed at a proxy for the cautious.
- **`/:/host/root:ro` mounts the whole host filesystem read-only.** It is how
  free space per mount is reached; `rslave` propagation keeps later host mounts
  visible. Users who only care about one disk can mount just that path.
- **A 1-second poll on a Raspberry Pi** is four reads of small `/proc` files per
  second, which is negligible — but the floor exists so it cannot go lower, and
  polling stops entirely when the tab is hidden.
- **Docker socket reachability is proven.** Tested against a live daemon during
  design: an `http.Client` with a unix `DialContext` reached `v1.41`
  `/containers/json?all=1`, returned 200, and counted `running=1 total=1`
  matching `docker ps -a` — stdlib only, no SDK. The remaining unknown is
  Unraid's own daemon, which should behave identically on the same API version.
- **The socket path varies by platform.** Docker Desktop uses
  `~/.docker/run/docker.sock`, not `/var/run/docker.sock`; Unraid and most Linux
  hosts use the latter. This is why the path is a variable rather than a
  constant, and why the documentation tells the reader to check `docker context
  ls` rather than assuming.
