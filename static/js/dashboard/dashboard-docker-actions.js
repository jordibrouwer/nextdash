'use strict';
/**
 * Starting, stopping, updating and removing containers from the Docker view.
 *
 * Which actions a container offers is decided in one place,
 * DockerSearchIndex.allowedActions(), so the drawer's buttons, the row keys and
 * the :docker palette can never disagree about what is possible. The server
 * checks all of it again: this only keeps the page from offering what would be
 * refused.
 *
 * Update and remove ask first; start, restart and pause do not, because each is
 * undone by pressing the key next to it.
 */
(function () {
    const PHASE_RECREATING_AFTER_MS = 3000;

    class DockerActions {
        constructor(view) {
            this.view = view;
        }

        t(key, fallback, params) {
            return this.view.t(`dashboard.${key}`, fallback, params);
        }

        allowed(container) {
            return window.DockerSearchIndex?.allowedActions?.(container, this.view.status?.control === true) || [];
        }

        label(action) {
            const labels = {
                start: ['dockerActionStart', 'Start'],
                stop: ['dockerActionStop', 'Stop'],
                restart: ['dockerActionRestart', 'Restart'],
                pause: ['dockerActionPause', 'Pause'],
                unpause: ['dockerActionUnpause', 'Resume'],
                update: ['dockerActionUpdate', 'Update'],
                remove: ['dockerActionRemove', 'Remove'],
                rollback: ['dockerActionRollback', 'Roll back'],
            };
            const [key, fallback] = labels[action] || [action, action];
            return this.t(key, fallback);
        }

        /** The buttons for the drawer header; a note instead for the own container. */
        renderButtons(host, container) {
            host.replaceChildren();
            if (container?.self) {
                const note = document.createElement('p');
                note.className = 'docker-self-note';
                note.textContent = this.t('dockerSelfNote', 'This container runs nextDash; update it from your Docker host.');
                host.appendChild(note);
                return;
            }
            this.allowed(container).forEach((action) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'docker-action-btn';
                btn.setAttribute('data-docker-action', action);
                if (action === 'update' && container.update?.status === 'available') {
                    btn.classList.add('docker-action-btn--primary');
                }
                if (action === 'remove') btn.classList.add('docker-action-btn--danger');
                btn.textContent = this.label(action);
                btn.disabled = this.view.busy.has(container.name);
                btn.addEventListener('click', () => { void this.run(action, container); });
                host.appendChild(btn);
            });
        }

        async confirm(action, container) {
            const modal = window.AppModal;
            if (action === 'update') {
                const version = container.version || container.tag || '';
                const message = this.t('dockerConfirmUpdateBody',
                    'Update {name}{version} to the newest image? The container is recreated with the same settings.',
                    { name: container.name, version: version ? ` (${version})` : '' });
                if (typeof modal?.confirm !== 'function') return window.confirm(message);
                return Boolean(await modal.confirm({
                    title: this.t('dockerConfirmUpdateTitle', 'Update container'),
                    message,
                    confirmText: this.label('update'),
                    cancelText: this.t('dockerCancel', 'Cancel'),
                }));
            }
            // Config -> Containers can ask for stop and restart as well.
            if ((action === 'stop' || action === 'restart')
                    && this.view.dash?.settings?.dockerConfirmStopRestart === true) {
                const message = this.t(action === 'stop' ? 'dockerConfirmStopBody' : 'dockerConfirmRestartBody',
                    action === 'stop' ? 'Stop {name}?' : 'Restart {name}?', { name: container.name });
                if (typeof modal?.confirm !== 'function') return window.confirm(message);
                return Boolean(await modal.confirm({
                    title: this.label(action),
                    message,
                    confirmText: this.label(action),
                    cancelText: this.t('dockerCancel', 'Cancel'),
                }));
            }
            if (action === 'remove') {
                const message = this.t('dockerConfirmRemoveBody',
                    'Remove {name}? Its volumes and image stay.', { name: container.name });
                if (typeof modal?.confirm !== 'function') return window.confirm(message);
                return Boolean(await modal.confirm({
                    title: this.t('dockerConfirmRemoveTitle', 'Remove container'),
                    message,
                    confirmText: this.label('remove'),
                    cancelText: this.t('dockerCancel', 'Cancel'),
                    confirmClass: 'danger',
                }));
            }
            return true;
        }

        async run(action, container, { confirm = true } = {}) {
            if (!container || !this.allowed(container).includes(action)) return { ok: false };
            if (this.view.busy.has(container.name)) {
                this.notify(this.t('dockerBusy', 'Another action is still running on this container.'), 'error');
                return { ok: false };
            }
            if (confirm && !(await this.confirm(action, container))) return { ok: false };
            return this.send(action, container);
        }

        async send(action, container) {
            const name = container.name;
            let phaseTimer = null;
            const overlay = action === 'update' || action === 'rollback' ? window.ProgressOverlay : null;
            this.view.setBusy(name, { update: 'pulling', rollback: 'recreating' }[action] || action);
            if (action === 'rollback') {
                overlay?.show?.(
                    this.t('dockerRollingBackTitle', 'Rolling back {name}', { name }),
                    this.t('dockerPhaseRecreatingLong', 'Recreating the container with the same settings…'));
            }
            if (action === 'update') {
                // A pull can take minutes; the row alone is easy to miss, so the
                // overlay says what is happening, as it does for other long work.
                overlay?.show?.(
                    this.t('dockerUpdatingTitle', 'Updating {name}', { name }),
                    this.t('dockerPhasePullingLong', 'Pulling the newest image…'));
                phaseTimer = setTimeout(() => {
                    this.view.setBusy(name, 'recreating');
                    overlay?.show?.(
                        this.t('dockerUpdatingTitle', 'Updating {name}', { name }),
                        this.t('dockerPhaseRecreatingLong', 'Recreating the container with the same settings…'));
                }, PHASE_RECREATING_AFTER_MS);
            }
            let res = null;
            let body = null;
            try {
                res = await window.nextDashFetch(
                    `/api/docker/containers/${encodeURIComponent(name)}/${action}`, { method: 'POST' });
                body = await res.json().catch(() => null);
            } catch {
                res = null;
            } finally {
                if (phaseTimer) clearTimeout(phaseTimer);
                this.view.setBusy(name, null);
            }
            window.DockerSearchIndex?.invalidate?.();

            if (!res || !res.ok) {
                overlay?.hide?.();
                await this.explain(res, body);
                return { ok: false };
            }
            const phase = body?.update?.phase;
            if (overlay) {
                if (phase === 'rolled-back') overlay.hide?.();
                else if (action === 'rollback') overlay.finish?.(this.t('dockerRollbackDone', '{name} runs the previous image again.', { name }));
                else overlay.finish?.(phase === 'already-current'
                    ? this.t('dockerUpdateAlreadyCurrent', '{name} already runs the newest image.', { name })
                    : this.t('dockerUpdateDone', '{name} is up to date.', { name }));
            }
            if (phase === 'rolled-back') {
                const step = body.update.failedStep || '?';
                this.notify(action === 'rollback'
                    ? this.t('dockerRollbackRolledBack',
                        'The rollback of {name} failed at "{step}"; the container runs as before.', { name, step })
                    : this.t('dockerUpdateRolledBack',
                        'The update of {name} failed at "{step}"; the previous container is running again.', { name, step }), 'error');
            }
            await this.view.refreshContainers();
            this.view.drawerRefresh?.();
            return { ok: true, ...body };
        }

        async explain(res, body) {
            const reason = body?.reason;
            if (reason === 'docker-control-off') {
                // The setting changed under an open page: show the view as it
                // now is rather than a button that keeps failing. From the
                // palette, outside the view, there is nothing to repaint.
                window.DockerSearchIndex?.invalidate?.();
                if (this.view.isActiveView()) {
                    await this.view.loadAndRender();
                } else {
                    this.notify(this.t('dockerReadOnly', 'Read-only — set NEXTDASH_DOCKER_CONTROL=1 to manage containers.'), 'error');
                }
                return;
            }
            const messages = {
                'docker-self': ['dockerSelfNote', 'This container runs nextDash; update it from your Docker host.'],
                busy: ['dockerBusy', 'Another action is still running on this container.'],
                running: ['dockerRemoveRunning', 'Stop the container before removing it.'],
                'no-rollback': ['dockerRollbackNone', 'There is no update to roll back.'],
                'old-image-gone': ['dockerRollbackImageGone', 'The previous image is no longer on this host, so there is nothing to go back to.'],
                'pinned-by-digest': ['dockerRollbackPinned', 'This container is pinned to an image digest; roll it back from your Docker host.'],
                'nothing-to-skip': ['dockerSkipNothing', 'There is no update on offer to skip.'],
                'prune-running': ['dockerPruneRunning', 'A clean-up on the Disk tab is still running; try again when it is done.'],
                'network-shared': ['dockerNetworkShared', '{containers} run inside this container\'s network and would be cut off. Update them together from your Docker host.'],
                'auto-remove': ['dockerAutoRemove', 'This container is removed when it stops (--rm), so it cannot be swapped for a new one here.'],
                'pinned-by-id': ['dockerPinnedById', 'This container was made from an image id, not a name, so there is nothing to update it to.'],
            };
            const entry = messages[reason];
            const text = entry
                ? this.t(entry[0], entry[1], { containers: (body?.containers || []).join(', ') })
                : (body?.message || this.t('dockerActionFailed', 'Docker did not do that.'));
            this.notify(text, 'error');
            await this.view.refreshContainers();
        }

        /**
         * Puts a container back on the image its last update replaced, after
         * asking. Not one of allowed(): the drawer offers it only when the
         * server says the previous image is still there.
         */
        async rollback(container, offer) {
            if (!container || this.view.status?.control !== true || container.self) return { ok: false };
            if (this.view.busy.has(container.name)) {
                this.notify(this.t('dockerBusy', 'Another action is still running on this container.'), 'error');
                return { ok: false };
            }
            const target = offer?.toVersion || String(offer?.toImageId || '').replace(/^sha256:/, '').slice(0, 12);
            const message = this.t('dockerConfirmRollbackBody',
                'Put {name} back on {version}? The container is recreated with the same settings, and the version it leaves is skipped.',
                { name: container.name, version: target });
            const modal = window.AppModal;
            const ok = typeof modal?.confirm === 'function'
                ? await modal.confirm({
                    title: this.t('dockerConfirmRollbackTitle', 'Roll back container'),
                    message,
                    confirmText: this.label('rollback'),
                    cancelText: this.t('dockerCancel', 'Cancel'),
                })
                : window.confirm(message);
            if (!ok) return { ok: false };
            return this.send('rollback', container);
        }

        /** Whether this container's notices are muted (Config → Containers → Notifications). */
        isMuted(container) {
            const muted = this.view.dash?.settings?.dockerNotifyMuted;
            return Array.isArray(muted) && muted.includes(container?.name);
        }

        /** Mute or unmute a container's notices; a setting, so no control is needed. */
        async toggleMute(container) {
            const d = this.view.dash;
            if (!d?.settings || !container?.name) return false;
            const before = Array.isArray(d.settings.dockerNotifyMuted) ? d.settings.dockerNotifyMuted : [];
            const muting = !before.includes(container.name);
            d.settings.dockerNotifyMuted = muting
                ? [...before, container.name]
                : before.filter((n) => n !== container.name);
            // saveSettings resolves false on a failed save (and says so itself)
            // rather than rejecting; either way the change did not happen.
            let saved = false;
            try {
                saved = (await d.saveSettings()) !== false;
            } catch {
                this.notify(this.t('dockerMuteFailed', 'The change could not be saved.'), 'error');
            }
            if (!saved) {
                d.settings.dockerNotifyMuted = before;
                return false;
            }
            this.notify(muting
                ? this.t('dockerMuted', 'No more notices about {name}.', { name: container.name })
                : this.t('dockerUnmuted', 'Notices about {name} are back on.', { name: container.name }), 'success');
            return true;
        }

        /** Skip the update on offer, hold updates, or undo either, for the container's image. */
        async choose(container, choice) {
            let res = null;
            let body = null;
            try {
                res = await window.nextDashFetch('/api/docker/updates/choice', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ image: container.image, choice }),
                });
                body = await res.json().catch(() => null);
            } catch {
                res = null;
            }
            if (!res || !res.ok) {
                await this.explain(res, body);
                return { ok: false };
            }
            window.DockerSearchIndex?.invalidate?.();
            await this.view.refreshContainers();
            this.view.drawerRefresh?.();
            return { ok: true };
        }

        /** One action over a selection: stop and update ask once, listing the names. */
        async runBulk(action, containers) {
            // An update of a selection leaves out what the reader skipped or held.
            const targets = containers.filter((c) => this.allowed(c).includes(action)
                && !(action === 'update' && ['skipped', 'held'].includes(c.update?.status)));
            if (!targets.length) return;
            if (action === 'stop' || action === 'update') {
                const names = targets.map((c) => c.name).join(', ');
                const message = action === 'stop'
                    ? this.t('dockerConfirmBulkStop', 'Stop {names}?', { names })
                    : this.t('dockerConfirmBulkUpdate', 'Update {names} to their newest images?', { names });
                const ok = typeof window.AppModal?.confirm === 'function'
                    ? await window.AppModal.confirm({
                        title: this.label(action),
                        message,
                        confirmText: this.label(action),
                        cancelText: this.t('dockerCancel', 'Cancel'),
                    })
                    : window.confirm(message);
                if (!ok) return;
            }
            // One at a time: updates pull images, and the daemon does better
            // with one pull than with six fighting for the same bandwidth.
            for (const c of targets) {
                await this.send(action, c);
            }
        }

        notify(message, type) {
            if (window.AppNotification?.show) {
                window.AppNotification.show(message, type);
            }
        }
    }

    window.DockerActions = DockerActions;
})();

