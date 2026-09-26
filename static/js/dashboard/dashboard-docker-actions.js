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
            this.view.setBusy(name, action === 'update' ? 'pulling' : action);
            if (action === 'update') {
                phaseTimer = setTimeout(() => this.view.setBusy(name, 'recreating'), PHASE_RECREATING_AFTER_MS);
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
                await this.explain(res, body);
                return { ok: false };
            }
            const phase = body?.update?.phase;
            if (phase === 'rolled-back') {
                this.notify(this.t('dockerUpdateRolledBack',
                    'The update of {name} failed at "{step}"; the previous container is running again.',
                    { name, step: body.update.failedStep || '?' }), 'error');
            } else if (phase === 'already-current') {
                this.notify(this.t('dockerUpdateAlreadyCurrent', '{name} already runs the newest image.', { name }), 'success');
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
            };
            const entry = messages[reason];
            const text = entry
                ? this.t(entry[0], entry[1])
                : (body?.message || this.t('dockerActionFailed', 'Docker did not do that.'));
            this.notify(text, 'error');
            await this.view.refreshContainers();
        }

        /** One action over a selection: stop and update ask once, listing the names. */
        async runBulk(action, containers) {
            const targets = containers.filter((c) => this.allowed(c).includes(action));
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
