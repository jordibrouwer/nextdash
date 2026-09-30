/**
 * The bookmark panel's Details tab, in the Health tab's layout: a summary on
 * top -- the preview as the site gives it and the facts as chips -- and the
 * rest as an accordion: the form, the address, the preview and icon, the
 * copies kept on this disk, and removal.
 *
 * Every action here is one that already exists somewhere -- the row menu, the
 * Health view, the bulk sweeps -- and goes through the same code. What the
 * row menu could do and the panel could not (open in a new tab, copy the
 * address, read a local copy) is now in both.
 *
 * Loaded after the workbench, by ensureBookmarkRenderers.
 */
(function (global) {
    'use strict';
    if (typeof global.DashboardConfig !== 'function') return;

    Object.assign(global.DashboardConfig.prototype, {
        /** A stored preview field as text: older previews still hold the
         *  site's entities (&#039;), which escaping would print as written. */
        bmPreviewText(value) {
            const text = String(value || '').trim();
            return this.dash.preview?.decodeEntities?.(text) ?? text;
        },

        /** The summary on top of Details. */
        renderBmDetailsSummary(b) {
            const esc = (v) => this.dash.escapeHtml(v);
            const t = (key, fallback) => this.t(`config.${key}`, fallback);
            const title = this.bmPreviewText(b.previewTitle);
            const desc = this.bmPreviewText(b.previewDesc);
            // Only a copy this server cached: a remote image would tell the
            // site behind it that someone looked (preview-card-no-third-party).
            const image = /^\/(?!\/)/.test(String(b.previewImage || '')) ? b.previewImage : '';
            const card = title || desc
                ? `<div class="config-bm-details-card${image ? '' : ' is-text'}">
                        ${image ? `<img class="config-bm-details-image" src="${esc(image)}" alt="" loading="lazy">` : ''}
                        <div class="config-bm-details-text">
                            ${title ? `<div class="config-bm-details-title">${esc(title)}</div>` : ''}
                            ${desc ? `<div class="config-bm-details-desc">${esc(desc)}</div>` : ''}
                        </div>
                    </div>`
                : `<p class="config-bm-panel-muted">${esc(t('bmDetailsNoPreview', 'No preview yet: the site has not been asked what it says about itself.'))}</p>`;
            const chip = (text, cls = '') => `<span class="config-bm-details-chip${cls ? ` ${cls}` : ''}">${esc(text)}</span>`;
            const secure = /^https:\/\//i.test(String(b.url || ''));
            const mode = global.CheckMode?.of?.(b) || 'off';
            const modeLabel = mode === 'off' ? t('cleanupFilterNoCheck', 'Not checked') : (global.CheckMode?.meta?.(mode)?.label || mode);
            const chips = [
                ...(b.tags || []).map((tag) => chip(`#${tag}`, 'is-tag')),
                b.shortcut ? chip(`⌨ ${b.shortcut}`) : '',
                b.pinned ? chip(t('pinnedShort', 'Pinned')) : '',
                chip(secure ? 'https' : t('bmDetailsPlain', 'plain http'), secure ? '' : 'is-warn'),
                Number(b.createdAt) > 0 ? chip(t('bmDetailsAdded', 'added {date}').replace('{date}',
                    new Date(Number(b.createdAt)).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }))) : '',
                `<span class="config-bm-details-chip" data-bm-copies-count hidden></span>`,
                `<button type="button" class="config-bm-details-chip is-link" data-bm-details-checking
                        title="${esc(t('bmDetailsCheckingTitle', 'Checking is set on the Health tab'))}">${esc(`${t('bmFieldChecking', 'Checking')}: ${modeLabel}`)}</button>`,
            ].join('');
            return `<div class="config-bm-details-viz">${card}<div class="config-bm-details-chips">${chips}</div></div>`;
        },

        /** Address: where it points, and what can be done with the link itself. */
        /**
         * "Runs in": the containers whose web UI this bookmark is, as the
         * Containers view matches them -- filled once the container list is in,
         * a link each to that container's side panel.
         */
        fillBmDetailsContainers(root, b) {
            const index = global.DockerSearchIndex;
            const row = root?.querySelector?.('[data-bm-containers]');
            if (!row || !index?.enabled?.()) return;
            void index.refresh().then(() => {
                const names = index.containersFor(b, this.dash.allBookmarks || []).map((c) => c.name);
                const host = row.querySelector('[data-bm-containers-list]');
                if (!names.length || !host) return;
                host.replaceChildren(...names.flatMap((name, i) => {
                    const a = document.createElement('a');
                    a.href = `#docker/${encodeURIComponent(name)}`;
                    a.setAttribute('data-bm-container', name);
                    a.textContent = name;
                    return i ? [document.createTextNode(', '), a] : [a];
                }));
                row.hidden = false;
            });
        },

        renderBmDetailsAddress(b) {
            const esc = (v) => this.dash.escapeHtml(v);
            const t = (key, fallback) => this.t(`config.${key}`, fallback);
            let host = '';
            try {
                host = new URL(String(b.url || '')).hostname;
            } catch {
                host = String(b.url || '');
            }
            const home = global.DashboardConfig.isHomeAddress?.(b.url);
            const secure = /^https:\/\//i.test(String(b.url || ''));
            const key = this.canonicalStatsUrlKey?.(b.url);
            const elsewhere = key ? (this.dash.allBookmarks || [])
                .filter((x) => x !== b && this.canonicalStatsUrlKey(x.url) === key)
                .map((x) => this.pageLabel(x.pageId)) : [];
            const kv = (label, value, cls = '') => `<div class="config-bm-usage-kv"><span>${esc(label)}</span><span${cls ? ` class="${cls}"` : ''}>${esc(value)}</span></div>`;
            const button = (action, label) => `<button type="button" class="config-btn config-btn--small" data-bm-panel-action="${action}">${esc(label)}</button>`;
            return `
                ${kv(t('bmDetailsHost', 'Host'), home ? `${host} · ${t('bmDetailsHome', 'home network')}` : host)}
                ${kv(t('bmDetailsSecure', 'Secure'), secure ? t('bmDetailsYesHttps', 'yes, https') : t('bmDetailsNoHttp', 'no, plain http'), secure ? '' : 'is-warn')}
                ${kv(t('bmDetailsAlsoOn', 'Also on'), elsewhere.length ? elsewhere.join(', ') : '—')}
                <div class="config-bm-usage-kv" data-bm-containers hidden><span>${esc(t('bmDetailsContainer', 'Runs in'))}</span><span data-bm-containers-list></span></div>
                <div class="config-bm-details-buttons">
                    ${button('open-new-tab', t('bmDetailsOpenNewTab', 'Open in new tab'))}
                    ${button('copy-url', this.t('dashboard.contextMenuCopyUrl', 'Copy URL'))}
                    ${button('share', this.shareBookmarkActionLabel?.() || t('bmDetailsShare', 'Share link'))}
                    ${button('redirect', this.t('dashboard.healthMenuRedirect', 'Detect redirect'))}
                    ${button('dashboard', this.t('dashboard.healthOpenInDashboard', 'Show on dashboard'))}
                </div>`;
        },

        /** Preview and icon: what was fetched, and asking again. */
        renderBmDetailsPreview(b) {
            const esc = (v) => this.dash.escapeHtml(v);
            const t = (key, fallback) => this.t(`config.${key}`, fallback);
            const yes = t('bmDetailsYes', 'yes');
            const no = t('bmDetailsNo', 'no');
            const kv = (label, value) => `<div class="config-bm-usage-kv"><span>${esc(label)}</span><span>${esc(value)}</span></div>`;
            const button = (action, label) => `<button type="button" class="config-btn config-btn--small" data-bm-panel-action="${action}">${esc(label)}</button>`;
            return `
                ${kv(t('bmDetailsPreviewTitle', 'Title'), this.bmPreviewText(b.previewTitle) || '—')}
                ${kv(t('bmDetailsPreviewDesc', 'Description'), String(b.previewDesc || '').trim() ? yes : no)}
                ${kv(t('bmDetailsPreviewImage', 'Image'), String(b.previewImage || '').trim() ? yes : no)}
                ${kv(t('bmDetailsIcon', 'Icon'), String(b.icon || '').trim() ? yes : no)}
                <div class="config-bm-details-buttons">
                    ${button('rebuild-preview', t('bmDetailsRebuildPreview', 'Rebuild preview'))}
                    ${button('title', this.t('dashboard.healthRefreshTitle', 'Refresh title'))}
                    ${button('favicon', this.t('dashboard.healthRefreshFavicon', 'Refresh favicon'))}
                </div>`;
        },

        /** Local copies: filled in once the server says what it keeps. */
        renderBmDetailsCopies(b) {
            const esc = (v) => this.dash.escapeHtml(v);
            const t = (key, fallback) => this.t(`config.${key}`, fallback);
            const issue = this.bmHealthIssue?.(b);
            return `
                <div class="config-bm-details-copies" data-bm-copies><p class="config-bm-panel-muted">${esc(t('bmDetailsCopiesLoading', 'Looking for copies…'))}</p></div>
                <div class="config-bm-details-buttons">
                    <button type="button" class="config-btn config-btn--small" data-bm-copy-save>${esc(t('bmDetailsCopySave', 'Save a copy now'))}</button>
                    <button type="button" class="config-btn config-btn--small" data-bm-panel-action="archive">${esc(this.t('dashboard.healthArchive', 'Find in Web Archive'))}</button>
                    ${issue ? `<button type="button" class="config-btn config-btn--small" data-bm-panel-action="recover">${esc(t('bmDetailsRecover', 'Recover from archive'))}</button>` : ''}
                </div>`;
        },

        /** Ask the server which copies it keeps of this bookmark, and draw them. */
        /**
         * The server's preview for a bookmark saved before it had one in full.
         *
         * The hover card asks for it the same way and keeps it on the bookmark
         * in memory, so Details says what the card shows rather than "no
         * image" beside a picture. Asked once per bookmark: previewEnriched
         * marks one the server has answered for, as the card's shortcut does.
         */
        async fillBmDetailsPreview(panel, b) {
            if (!b?.url || b.previewEnriched || String(b.previewImage || '').trim() || this._bmPreviewAsked?.has(b.url)) return;
            this._bmPreviewAsked = this._bmPreviewAsked || new Set();
            this._bmPreviewAsked.add(b.url);
            const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            let preview = null;
            try {
                const res = await fetcher(`/api/bookmark-preview?url=${encodeURIComponent(b.url)}`);
                if (res.ok) preview = await res.json();
            } catch {
                return;
            }
            if (!preview) return;
            // What the bookmark has stays; only what it lacks is filled in.
            b.previewTitle = b.previewTitle || preview.title || '';
            b.previewDesc = b.previewDesc || preview.description || '';
            b.previewImage = b.previewImage || preview.image || '';
            b.previewEnriched = true;
            // Only while it is still this bookmark's panel. The summary and
            // the Preview section are redrawn in place: the rest of the panel,
            // and whatever is being typed in it, stays as it is.
            if (!panel?.isConnected || this.findBookmarkByKey(panel.dataset.bmPanelKey) !== b) return;
            const viz = panel.querySelector('[data-bm-pane="details"] .config-bm-details-viz');
            if (viz) viz.outerHTML = this.renderBmDetailsSummary(b);
            const section = panel.querySelector('[data-bm-acc="preview"]');
            const body = section?.querySelector(':scope > .lvs-drawer-section-body');
            if (body) body.innerHTML = this.renderBmDetailsPreview(b);
            const answer = section?.querySelector(':scope > summary .config-bm-acc-answer');
            if (answer && String(b.previewTitle || '').trim()) answer.textContent = this.t('config.bmDetailsFetched', 'fetched');
        },

        async fillBmDetailsCopies(panel, b) {
            const host = panel?.querySelector('[data-bm-copies]');
            const count = panel?.querySelector('[data-bm-copies-count]');
            if (!host || !b?.url) return;
            const esc = (v) => this.dash.escapeHtml(v);
            const t = (key, fallback) => this.t(`config.${key}`, fallback);
            const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            let captures = [];
            try {
                const res = await fetcher(`/api/archives?url=${encodeURIComponent(b.url)}`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                captures = (await res.json())?.captures || [];
            } catch {
                if (host.isConnected) host.innerHTML = `<p class="config-bm-panel-muted">${esc(t('bmDetailsCopiesUnavailable', 'Copies could not be listed.'))}</p>`;
                return;
            }
            if (!host.isConnected) return;
            const size = (n) => (Number(n) > 0 ? ` · ${(Number(n) / 1048576).toFixed(1)} MB` : '');
            host.innerHTML = captures.length
                ? captures.map((c) => `<div class="config-bm-details-copy">
                        <span>${esc(c.at ? new Date(c.at).toLocaleString() : '—')}<span class="config-bm-panel-muted">${esc(size(c.size))}</span></span>
                        <button type="button" class="config-btn config-btn--small" data-bm-copy-read="${esc(c.url)}">${esc(t('bmDetailsCopyRead', 'Read'))}</button>
                    </div>`).join('')
                : `<p class="config-bm-panel-muted">${esc(t('bmDetailsCopiesNone', 'No copy of this page is kept here yet.'))}</p>`;
            const summary = panel.querySelector('[data-bm-acc="copies"] .config-bm-acc-answer');
            const label = captures.length
                ? t('bmDetailsCopiesStored', '{n} stored').replace('{n}', String(captures.length))
                : t('bmDetailsCopiesNoneShort', 'none');
            if (summary) summary.textContent = label;
            if (count) {
                count.hidden = !captures.length;
                count.textContent = t('bmDetailsCopiesChip', '{n} local copies').replace('{n}', String(captures.length));
            }
        },

        /** Save a copy through Health's own capture when the report knows the bookmark. */
        async saveBmLocalCopy(b) {
            const health = this._bmHealthModule;
            const issue = this.bmHealthIssue?.(b);
            if (health && issue) {
                await health.captureLocalCopy(issue);
            } else {
                // The same wait Health's own capture shows: the page is fetched
                // whole, images and all, which can take half a minute.
                const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
                const res = await global.ProgressOverlay?.run
                    ? global.ProgressOverlay.run(
                        this.t('config.localArchiveCapturingTitle', 'Saving a copy…'), b.url,
                        () => fetcher(`/api/archives/capture?url=${encodeURIComponent(b.url)}`, { method: 'POST' }))
                    : fetcher(`/api/archives/capture?url=${encodeURIComponent(b.url)}`, { method: 'POST' });
                this.notify(res.ok
                    ? this.t('dashboard.healthLocalCopySaved', 'Saved a copy of this page.')
                    : this.t('dashboard.healthLocalCopyError', 'Could not save a copy of that page.'), res.ok ? 'success' : 'error');
            }
            const panel = this._libPanel || document.getElementById('config-bm-panel');
            void this.fillBmDetailsCopies(panel, b);
        },

        /** Ask the page for its preview again, even when it has one, and keep the answer. */
        async rebuildBmPreview(b) {
            const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            // The site is asked again and can be slow to answer.
            const endWait = this.beginWait(this.t('config.waitPreviewTitle', 'Fetching the preview…'), b.url);
            try {
                const res = await fetcher(`/api/bookmark-preview?refresh=1&url=${encodeURIComponent(b.url)}`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const preview = await res.json();
                await this.mutateSelected([b], (x) => ({
                    ...x,
                    previewTitle: preview.title || '',
                    previewDesc: preview.description || '',
                    previewImage: preview.image || '',
                    previewImageSource: preview.imageSource || '',
                    previewSiteName: preview.siteName || '',
                }));
                this.notify(this.t('config.bmDetailsPreviewRebuilt', 'Preview fetched again.'), 'success');
            } catch {
                this.notify(this.t('config.bmDetailsPreviewFailed', 'Could not fetch the preview.'), 'error');
            } finally {
                endWait();
            }
        },
    });

    global.DashboardConfigBookmarksDetailsReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
