/**
 * Glances view, Disks: usage per mount point, disk I/O rates, and -- only when
 * the host runs them and they answered with data -- SMART and RAID blocks.
 * An empty or unavailable plugin leaves its block out altogether; there is
 * no heading over nothing.
 */
(function () {
    'use strict';

    /**
     * Filesystems that are not a disk someone would want a bar for: the same
     * types and mount points the tile's answer leaves out (glancesIsPseudo in
     * widgets_glances.go), plus a few more types Go never sees as rows.
     */
    const PSEUDO_FS = new Set(['tmpfs', 'devtmpfs', 'overlay', 'squashfs', 'proc', 'sysfs', 'cgroup', 'cgroup2', 'devpts', 'ramfs']);
    const PSEUDO_MOUNTS = ['/snap', '/run', '/sys', '/proc', '/dev'];

    function el(tag, className, content) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (content !== undefined) node.textContent = content;
        return node;
    }

    function str(value) {
        return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
    }

    function isPseudo(row) {
        if (PSEUDO_FS.has(str(row.fs_type).toLowerCase())) return true;
        const mount = str(row.mnt_point);
        return PSEUDO_MOUNTS.some((prefix) => mount === prefix || mount.startsWith(`${prefix}/`));
    }

    /** The real filesystems in an fs answer; rows that are not objects are dropped first. */
    function realFilesystems(body) {
        const rows = window.DashboardGlances.usable(body);
        return Array.isArray(rows) ? rows.filter((r) => r && typeof r === 'object' && !Array.isArray(r) && !isPseudo(r)) : [];
    }

    class GlancesDisks {
        constructor(view) {
            this.view = view;
        }

        /** The optional plugins are only read when the host runs them. */
        endpoints() {
            const plugins = this.view.plugins;
            const list = ['fs', 'diskio'];
            ['smart', 'raid'].forEach((p) => {
                if (!plugins || plugins.has(p)) list.push(p);
            });
            return list;
        }

        render(container, data) {
            const G = window.DashboardGlances;
            const v = this.view;
            const parts = [];
            const fsRows = realFilesystems(data.fs);
            const ioRows = Array.isArray(G.usable(data.diskio)) ? data.diskio.filter((r) => r && typeof r === 'object') : [];

            if (fsRows.length) parts.push(this.usage(fsRows));
            if (ioRows.length) parts.push(this.io(ioRows));
            const smart = this.smart(G.usable(data.smart));
            if (smart) parts.push(smart);
            const raid = this.raid(G.usable(data.raid));
            if (raid) parts.push(raid);

            if (!parts.length) {
                parts.push(el('p', 'glances-note', v.t('dashboard.glancesNotAvailable', 'Not available on this host.')));
            }
            container.replaceChildren(...parts);
        }

        block(kind, title) {
            const section = el('section', 'glances-block');
            section.setAttribute('data-glances-block', kind);
            section.appendChild(el('h3', 'glances-block-title', title));
            return section;
        }

        usage(rows) {
            const G = window.DashboardGlances;
            const section = this.block('usage', this.view.t('dashboard.glancesDisksUsage', 'Usage'));
            rows.forEach((r) => {
                const mount = str(r.mnt_point) || str(r.device_name);
                const pct = G.num(r.percent);
                const used = G.num(r.used);
                const size = G.num(r.size);
                const row = el('div', 'glances-disk');
                row.setAttribute('data-glances-fs', mount);
                const head = el('div', 'glances-disk-head');
                const meta = [str(r.device_name), str(r.fs_type)].filter(Boolean).join(' · ');
                head.append(
                    el('span', 'glances-disk-mount', mount || G.DASH),
                    el('span', 'glances-disk-meta', meta),
                    el('span', 'glances-disk-value', pct === null ? G.DASH : `${Math.round(pct)}%`),
                );
                const bar = el('div', 'glances-disk-bar');
                bar.setAttribute('role', 'meter');
                bar.setAttribute('aria-valuemin', '0');
                bar.setAttribute('aria-valuemax', '100');
                const fill = el('span', 'glances-disk-fill');
                if (pct !== null) {
                    bar.setAttribute('aria-valuenow', String(Math.round(pct)));
                    fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
                    const tone = G.tone(pct);
                    if (tone) bar.setAttribute('data-tone', tone);
                }
                bar.appendChild(fill);
                const sizes = used !== null && size !== null ? `${G.formatBytes(used)} / ${G.formatBytes(size)}` : '';
                row.append(head, bar, el('span', 'glances-disk-sizes', sizes));
                section.appendChild(row);
            });
            return section;
        }

        io(rows) {
            const G = window.DashboardGlances;
            const v = this.view;
            const rate = (n) => (n === null ? G.DASH : `${G.formatBytes(n)}/s`);
            const section = this.block('diskio', v.t('dashboard.glancesDisksIo', 'Disk I/O'));
            const table = el('table', 'glances-table');
            const head = el('tr');
            [v.t('dashboard.glancesDiskName', 'Disk'), v.t('dashboard.glancesIoRead', 'Read'), v.t('dashboard.glancesIoWrite', 'Write')]
                .forEach((label) => {
                    const th = el('th', '', label);
                    th.scope = 'col';
                    head.appendChild(th);
                });
            const thead = el('thead');
            thead.appendChild(head);
            const tbody = el('tbody');
            rows.forEach((r) => {
                const name = str(r?.disk_name);
                const tr = el('tr');
                tr.setAttribute('data-glances-diskio', name);
                tr.append(
                    el('td', 'glances-io-name', name || G.DASH),
                    el('td', 'glances-io-read', rate(G.num(r?.read_bytes_rate_per_sec))),
                    el('td', 'glances-io-write', rate(G.num(r?.write_bytes_rate_per_sec))),
                );
                tbody.appendChild(tr);
            });
            table.append(thead, tbody);
            section.appendChild(table);
            return section;
        }

        /** The drives Glances read SMART from; null when it sent none. */
        smart(body) {
            const G = window.DashboardGlances;
            const v = this.view;
            if (!Array.isArray(body) || !body.length) return null;
            const section = this.block('smart', v.t('dashboard.glancesDisksSmart', 'SMART'));
            body.forEach((drive) => {
                if (!drive || typeof drive !== 'object') return;
                const attrs = Object.entries(drive)
                    .filter(([k, a]) => /^\d+$/.test(k) && a && typeof a === 'object')
                    .map(([, a]) => a);
                const details = el('details', 'glances-smart');
                details.setAttribute('data-glances-smart', str(drive.DeviceName));
                const model = str(drive['Device Model']) || str(drive['Model Family']);
                const summary = el('summary', '', [str(drive.DeviceName) || G.DASH, model].filter(Boolean).join(' · '));
                details.appendChild(summary);
                if (attrs.length) {
                    const table = el('table', 'glances-table');
                    const head = el('tr');
                    ['dashboard.glancesSmartAttr:Attribute', 'dashboard.glancesSmartValue:Value', 'dashboard.glancesSmartWorst:Worst',
                        'dashboard.glancesSmartThreshold:Threshold', 'dashboard.glancesSmartRaw:Raw'].forEach((spec) => {
                        const [key, fallback] = spec.split(':');
                        const th = el('th', '', v.t(key, fallback));
                        th.scope = 'col';
                        head.appendChild(th);
                    });
                    const thead = el('thead');
                    thead.appendChild(head);
                    const tbody = el('tbody');
                    attrs.forEach((a) => {
                        const tr = el('tr');
                        const cell = (x) => el('td', '', str(x) || G.DASH);
                        tr.append(cell(a.name), cell(a.value), cell(a.worst), cell(a.threshold), cell(a.raw));
                        tbody.appendChild(tr);
                    });
                    table.append(thead, tbody);
                    details.appendChild(table);
                }
                section.appendChild(details);
            });
            return section;
        }

        /** The arrays Glances found; null when it sent none. */
        raid(body) {
            const G = window.DashboardGlances;
            const v = this.view;
            if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
            const arrays = Object.entries(body).filter(([, a]) => a && typeof a === 'object');
            if (!arrays.length) return null;
            const section = this.block('raid', v.t('dashboard.glancesDisksRaid', 'RAID'));
            arrays.forEach(([name, a]) => {
                const have = G.num(a.used);
                const want = G.num(a.available);
                const members = have !== null && want !== null
                    ? v.t('dashboard.glancesRaidMembers', '{used} of {available} devices', { used: have, available: want })
                    : '';
                const row = el('p', 'glances-raid', [name, str(a.type), str(a.status), members].filter(Boolean).join(' · '));
                row.setAttribute('data-glances-raid', name);
                section.appendChild(row);
            });
            return section;
        }
    }

    window.DashboardGlancesSections.register({
        id: 'disks',
        label: 'Disks',
        labelKey: 'dashboard.glancesSectionDisks',
        order: 40,
        plugin: 'fs',
        Section: GlancesDisks,
        /** The dot: a real filesystem at 80% or fuller; 'bad' from 90%. */
        badge(feed) {
            const G = window.DashboardGlances;
            const fullest = realFilesystems(feed.fs).reduce((max, r) => {
                const pct = G.num(r.percent);
                return pct !== null && (max === null || pct > max) ? pct : max;
            }, null);
            const tone = G.tone(fullest);
            return { warn: Boolean(tone), tone };
        },
    });
}());
