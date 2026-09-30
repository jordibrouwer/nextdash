// Mocks every /api/docker route with one in-memory daemon, so specs drive the
// real UI without a Docker socket. Returns the state so a spec can assert on
// what the UI sent.
const MiB = 1048576;
/** A disk report: sonarr's previous image is untagged and still its way back. */
function mockDisk() {
  return {
    images: [
      { id: 'sha256:new', tags: ['lscr.io/linuxserver/sonarr:latest'], size: 412 * MiB, usedBy: ['sonarr'], dangling: false },
      { id: 'sha256:old1234567890ab', tags: [], size: 398 * MiB, usedBy: [], dangling: true, rollbackFor: ['sonarr'] },
      { id: 'sha256:pg', tags: ['postgres:15'], size: 379 * MiB, usedBy: [], dangling: false },
    ],
    volumes: [
      { name: 'old_pgdata', driver: 'local', size: 171 * MiB, usedBy: [] },
      { name: 'arr_config', driver: 'local', size: 96 * MiB, usedBy: ['radarr', 'sonarr'] },
    ],
    binds: [
      { source: '/mnt/user/appdata/sonarr', usedBy: [{ container: 'sonarr', destination: '/config' }] },
      { source: '/mnt/user/media', usedBy: [{ container: 'jellyfin', destination: '/media' }, { container: 'sonarr', destination: '/tv' }] },
    ],
    totals: { images: 1189 * MiB, imagesUnused: 777 * MiB, imagesUnusedCount: 2, dangling: 398 * MiB, danglingCount: 1,
      buildCache: 300 * MiB, buildCacheCount: 2, volumes: 267 * MiB, volumesUnused: 171 * MiB, volumesUnusedCount: 1,
      reclaimable: 1248 * MiB, containersStopped: 2 * MiB, containersStoppedCount: 1 },
    stopped: ['bazarr'],
  };
}

