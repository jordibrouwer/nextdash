'use strict';
/**
 * Health's side panel: one bookmark's health, read in full.
 *
 * The panel itself -- host, placement, phone fullscreen, ScrollLock and the
 * remembered sections -- is the shared one (list-view-drawer.js), the same the
 * Containers view opens. This class fills it. Every section body is markup the
 * view already builds (the score breakdown, the expectations form, the monitor
 * statistics), so the panel and the old inline panels cannot say different
 * things about the same bookmark.
 */
const HEALTH_SECTIONS_KEY = 'nextdash.health.sections';
const HEALTH_SECTIONS_DEFAULT = ['why', 'score'];

class HealthDrawer {
    constructor(view) {
        this.view = view;
        this._issue = null;
        this._pageLookup = 0;
        this.base = new window.ListViewDrawer({
            id: 'health',
            storageKey: HEALTH_SECTIONS_KEY,
            defaultSections: HEALTH_SECTIONS_DEFAULT,
            closeLabel: this.t('healthDrawerClose', 'Close'),
            onClose: () => this._onBaseClosed(),
        });
    }

    t(key, fallback, params) {
        return this.view.t(`dashboard.${key}`, fallback, params);
    }

    isOpen() {
        return this.base.isOpen();
    }

    currentKey() {
        return this.base.currentKey();
    }

    /** section: one to open on arrival, as `s` asks for the score. */
    open(issue, { section = null } = {}) {
        if (!issue) return;
        const view = this.view;
        const key = view.issueKey(issue);
        this._issue = issue;
        const title = issue.name || issue.previewTitle || view.formatUrlDisplay(issue.url);
        this.base.open(key, {
            title,
            build: (panel, ctx) => {
                panel.classList.add('health-drawer');
                panel.setAttribute('data-health-drawer', key);
                this._fillHead(ctx, issue);
                this._fillWhy(ctx.section('why', this.t('healthDrawerWhy', 'Why')), issue);
                this._fillScore(ctx.section('score', this.t('healthDrawerScore', 'Score {score}', { score: issue.score })), issue);
                this._fillCheck(ctx.section('check', this.t('healthDrawerCheck', 'Check mode')), issue);
                this._fillExpect(ctx.section('expect', this.t('healthDrawerExpect', 'Expectations')), issue, key);
                if (issue.monitor) {
                    this._fillMonitor(ctx.section('monitor', this.t('healthDrawerMonitor', 'Monitor & history')), issue);
                }
                const archive = this._archiveHtml(issue);
                if (archive) {
                    ctx.section('archive', this.t('healthDrawerArchive', 'Archive')).innerHTML = archive;
                }
            },
        });
        if (section) this.base.openSection(section);
    }

    openSection(name) {
        this.base.openSection(name);
    }

    close() {
        this._issue = null;
        this.base.close({ silent: true });
    }

    destroy() {
        this._issue = null;
        this.base.destroy();
    }

    /**
     * Rebuild for the bookmark on show, from the view's current report, so a
     * re-check or a save shows the new facts. Leaves the panel alone while a
     * field in it has focus: rebuilding would throw away what is being typed.
     */
    refresh() {
        if (!this.isOpen()) return;
        const active = document.activeElement;
        if (active && this.base.panel?.contains(active) && active.matches?.('input, textarea, select')) return;
        const key = this.currentKey();
        const issue = this.view.issueByKey(key);
        if (!issue) {
            this.close();
            return;
        }
        const open = Array.from(this.base.panel?.querySelectorAll('.lvs-drawer-section[open]') || [])
            .map((el) => el.getAttribute('data-lvs-section'));
        const scroll = this.base.panel?.scrollTop || 0;
        this.open(issue);
        open.forEach((name) => this.base.openSection(name));
        if (this.base.panel) this.base.panel.scrollTop = scroll;
    }

    /** The panel's own close button: the row stays selected, only the panel goes. */
    _onBaseClosed() {
        this._issue = null;
        this.view.onDrawerClosed?.();
    }

    /* ── Head ─────────────────────────────────────────────────────────── */