/**
 * The right-click menu on a container row.
 *
 * Built on the same `.move-popover` surface as the bookmark row's menu, so it
 * looks and moves the same: arrow keys, Enter, Escape, a click outside. Every
 * entry is something the drawer or a row key already does -- this is one more
 * way in, not new behaviour.
 */
(function () {
    class DockerRowMenu {
        constructor(view) {
            this.view = view;
            this._cleanup = null;
        }

        t(key, fallback, params) {
            return this.view.t(`dashboard.${key}`, fallback, params);
        }

        close() {
            if (this._cleanup) this._cleanup();
        }

        entries(c) {
            const actions = this.view.actions;
            const allowed = actions ? actions.allowed(c) : [];
            const keys = { start: 's', stop: 's', restart: 'r', pause: 'p', unpause: 'p', update: 'u', remove: 'Del' };
            const icons = { start: '▶', stop: '■', restart: '↻', pause: '⏸', unpause: '▶', update: '⇡', remove: '✕' };
            const list = [{ id: 'open', label: this.t('dockerMenuDetails', 'Details'), icon: 'ⓘ', key: 'Enter' }];
            allowed.filter((a) => a !== 'remove').forEach((a) => {
                list.push({ id: a, label: actions.label(a), icon: icons[a], key: keys[a] });
            });
            list.push({ id: 'logs', label: this.t('dockerMenuLogs', 'Show logs'), icon: '≡', divider: true });
            const webui = this.webuiFor(c);
            if (webui) list.push({ id: 'webui', label: this.t('dockerLinkWebUI', 'Web UI'), icon: '↗' });
            if (!c.self) {
                list.push(actions?.isMuted(c)
                    ? { id: 'mute', label: this.t('dockerMenuUnmute', 'Unmute notifications'), icon: '🔔' }
                    : { id: 'mute', label: this.t('dockerMenuMute', 'Mute notifications'), icon: '🔕' });
            }
            list.push({ id: 'copy-name', label: this.t('dockerMenuCopyName', 'Copy name'), icon: '⧉' });
            list.push({ id: 'copy-id', label: this.t('dockerMenuCopyId', 'Copy ID'), icon: '⧉' });
            if (allowed.includes('remove')) {
                list.push({ id: 'remove', label: actions.label('remove'), icon: icons.remove, key: keys.remove, danger: true });
            }
            return list;
        }

        webuiFor(c) {
            const index = window.DockerSearchIndex;
            if (c.webui) return index.webuiHref(c.webui, c);
            const port = index.firstWebPort(c);
            return port ? index.portHref(port.public) : '';
        }

        open(c, point) {
            this.close();
            window.EscapeOwner?.registerOwner?.('docker-row-menu', {
                isOpen: () => Boolean(document.getElementById('docker-row-menu')),
            });

            const pop = document.createElement('div');
            pop.id = 'docker-row-menu';
            pop.className = 'move-popover bookmark-context-menu docker-row-menu';
            pop.setAttribute('role', 'menu');
            pop.setAttribute('aria-label', this.t('dockerMenuTitle', 'Container actions'));

            const head = document.createElement('div');
            head.className = 'move-popover-current-hint';
            head.textContent = c.name;
            pop.appendChild(head);

            const items = [];
            this.entries(c).forEach((entry) => {
                if (entry.divider || entry.danger) {
                    const divider = document.createElement('div');
                    divider.className = 'move-popover-divider';
                    pop.appendChild(divider);
                }
                const item = document.createElement('div');
                item.className = 'move-popover-item' + (entry.danger ? ' is-danger' : '');
                item.setAttribute('role', 'menuitem');
                item.setAttribute('data-docker-menu-action', entry.id);
                const icon = document.createElement('span');
                icon.className = 'move-popover-check';
                icon.textContent = entry.icon || '';
                const label = document.createElement('span');
                label.textContent = entry.label;
                item.append(icon, label);
                if (entry.key) {
                    const kbd = document.createElement('kbd');
                    kbd.className = 'move-popover-item-key';
                    kbd.textContent = entry.key;
                    kbd.setAttribute('aria-hidden', 'true');
                    item.appendChild(kbd);
                }
                pop.appendChild(item);
                items.push(item);
            });

            document.body.appendChild(pop);
            this.position(pop, point);

            let focused = 0;
            const setFocus = (idx) => {
                focused = idx;
                items.forEach((el, i) => {
                    el.classList.toggle('is-focused', i === idx);
                    el.tabIndex = i === idx ? 0 : -1;
                });
                items[idx]?.focus({ preventScroll: true });
            };

            let onOutside = null;
            const close = () => {
                pop.remove();
                document.removeEventListener('keydown', onKey, true);
                if (onOutside) {
                    document.removeEventListener('click', onOutside);
                    document.removeEventListener('contextmenu', onOutside);
                }
                window.removeEventListener('resize', close);
                window.removeEventListener('scroll', close, true);
                if (this._cleanup === close) this._cleanup = null;
            };
            this._cleanup = close;

            const run = (item) => {
                const id = item.getAttribute('data-docker-menu-action');
                close();
                void this.run(id, c);
            };
            const onKey = (e) => {
                if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
                if (e.key === 'ArrowDown') { e.preventDefault(); e.stopImmediatePropagation(); setFocus((focused + 1) % items.length); return; }
                if (e.key === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); setFocus((focused - 1 + items.length) % items.length); return; }
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopImmediatePropagation(); if (items[focused]) run(items[focused]); }
            };
            items.forEach((item, idx) => {
                item.addEventListener('mouseenter', () => setFocus(idx));
                item.addEventListener('click', () => run(item));
            });
            document.addEventListener('keydown', onKey, true);
            window.addEventListener('resize', close);
            window.addEventListener('scroll', close, true);
            setTimeout(() => {
                onOutside = (e) => { if (!pop.contains(e.target)) close(); };
                document.addEventListener('click', onOutside);
                document.addEventListener('contextmenu', onOutside);
            }, 0);
            requestAnimationFrame(() => setFocus(0));
        }

        /** Kept on screen: flipped left or up when the cursor is near an edge. */
        position(pop, point) {
            const margin = 8;
            const w = pop.offsetWidth || 220;
            const h = pop.offsetHeight || 220;
            let left = point.x;
            let top = point.y;
            if (left + w + margin > window.innerWidth) left = point.x - w;
            if (top + h + margin > window.innerHeight) top = point.y - h;
            left = Math.max(margin, Math.min(left, window.innerWidth - w - margin));
            top = Math.max(margin, Math.min(top, window.innerHeight - h - margin));
            pop.style.left = `${Math.round(left)}px`;
            pop.style.top = `${Math.round(top)}px`;
        }

        async run(id, c) {
            const view = this.view;
            if (id === 'open') {
                view.selectContainer(c.name, { openDrawer: true });
            } else if (id === 'logs') {
                view.selectContainer(c.name, { openDrawer: true, section: 'logs' });
            } else if (id === 'webui') {
                window.open(this.webuiFor(c), '_blank', 'noopener');
            } else if (id === 'mute') {
                await view.actions?.toggleMute(c);
                view.drawerRefresh?.();
            } else if (id === 'copy-name' || id === 'copy-id') {
                const text = id === 'copy-name' ? c.name : c.id;
                try {
                    await navigator.clipboard.writeText(text);
                    window.AppNotification?.show?.(this.t('dockerMenuCopied', 'Copied'), 'success');
                } catch {
                    window.AppNotification?.show?.(this.t('dockerMenuCopyFailed', 'Could not copy'), 'error');
                }
            } else {
                await view.actions?.run(id, c);
            }
        }
    }

    window.DockerRowMenu = DockerRowMenu;
})();