async function mockDocker(page, { control = true, socket = true, containers = null, usage = false } = {}) {
  const state = {
    control, socket, usage, calls: [],
    containers: containers || [
      { id: 'a'.repeat(64), shortId: 'a'.repeat(12), name: 'sonarr', image: 'lscr.io/linuxserver/sonarr:latest', tag: 'latest',
        state: 'running', status: 'Up 6 days (healthy)', health: 'healthy', created: 1790000000,
        ports: [{ private: 8989, public: 8989, type: 'tcp' }], composeProject: 'arr',
        update: { status: 'available', checkedAt: Date.now() } },
      { id: 'b'.repeat(64), shortId: 'b'.repeat(12), name: 'jellyfin', image: 'jellyfin/jellyfin:10.10', tag: '10.10',
        state: 'running', status: 'Up 12 days', health: '', created: 1790000000,
        ports: [{ private: 8096, public: 8096, type: 'tcp' }], composeProject: 'media' },
      { id: 'c'.repeat(64), shortId: 'c'.repeat(12), name: 'bazarr', image: 'linuxserver/bazarr', tag: 'latest',
        state: 'exited', status: 'Exited (0) 2 hours ago', health: '', created: 1790000000, ports: [] },
      { id: 'd'.repeat(64), shortId: 'd'.repeat(12), name: 'nextdash', image: 'ghcr.io/jordibrouwer/nextdash:latest', tag: 'latest',
        state: 'running', status: 'Up 1 hour', health: '', created: 1790000000, ports: [{ private: 8080, public: 8080, type: 'tcp' }], self: true },
    ],
  };
  const find = (key) => state.containers.find((c) => c.name === key || c.id.startsWith(key));
  await page.route('**/api/docker/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace('/api/docker', '');
    state.calls.push(`${req.method()} ${path}`);
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/status') return json({ socket: state.socket, control: state.control, reason: state.socket ? '' : 'no-docker-socket',
      self: 'd'.repeat(12), selfName: state.socket ? 'nextdash' : '', writeToken: Boolean(state.writeToken) });
    if (path === '/github-token') {
      if (req.method() === 'PUT') state.githubToken = true;
      if (req.method() === 'DELETE') state.githubToken = false;
      return json({ set: Boolean(state.githubToken) });
    }
    if (path === '/containers') {
      // usage: the stats sampler's latest reading on each running container,
      // as the real list carries it with Config -> Containers' history on.
      const readings = { sonarr: { cpu: 3.2, mem: 262144000 }, jellyfin: { cpu: 41.7, mem: 1395864371 }, nextdash: { cpu: 0.4, mem: 39845888 } };
      const list = state.socket ? state.containers.map((c) => (state.usage && c.state === 'running' && (c.usage || readings[c.name])
        ? { ...c, usage: c.usage || readings[c.name] } : c)) : [];
      return json({ available: state.socket, containers: list, usageEnabled: state.usage });
    }
    if (path === '/updates') return json({ checkedAt: Date.now() - 3 * 3600e3, images: {} });
    if (path === '/updates/check') return json({ checkedAt: Date.now(), images: {} });
    // Disk: what images and volumes take, pruning, and one volume at a time.
    if (path === '/disk') return json(state.disk || mockDisk());
    if (path.startsWith('/prune/') && req.method() === 'POST') {
      if (!state.control) return json({ reason: 'docker-control-off' }, 403);
      return json({ ok: true, kind: path.slice('/prune/'.length), removed: 1, reclaimed: 398 * 1048576 });
    }
    if (path.startsWith('/volumes/') && req.method() === 'DELETE') {
      if (!state.control) return json({ reason: 'docker-control-off' }, 403);
      const name = decodeURIComponent(path.slice('/volumes/'.length));
      state.volumeDeletes = [...(state.volumeDeletes || []), `${name}?confirm=${url.searchParams.get('confirm')}`];
      if (url.searchParams.get('confirm') !== name) return json({ reason: 'confirm-name' }, 400);
      return json({ ok: true });
    }
    // Skip and hold, applied to every container on the image as the server does.
    if (path === '/updates/choice' && req.method() === 'POST') {
      const { image, choice } = JSON.parse(req.postData() || '{}');
      state.choices = [...(state.choices || []), { image, choice }];
      state.containers.filter((x) => x.image === image).forEach((x) => {
        const u = { ...(x.update || { status: 'current' }) };
        const offered = u.status === 'available' || u.status === 'skipped' || u.status === 'held';
        if (choice === 'skip') u.skippedDigest = 'sha256:r1';
        if (choice === 'unskip') delete u.skippedDigest;
        if (choice === 'hold') u.held = true;
        if (choice === 'unhold') delete u.held;
        if (offered) u.status = u.held ? 'held' : (u.skippedDigest ? 'skipped' : 'available');
        x.update = u;
      });
      return json(state.containers.find((x) => x.image === image)?.update || {});
    }
    const m = path.match(/^\/containers\/([^/]+)(?:\/(.+))?$/);
    const c = m && find(decodeURIComponent(m[1]));
    if (!c) return json({ reason: 'not-found' }, 404);
    const sub = m[2] || '';
    if (req.method() === 'GET' && sub === '') return json({ ...c, startedAt: '2026-09-20T10:00:00Z', restartPolicy: 'unless-stopped',
      mounts: [{ type: 'bind', source: '/mnt/user/appdata/sonarr', destination: '/config', readOnly: false }],
      networks: [{ name: 'bridge', ip: '172.17.0.5' }], envNames: ['API_KEY', 'PUID'], version: '4.0.9',
      source: 'https://github.com/linuxserver/docker-sonarr', updateHistory: c.updateHistory || [], rollback: c.rollback || undefined });
    if (sub.startsWith('env/')) return json({ name: sub.slice(4), value: 'secret-value' });
    if (sub === 'stats') return json({ cpuPercent: 3.2, memoryUsed: 262144000, memoryLimit: 8589934592 });
    if (sub === 'logs') return json({ lines: ['line one', 'line two'] });
    if (sub === 'timeline') {
      if (c.name !== 'sonarr') return json({ entries: [] });
      const t = (h) => Date.parse('2026-09-29T10:00:00Z') + h * 3600e3;
      return json({ entries: [
        { at: t(5), kind: 'update', detail: '4.0.9 → 4.0.10' },
        { at: t(4), kind: 'restart-loop', detail: '5 times in 4 min, last exit code 1', count: 5 },
        { at: t(3), kind: 'unhealthy' },
        { at: t(2), kind: 'crash', detail: 'out of memory (exit code 137)' },
        { at: t(1), kind: 'stop', detail: 'by nextDash' },
        { at: t(0), kind: 'start' },
      ] });
    }
    if (sub === 'health') {
      if (!c.health) return json({ status: '', failingStreak: 0, command: '', checks: [] });
      return json({ status: c.health, failingStreak: c.health === 'healthy' ? 0 : 2, command: 'curl -f http://localhost:8989/ping',
        checks: [
          { start: '2026-09-29T10:01:00Z', end: '2026-09-29T10:01:01Z', exitCode: 1, output: 'curl: (7) Failed to connect' },
          { start: '2026-09-29T10:00:00Z', end: '2026-09-29T10:00:01Z', exitCode: 0, output: 'pong' },
        ] });
    }
    if (sub === 'changelog') return json({ current: '4.0.9', releases: [{ tag: 'v4.0.10', name: '4.0.10', body: '## Fixes\n- one fix\nhttps://example.com/x', url: 'https://github.com/x/y/releases/v4.0.10', published: '2026-09-24T00:00:00Z' }],
      links: [{ kind: 'source', url: 'https://github.com/linuxserver/docker-sonarr' }, { kind: 'registry', url: 'https://docs.linuxserver.io/images/docker-sonarr' }] });
    if (req.method() === 'POST') {
      if (!state.control) return json({ reason: 'docker-control-off' }, 403);
      if (c.self && ['stop', 'remove', 'update', 'pause', 'restart'].includes(sub)) return json({ reason: 'docker-self' }, 403);
      const next = { start: 'running', stop: 'exited', restart: 'running', pause: 'paused', unpause: 'running' }[sub];
      if (next) { c.state = next; return json({ ok: true, state: next }); }
      if (sub === 'remove') {
        if (c.state === 'running') return json({ reason: 'running' }, 409);
        state.containers = state.containers.filter((x) => x !== c); return json({ ok: true });
      }
      if (sub === 'update') { c.update = { status: 'current' }; return json({ ok: true, state: 'running', update: { phase: 'done' } }); }
      if (sub === 'rollback') {
        if (!c.rollback) return json({ reason: 'no-rollback' }, 409);
        c.rollback = undefined;
        return json({ ok: true, state: 'running', update: { phase: 'done' } });
      }
    }
    return json({ reason: 'unknown' }, 404);
  });
  return state;
}
module.exports = { mockDocker };
