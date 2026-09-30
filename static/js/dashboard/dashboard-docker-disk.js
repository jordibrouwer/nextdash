/**
 * The Containers view's Disk tab: what images, volumes and build cache take
 * up, and clearing what nothing uses.
 *
 * Measured only when the tab is opened (and on Refresh): /system/df can take a
 * while on a big host. Four tiles -- unused images, dangling images, build
 * cache, unused volumes -- each with its prune, then the images and volumes
 * themselves, biggest first. Pruning dangling images ends the rollbacks that
 * need them, and the tile and the question say whose.
 *
 * Volumes hold data: never pruned in bulk, removed one at a time after the
 * name is typed. Everything here reaches the page through textContent.
 */
(function () {
    const KIB = 1024;
    const MIB = KIB * 1024;
    const GIB = MIB * 1024;

    function formatBytes(n) {
        if (!Number.isFinite(n) || n < 0) return '—';
        if (n < KIB) return `${n} B`;
        if (n < MIB) return `${Math.round(n / KIB)} KiB`;
        if (n < GIB) return `${Math.round(n / MIB)} MiB`;
        return `${(n / GIB).toFixed(1)} GiB`;
    }

    function el(tag, cls, text) {
        const node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text != null) node.textContent = text;
        return node;
    }

    class DockerDisk {
        static formatBytes = formatBytes;

        constructor(view) {
            this.view = view;
            this.data = null;
            this.loading = false;
            this.failed = false;
            this.root = el('div', 'docker-disk');
            this.root.setAttribute('data-docker-disk', '');
        }

        t(key, fallback, params) {
            return this.view.t(`dashboard.${key}`, fallback, params);
        }

        get control() {
            return this.view.status?.control === true;
        }

        element() {
            return this.root;
        }

        ensureLoaded() {
            if (!this.data && !this.loading) void this.load();
            else this.paint();
        }

        async load() {
            this.loading = true;
            this.failed = false;
            this.paint();
            let data = null;
            try {
                const res = await fetch('/api/docker/disk', { cache: 'no-store' });
                data = res.ok ? await res.json() : null;
            } catch {
                data = null;
            }
            this.loading = false;
            if (data) this.data = data;
            else this.failed = true;
            this.view.onDiskMeasured?.(this.data?.totals || null);
            this.paint();
        }

        rollbackNames() {
            const names = new Set();
            (this.data?.images || []).forEach((im) => {
                if (im.dangling) (im.rollbackFor || []).forEach((n) => names.add(n));
            });
            return [...names].sort();
        }

        /* ── Drawing ─────────────────────────────────────────────────────── */

        paint() {
            const root = this.root;
            root.replaceChildren();
            const head = el('div', 'docker-disk-head');
            const state = el('span', 'docker-disk-state');
            if (this.loading) state.textContent = this.t('dockerDiskMeasuring', 'Measuring… this can take a while on a large host.');
            else if (this.failed) state.textContent = this.t('dockerDiskFailed', 'The disk could not be measured.');
            const refresh = el('button', 'docker-action-btn', this.t('dockerDiskRefresh', 'Refresh'));
            refresh.type = 'button';
            refresh.disabled = this.loading;
            refresh.setAttribute('data-docker-disk-refresh', '');
            refresh.addEventListener('click', () => void this.load());
            head.append(state, refresh);
            root.appendChild(head);
            if (!this.data) return;

            const totals = this.data.totals || {};
            const images = this.data.images || [];
            const volumes = this.data.volumes || [];
            const tiles = el('div', 'docker-disk-tiles');
            const rollback = this.rollbackNames();
            tiles.append(
                this.tile('images-unused', this.t('dockerDiskUnusedImages', 'Unused images'), totals.imagesUnused,
                    this.t('dockerDiskOfImages', '{count} of {total} images', { count: totals.imagesUnusedCount || 0, total: images.length }),
                    this.t('dockerDiskRemoveUnused', 'Remove unused…'), rollback),
                this.tile('images-dangling', this.t('dockerDiskDangling', 'Dangling images'), totals.dangling,
                    this.t('dockerDiskUntagged', '{count} untagged', { count: totals.danglingCount || 0 }),
                    this.t('dockerDiskRemoveDangling', 'Remove dangling…'), rollback),
                this.tile('build-cache', this.t('dockerDiskBuildCache', 'Build cache'), totals.buildCache,
                    this.t('dockerDiskEntries', '{count} entries', { count: totals.buildCacheCount || 0 }),
                    this.t('dockerDiskClearCache', 'Clear cache…'), []),
                this.tile('volumes', this.t('dockerDiskUnusedVolumes', 'Unused volumes'), totals.volumesUnused,
                    this.t('dockerDiskOfVolumes', '{count} of {total} volumes', { count: totals.volumesUnusedCount || 0, total: volumes.length }),
                    null, []),
                this.tile('containers-stopped', this.t('dockerDiskStopped', 'Stopped containers'), totals.containersStopped,
                    this.t('dockerDiskStoppedCount', '{count} stopped', { count: totals.containersStoppedCount || 0 }),
                    this.t('dockerDiskRemoveStopped', 'Remove stopped…'), [], totals.containersStoppedCount),
            );
            root.appendChild(tiles);
            root.appendChild(this.imagesTable(images));
            root.appendChild(this.volumesTable(volumes));
            const binds = this.data.binds || [];
            if (binds.length) root.appendChild(this.bindsTable(binds));
        }

        tile(kind, label, bytes, sub, action, rollback, count) {
            const tile = el('div', 'docker-disk-tile');
            tile.setAttribute('data-docker-disk-tile', kind);
            tile.append(el('span', 'docker-disk-tile-label', label), el('b', 'docker-disk-tile-value', formatBytes(bytes || 0)),
                el('span', 'docker-disk-tile-sub', sub));
            if (action && this.control) {
                const btn = el('button', 'docker-action-btn', action);
                btn.type = 'button';
                btn.setAttribute('data-docker-prune', kind);
                // A stopped container that wrote nothing still goes: it is the
                // count that says whether there is anything to do.
                btn.disabled = count === undefined ? !bytes : !count;
                btn.addEventListener('click', () => void this.prune(kind));
                tile.appendChild(btn);
            } else if (kind === 'volumes' && this.control) {
                tile.appendChild(el('span', 'docker-disk-tile-sub', this.t('dockerDiskVolumesBelow', 'Removed one at a time, below.')));
            }
            if (rollback.length && (kind === 'images-dangling' || kind === 'images-unused')) {
                const warn = el('span', 'docker-disk-warning',
                    `⚠ ${this.t('dockerDiskEndsRollback', 'ends rollback for {names}', { names: rollback.join(', ') })}`);
                warn.setAttribute('data-docker-disk-warning', '');
                tile.appendChild(warn);
            }
            return tile;
        }

        table(title, heads) {
            const wrap = el('section', 'docker-disk-section');
            wrap.appendChild(el('h3', 'docker-disk-title', title));
            const table = el('table', 'docker-disk-table');
            const tr = document.createElement('tr');
            heads.forEach(([text, cls]) => {
                const th = el('th', `lvs-colhead${cls ? ` ${cls}` : ''}`, text);
                th.scope = 'col';
                tr.appendChild(th);
            });
            const thead = document.createElement('thead');
            thead.appendChild(tr);
            const tbody = document.createElement('tbody');
            table.append(thead, tbody);
            wrap.appendChild(table);
            return { wrap, tbody };
        }

        imagesTable(images) {
            const { wrap, tbody } = this.table(this.t('dockerDiskImages', 'Images'), [
                [this.t('dockerDiskColImage', 'Image')], [this.t('dockerDiskColUsedBy', 'Used by')],
                [this.t('dockerDiskColSize', 'Size'), 'docker-disk-num'],
            ]);
            images.forEach((im) => {
                const tr = document.createElement('tr');
                tr.setAttribute('data-docker-disk-image', im.id);
                const name = el('td', 'docker-disk-name');
                if (im.dangling) {
                    name.append(el('span', 'docker-disk-chip', this.t('dockerDiskUntaggedChip', 'untagged')),
                        ` ${String(im.id || '').replace(/^sha256:/, '').slice(0, 12)}`);
                } else {
                    name.textContent = (im.tags || []).join(', ');
                }
                let used = (im.usedBy || []).join(', ');
                if (!used && (im.rollbackFor || []).length) {
                    used = this.t('dockerDiskRollbackFor', 'rollback for {names}', { names: im.rollbackFor.join(', ') });
                }
                tr.append(name, el('td', used ? '' : 'docker-disk-muted', used || '—'), el('td', 'docker-disk-num', formatBytes(im.size)));
                tbody.appendChild(tr);
            });
            return wrap;
        }

        volumesTable(volumes) {
            const { wrap, tbody } = this.table(this.t('dockerDiskVolumes', 'Volumes'), [
                [this.t('dockerDiskColVolume', 'Volume')], [this.t('dockerDiskColUsedBy', 'Used by')],
                [this.t('dockerDiskColSize', 'Size'), 'docker-disk-num'], [''],
            ]);
            volumes.forEach((vol) => {
                const tr = document.createElement('tr');
                tr.setAttribute('data-docker-disk-volume', vol.name);
                const used = (vol.usedBy || []).join(', ');
                const action = el('td', 'docker-disk-action');
                if (!used && this.control) {
                    const btn = el('button', 'docker-action-btn docker-action-btn--danger', this.t('dockerDiskRemoveVolume', 'Remove…'));
                    btn.type = 'button';
                    btn.setAttribute('data-docker-volume-remove', vol.name);
                    btn.addEventListener('click', () => this.confirmVolume(vol));
                    action.appendChild(btn);
                }
                tr.append(el('td', 'docker-disk-name', vol.name), el('td', used ? '' : 'docker-disk-muted', used || '—'),
                    el('td', 'docker-disk-num', formatBytes(vol.size)), action);
                tbody.appendChild(tr);
            });
            return wrap;
        }

        /** Host folders containers mount (Unraid's appdata): not volumes, so
         *  Docker neither measures nor removes them -- listed to be found. */
        bindsTable(binds) {
            const { wrap, tbody } = this.table(this.t('dockerDiskBinds', 'Bind mounts'), [
                [this.t('dockerDiskColFolder', 'Host folder')], [this.t('dockerDiskColUsedBy', 'Used by')],
            ]);
            wrap.querySelector('.docker-disk-title').after(el('p', 'docker-disk-note',
                this.t('dockerDiskBindsNote', 'Folders on the host that containers mount. Docker does not measure them.')));
            binds.forEach((b) => {
                const tr = document.createElement('tr');
                tr.setAttribute('data-docker-disk-bind', b.source);
                const used = (b.usedBy || []).map((u) => `${u.container} → ${u.destination}`).join(', ');
                tr.append(el('td', 'docker-disk-name', b.source), el('td', '', used));
                tbody.appendChild(tr);
            });
            return wrap;
        }

        /* ── Changing the disk ───────────────────────────────────────────── */

        notify(text, type) {
            window.AppNotification?.show?.(text, type);
        }

        async prune(kind) {
            const totals = this.data?.totals || {};
            const rollback = this.rollbackNames();
            const ends = rollback.length
                ? ` ${this.t('dockerDiskPruneEndsRollback', 'This ends the rollback for {names}.', { names: rollback.join(', ') })}`
                : '';
            const questions = {
                'images-dangling': [this.t('dockerDiskPruneDanglingTitle', 'Remove dangling images'),
                    this.t('dockerDiskPruneDanglingBody', 'Remove {count} untagged images and free {size}?',
                        { count: totals.danglingCount || 0, size: formatBytes(totals.dangling || 0) }) + ends,
                    this.t('dockerDiskRemove', 'Remove')],
                'images-unused': [this.t('dockerDiskPruneUnusedTitle', 'Remove unused images'),
                    this.t('dockerDiskPruneUnusedBody', 'Remove {count} images no container uses and free {size}? A container that needs one later downloads it again.',
                        { count: totals.imagesUnusedCount || 0, size: formatBytes(totals.imagesUnused || 0) }) + ends,
                    this.t('dockerDiskRemove', 'Remove')],
                'build-cache': [this.t('dockerDiskPruneCacheTitle', 'Clear the build cache'),
                    this.t('dockerDiskPruneCacheBody', 'Clear the build cache and free {size}? The next build takes longer.',
                        { size: formatBytes(totals.buildCache || 0) }),
                    this.t('dockerDiskClear', 'Clear')],
            };
            const stopped = this.data?.stopped || [];
            const shown = stopped.slice(0, 8).join(', ') + (stopped.length > 8
                ? ` ${this.t('dockerDiskAndMore', 'and {count} more', { count: stopped.length - 8 })}` : '');
            questions['containers-stopped'] = [this.t('dockerDiskPruneStoppedTitle', 'Remove stopped containers'),
                this.t('dockerDiskPruneStoppedBody', 'Remove {count} stopped containers: {names}? Their volumes and images stay.',
                    { count: stopped.length, names: shown }),
                this.t('dockerDiskRemove', 'Remove')];
            const [title, message, confirmText] = questions[kind] || [];
            if (!title) return;
            const modal = window.AppModal;
            const ok = typeof modal?.confirm === 'function'
                ? await modal.confirm({ title, message, confirmText, cancelText: this.t('dockerCancel', 'Cancel'), confirmClass: 'danger' })
                : window.confirm(message);
            if (!ok) return;
            let res = null;
            let body = null;
            try {
                res = await window.nextDashFetch(`/api/docker/prune/${kind}`, { method: 'POST' });
                body = await res.json().catch(() => null);
            } catch {
                res = null;
            }
            if (!res?.ok) {
                this.notify(body?.reason === 'busy'
                    ? this.t('dockerDiskBusy', 'A clean-up or an update is still running. Try again when it is done.')
                    : (body?.message || this.t('dockerActionFailed', 'Docker did not do that.')), 'error');
                return;
            }
            if (kind === 'containers-stopped') {
                const failed = body?.failed || [];
                this.notify(failed.length
                    ? this.t('dockerDiskStoppedPartly', 'Removed {count}; {names} could not be removed.', { count: body?.removed || 0, names: failed.join(', ') })
                    : this.t('dockerDiskStoppedRemoved', 'Removed {count} stopped containers.', { count: body?.removed || 0 }),
                failed.length ? 'warning' : 'success');
                await this.load();
                void this.view?.refreshContainers?.();
                return;
            }
            this.notify(this.t('dockerDiskFreed', 'Freed {size}.', { size: formatBytes(body?.reclaimed || 0) }), 'success');
            await this.load();
        }

        /**
         * One fixed word, typed, before a volume goes: the data in it goes
         * with it. Not the volume's name -- an anonymous volume's is 64 random
         * characters. The request still names the volume twice (?confirm=).
         */
        confirmVolume(vol) {
            const word = this.t('dockerDiskConfirmWord', 'delete');
            const dialog = el('dialog', 'docker-volume-confirm');
            dialog.setAttribute('data-docker-volume-confirm', '');
            dialog.setAttribute('aria-label', this.t('dockerDiskRemoveVolumeTitle', 'Remove volume'));
            const title = el('h2', 'docker-volume-confirm-title', this.t('dockerDiskRemoveVolumeTitle', 'Remove volume'));
            const text = el('p', '', this.t('dockerDiskRemoveVolumeBody',
                'The data in {name} ({size}) is deleted for good. Type {word} to go on.',
                { name: vol.name, size: formatBytes(vol.size), word }));
            const input = el('input', 'config-text');
            input.type = 'text';
            input.autocomplete = 'off';
            input.spellcheck = false;
            input.placeholder = word;
            input.setAttribute('aria-label', this.t('dockerDiskTypeWord', 'Type {word} to confirm', { word }));
            const row = el('div', 'docker-volume-confirm-actions');
            const cancel = el('button', 'docker-action-btn', this.t('dockerCancel', 'Cancel'));
            cancel.type = 'button';
            const go = el('button', 'docker-action-btn docker-action-btn--danger', this.t('dockerDiskRemove', 'Remove'));
            go.type = 'button';
            go.disabled = true;
            go.setAttribute('data-docker-volume-confirm-go', '');
            row.append(cancel, go);
            dialog.append(title, text, input, row);

            const close = () => {
                if (dialog.open) dialog.close();
                dialog.remove();
            };
            input.addEventListener('input', () => { go.disabled = input.value.trim().toLowerCase() !== word.toLowerCase(); });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !go.disabled) go.click();
            });
            cancel.addEventListener('click', close);
            dialog.addEventListener('cancel', (e) => {
                e.preventDefault();
                close();
            });
            go.addEventListener('click', async () => {
                go.disabled = true;
                const enc = encodeURIComponent(vol.name);
                let res = null;
                let body = null;
                try {
                    res = await window.nextDashFetch(`/api/docker/volumes/${enc}?confirm=${enc}`, { method: 'DELETE' });
                    body = await res.json().catch(() => null);
                } catch {
                    res = null;
                }
                close();
                if (!res?.ok) {
                    this.notify(body?.reason === 'in-use'
                        ? this.t('dockerDiskVolumeInUse', '{name} is still used by {containers}.',
                            { name: vol.name, containers: (body.containers || []).join(', ') })
                        : (body?.message || this.t('dockerActionFailed', 'Docker did not do that.')), 'error');
                    return;
                }
                this.notify(this.t('dockerDiskVolumeRemoved', '{name} removed.', { name: vol.name }), 'success');
                await this.load();
            });
            document.body.appendChild(dialog);
            dialog.showModal();
            input.focus();
        }
    }

    window.DockerDisk = DockerDisk;
})();