    _fillHead(ctx, issue) {
        const view = this.view;
        const url = String(issue.url || '');
        if (/^https?:\/\//i.test(url)) {
            const link = document.createElement('a');
            link.className = 'health-drawer-url';
            link.href = url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = view.formatUrlDisplay(url);
            ctx.head.insertBefore(link, ctx.actions);
        }

        const where = document.createElement('p');
        where.className = 'health-drawer-where';
        where.setAttribute('data-health-drawer-where', '');
        where.textContent = issue.pageName || '';
        ctx.head.insertBefore(where, ctx.actions);

        const tags = document.createElement('p');
        tags.className = 'health-drawer-tags';
        tags.setAttribute('data-health-drawer-tags', '');
        tags.hidden = true;
        ctx.head.insertBefore(tags, ctx.actions);
        void this._fillPlace(issue, where, tags);

        const button = (action, label, onClick) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'lvs-action';
            b.setAttribute('data-health-drawer-action', action);
            b.textContent = label;
            b.addEventListener('click', onClick);
            ctx.actions.appendChild(b);
        };
        button('edit', this.t('healthEdit', 'Edit'), () => void view.editIssueInline(issue));
        button('recheck', this.t('healthRecheck', 'Re-check'), () => void view.recheckIssue(issue));
        button('open', this.t('healthOpen', 'Open'), () => view.openIssue(issue));
    }

    /**
     * Page › category, and the tags. The report carries the page's name but only
     * the category's id and no tags, so both come from the page's own data,
     * fetched once per open and dropped if another bookmark opened meanwhile.
     */
    async _fillPlace(issue, where, tags) {
        const pageId = Number(issue.pageId);
        if (!Number.isFinite(pageId)) return;
        const ticket = ++this._pageLookup;
        const [categories, bookmark] = await Promise.all([
            fetch(`/api/categories?page=${pageId}`).then((r) => (r.ok ? r.json() : [])).catch(() => []),
            this.view.findBookmarkForIssue(issue, pageId),
        ]);
        if (ticket !== this._pageLookup || !where.isConnected) return;
        const category = Array.isArray(categories)
            ? categories.find((c) => String(c?.id) === String(issue.category))
            : null;
        const categoryName = category?.name || '';
        where.textContent = [issue.pageName, categoryName].filter(Boolean).join(' › ');
        const list = Array.isArray(bookmark?.record?.tags) ? bookmark.record.tags.filter(Boolean) : [];
        if (list.length) {
            tags.replaceChildren(...list.map((tag) => {
                const chip = document.createElement('span');
                chip.className = 'health-drawer-tag';
                chip.textContent = tag;
                return chip;
            }));
            tags.hidden = false;
        }
    }

    /* ── Sections ─────────────────────────────────────────────────────── */

    /** Every reason, not only the first the row has room for. */
    _fillWhy(body, issue) {
        const view = this.view;
        const entries = view.reasonEntries(issue);
        const since = view.renderBrokenSince(issue);
        if (!entries.length && !since) {
            body.innerHTML = `<p class="health-drawer-empty">${view.escape(this.t('healthScorePerfect', 'No issues found — full score.'))}</p>`;
            return;
        }
        const items = entries.map((entry) => `<li class="health-drawer-reason">${view.escape(entry.label)}</li>`).join('');
        body.innerHTML = `${items ? `<ul class="health-drawer-reasons">${items}</ul>` : ''}${since ? `<p class="health-drawer-since">${since}</p>` : ''}`;
    }

    _fillScore(body, issue) {
        body.classList.add('health-view-score-panel');
        body.innerHTML = this.view.renderScorePanel(issue);
    }

    /** The choices the check-mode badge menu offers, laid out flat. */
    _fillCheck(body, issue) {
        const view = this.view;
        body.classList.add('health-drawer-check');
        body.innerHTML = view.renderCheckModeChoices(issue);
        body.setAttribute('role', 'radiogroup');
        body.setAttribute('aria-label', this.t('healthCheckModeLabel', 'Availability checking'));
        body.querySelectorAll('[data-check-mode]').forEach((item) => {
            item.addEventListener('click', () => void view.setCheckMode(issue, item.getAttribute('data-check-mode')));
        });
        body.querySelectorAll('[data-check-interval]').forEach((item) => {
            item.addEventListener('click', () => void view.setMonitorInterval(issue, Number(item.getAttribute('data-check-interval'))));
        });
    }

    _fillExpect(body, issue, key) {
        const wrap = document.createElement('div');
        wrap.className = 'health-view-expect-panel';
        wrap.innerHTML = this.view.renderExpectPanel(issue);
        body.appendChild(wrap);
        this.view.bindExpectPanel(body, issue, key);
    }

    _fillMonitor(body, issue) {
        const view = this.view;
        body.innerHTML = view.renderMonitorStrip(issue)
            + (view.hasMonitorStats(issue) ? view.buildMonitorStatsHtml(issue) : '');
        view.bindMonitorChart(issue, body);
        body.querySelector('[data-monitor-export]')?.addEventListener('click', () => view.exportMonitorHistory(issue));
    }

    _archiveHtml(issue) {
        const view = this.view;
        return [view.renderArchiveDied(issue), view.renderLocalCopies(issue)]
            .filter(Boolean).join('').trim();
    }
}

window.HealthDrawer = HealthDrawer;
