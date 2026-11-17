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

async function mockDocker(page, { control = true, socket = true, containers = null, usage = false, history = null, compose = null, composeStatus = null } = {}) {
  const state = {
    control, socket, usage, history, compose, composeStatus, calls: [],
    containers: containers || [
      { id: 'a'.repeat(64), shortId: 'a'.repeat(12), name: 'sonarr', image: 'lscr.io/linuxserver/sonarr:latest', tag: 'latest',
        state: 'running', status: 'Up 6 days (healthy)', health: 'healthy', created: 1790000000,
        ports: [{ private: 8989, public: 8989, type: 'tcp' }], composeProject: 'arr', composeService: 'sonarr',
        update: { status: 'available', checkedAt: Date.now() } },
      { id: 'b'.repeat(64), shortId: 'b'.repeat(12), name: 'jellyfin', image: 'jellyfin/jellyfin:10.10', tag: '10.10',
        state: 'running', status: 'Up 12 days', health: '', created: 1790000000,
        ports: [{ private: 8096, public: 8096, type: 'tcp' }], composeProject: 'media', composeService: 'jellyfin' },
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
      self: 'd'.repeat(12), selfName: state.socket ? 'nextdash' : '', writeToken: Boolean(state.writeToken),
      // state.composeStatus: the `compose` block of the status answer (the folders map and what was refused).
      compose: state.composeStatus || { map: [], rejected: [] } });
    // A stack's files: state.compose is the answer, per project; the value route answers 'hunter2'.
    // Phase 2 (docs/compose-management-implementation.md 1.2-1.5): raw, PUT, backups, restore, run.
    //   state.composeRaw[id]      raw text; defaults to the file's content
    //   state.composeBackups[id]  [{stamp,size}], newest first
    //   state.composeSaveReply    {status, body} to force the next save's answer once
    //   state.composeRun[action]  {fail:true, tail:[...]} to make a run fail
    // Round 2: state.composeCheck {fail:true, line, column, tail} makes Check fail; state.composeBackupRaw[stamp]
    // is a backup's text; state.composeLogs is the stack log (NDJSON lines {t,s,m,service,container}).
    // A save containing the word INVALID answers 422 compose-yaml at that line and column.
    if (path.startsWith('/compose/')) {
      const m = path.match(/^\/compose\/([^/]+)\/(files(?:\/value|\/raw)?|backups(?:\/([^/]+)\/(restore|raw))?|check|logs\/stream|up|down|pull|restart|update)$/);
      const answer = m && state.compose && state.compose[m[1]];
      if (!answer) return json({ error: 'not found' }, 404);
      const fileId = url.searchParams.get('file');
      const fileOf = () => (answer.files || []).find((f) => f.id === fileId);
      const rawOf = () => (state.composeRaw && state.composeRaw[fileId] !== undefined ? state.composeRaw[fileId] : (fileOf()?.content ?? ''));
      const what = m[2];
      if (what === 'files/value') {
        state.valueHeaders = req.headers();
        state.valueQueries = [...(state.valueQueries || []), url.search];
        return json({ file: fileId, key: url.searchParams.get('key'), value: 'hunter2' });
      }
      if (what === 'files/raw') {
        if (!fileOf()) return json({ reason: 'not-found' }, 404);
        return json({ file: fileId, content: rawOf(), sha256: fileOf().sha256 });
      }
      if (what === 'files' && req.method() === 'PUT') {
        const body = JSON.parse(req.postData() || '{}');
        state.composeSaves = [...(state.composeSaves || []), { file: fileId, ...body }];
        if (!state.control) return json({ reason: 'docker-control-off' }, 403);
        if (state.composeSaveReply) {
          const r = state.composeSaveReply;
          state.composeSaveReply = null;
          return json(r.body, r.status);
        }
        const f = fileOf();
        if (body.sha256 !== f.sha256) return json({ reason: 'compose-stale', sha256: f.sha256 }, 409);
        const lines = String(body.content).split('\n');
        const bad = lines.findIndex((l) => l.includes('INVALID'));
        if (bad >= 0) return json({ reason: 'compose-yaml', line: bad + 1, column: 3, message: 'mapping values are not allowed here' }, 422);
        const sha = `sha${(state.composeSaves || []).length}0000000000`;
        state.composeBackups = { ...(state.composeBackups || {}), [fileId]: [{ stamp: '20261116T101500Z', size: f.size }, ...((state.composeBackups || {})[fileId] || [])] };
        f.content = body.content;
        f.sha256 = sha;
        state.composeRaw = { ...(state.composeRaw || {}), [fileId]: body.content };
        return json({ ok: true, sha256: sha, backup: '20261116T101500Z', warnings: [] });
      }
      if (what === 'files') {
        state.composeFilesCalls = (state.composeFilesCalls || 0) + 1;
        return json(answer);
      }
      if (what.startsWith('backups')) {
        if (m[4] === 'raw') return json({ file: fileId, stamp: m[3], content: (state.composeBackupRaw || {})[m[3]] ?? '' });
        if (m[3]) {
          state.composeRestores = [...(state.composeRestores || []), { file: fileId, stamp: m[3], body: JSON.parse(req.postData() || '{}') }];
          return json({ ok: true, sha256: 'restored0000000', backup: '20261116T111500Z', restored: m[3] });
        }
        return json({ file: fileId, backups: (state.composeBackups || {})[fileId] || [] });
      }
      if (what === 'check' && req.method() === 'POST') {
        state.composeChecks = (state.composeChecks || 0) + 1;
        state.composeCheckBodies = [...(state.composeCheckBodies || []), req.postData() ? JSON.parse(req.postData()) : null];
        if (state.composeCheck && state.composeCheck.status) return json({ reason: state.composeCheck.reason || 'compose-too-large' }, state.composeCheck.status);
        if (state.composeCheck && state.composeCheck.fail) {
          const c = state.composeCheck;
          return json({ reason: 'compose-invalid', exitCode: 15, tail: c.tail || ['yaml: line 3: could not find expected \':\''], line: c.line, column: c.column }, 422);
        }
        return json({ ok: true });
      }
      if (what === 'logs/stream') {
        // Every connection is recorded (its query string says `since` on a reconnect). The first one
        // gets state.composeLogs, later ones state.composeLogsNext (default: nothing).
        state.composeLogRequests = [...(state.composeLogRequests || []), url.search];
        const lines = (state.composeLogRequests.length === 1 ? state.composeLogs : state.composeLogsNext) || [];
        return route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: lines.map((l) => JSON.stringify(l)).join('\n') + '\n' });
      }
      // up, down, pull, restart, update: the NDJSON the run route streams (dockerProgressEvent), last line the result.
      if (['up', 'down', 'pull', 'restart', 'update'].includes(what) && req.method() === 'POST') {
        const svc = url.searchParams.get('service');
        state.composeRuns = [...(state.composeRuns || []), `${what}${svc ? `/${svc}` : ''}?${url.searchParams.get('stream') === '1' ? 'stream=1' : ''}`];
        if (!state.control) return json({ reason: 'docker-control-off' }, 403);
        if (answer.self) return json({ reason: 'docker-self' }, 403);
        if (answer.state === 'compose-no-labels') return json({ reason: 'compose-no-labels' }, 409);
        const fail = state.composeRun && state.composeRun[what] && state.composeRun[what].fail;
        const at = Date.now();
        const step = (s, st) => ({ type: 'step', step: s, state: st, at });
        const lines = [step('image', 'start'), step('image', 'done')];
        if (what === 'up' || what === 'update') lines.push(step('validate', 'start'), step('validate', 'done'));
        lines.push(step('run', 'start'), { type: 'log', text: `${what} ${m[1]}: first line`, at }, { type: 'log', text: `${what} ${m[1]}: second line`, at });
        // The helper is removed inside the run step, so cleanup comes before run's own done/fail.
        if (fail) {
          const tail = state.composeRun[what].tail || ['service db: exited with code 1'];
          lines.push(step('cleanup', 'start'), step('cleanup', 'done'), step('run', 'fail'),
            { type: 'result', status: 502, body: { reason: 'compose-failed', exitCode: 1, tail }, at });
        } else {
          lines.push(step('cleanup', 'start'), step('cleanup', 'done'), step('run', 'done'),
            { type: 'result', status: 200, body: { ok: true, action: what, exitCode: 0 }, at });
        }
        return route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: lines.map((l) => JSON.stringify(l)).join('\n') + '\n' });
      }
      return json({ reason: 'unknown' }, 404);
    }
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
    // The last thirty days of the whole host, as Config -> Statistics -> Server reads them.
    if (path === '/history' && state.history) {
      const disk = state.disk || mockDisk();
      return json({ events: state.history.history, updates: [...state.history.updates].reverse(), disk: disk.totals || null,
        diskAt: Date.now(), days: 30 });
    }
    if (path === '/binds/measure' && req.method() === 'POST') {
      if (!state.control) return json({ reason: 'docker-control-off' }, 403);
      const { source } = JSON.parse(req.postData() || '{}');
      state.measured = [...(state.measured || []), source];
      return json({ ok: true, source, bytes: 3 * 1073741824, at: Date.now() });
    }
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
      if (state.history) return json({ entries: state.history.timeline(c.name) });
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
      if (sub === 'update' && url.searchParams.get('stream') === '1') {
        // The steps as the real route streams them (docker_progress.go); a
        // name in state.updateFails fails at create and is put back.
        const fails = state.updateFails?.has(c.name);
        const at = Date.now();
        const step = (s, st) => ({ type: 'step', step: s, state: st, at });
        const lines = [step('check', 'start'), step('check', 'done'), step('pull', 'start'),
          { type: 'log', text: `pull ${c.image}`, at }, { type: 'log', text: 'layer 1a2b complete (1/1)', at },
          step('pull', 'done'), step('compare', 'start'), step('compare', 'done'),
          step('stop', 'start'), step('stop', 'done'), step('rename', 'start'), step('rename', 'done'), step('create', 'start')];
        let result;
        if (fails) {
          lines.push(step('create', 'fail'), { type: 'log', text: 'create failed: conflicting options', at },
            step('restore', 'start'), step('restore', 'done'));
          result = { ok: true, state: 'running', update: { phase: 'rolled-back', failedStep: 'create' } };
        } else {
          lines.push(step('create', 'done'), step('connect', 'start'), step('connect', 'done'),
            step('start', 'start'), step('start', 'done'), step('remove', 'start'), step('remove', 'done'));
          c.update = { status: 'current' };
          result = { ok: true, state: 'running', update: { phase: 'done' } };
        }
        lines.push({ type: 'result', status: 200, body: result, at });
        return route.fulfill({ status: 200, contentType: 'application/x-ndjson',
          body: lines.map((l) => JSON.stringify(l)).join('\n') + '\n' });
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
module.exports = { mockDocker, mockDisk };
