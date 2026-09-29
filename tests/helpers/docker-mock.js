// Mocks every /api/docker route with one in-memory daemon, so specs drive the
// real UI without a Docker socket. Returns the state so a spec can assert on
// what the UI sent.
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
    const m = path.match(/^\/containers\/([^/]+)(?:\/(.+))?$/);
    const c = m && find(decodeURIComponent(m[1]));
    if (!c) return json({ reason: 'not-found' }, 404);
    const sub = m[2] || '';
    if (req.method() === 'GET' && sub === '') return json({ ...c, startedAt: '2026-09-20T10:00:00Z', restartPolicy: 'unless-stopped',
      mounts: [{ type: 'bind', source: '/mnt/user/appdata/sonarr', destination: '/config', readOnly: false }],
      networks: [{ name: 'bridge', ip: '172.17.0.5' }], envNames: ['API_KEY', 'PUID'], version: '4.0.9',
      source: 'https://github.com/linuxserver/docker-sonarr' });
    if (sub.startsWith('env/')) return json({ name: sub.slice(4), value: 'secret-value' });
    if (sub === 'stats') return json({ cpuPercent: 3.2, memoryUsed: 262144000, memoryLimit: 8589934592 });
    if (sub === 'logs') return json({ lines: ['line one', 'line two'] });
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
    }
    return json({ reason: 'unknown' }, 404);
  });
  return state;
}
module.exports = { mockDocker };
