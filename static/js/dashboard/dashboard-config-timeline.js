/**
 * Config → Timeline: containers, updates, monitors, network checks, Glances and
 * Unraid in one stream, newest first. An outage is the headline of its row, and
 * what came shortly before it is shown underneath as its likely cause.
 *
 * Lazy: this file is fetched when the section is opened (SECTION_MODULES), and
 * the data when the section is bound, never on opening the config view.
 */
(function (global) {
    'use strict';

    if (typeof global.DashboardConfig !== 'function') return;

    const FILTERS_KEY = 'nextdash:timeline-filters-v1';
    const SOURCES = [
        ['health', 'config.timelineSrcHealth', 'Bookmarks'],
        ['docker', 'config.timelineSrcDocker', 'Containers'],
        ['update', 'config.timelineSrcUpdate', 'Updates'],
        ['glances', 'config.timelineSrcGlances', 'Glances'],
        ['unraid', 'config.timelineSrcUnraid', 'Unraid'],
        ['check', 'config.timelineSrcCheck', 'Network checks'],
    ];
    const VIEWS = [
        ['all', 'config.timelineViewAll', 'All'],
        ['outages', 'config.timelineViewOutages', 'Only outages'],
        ['caused', 'config.timelineViewCaused', 'With a cause'],
    ];
    const ICONS = {
        down: 'warn', crash: 'warn', 'restart-loop': 'warn', unhealthy: 'warn',
        update: 'info', rollback: 'info',
        start: 'ok', healthy: 'ok',
    };

    function readFilters() {
        const base = { days: 7, view: 'all', sources: SOURCES.map((s) => s[0]) };
        try {
            const raw = JSON.parse(global.localStorage.getItem(FILTERS_KEY) || 'null');
            if (!raw || typeof raw !== 'object') return base;
            if ([1, 7, 30].includes(raw.days)) base.days = raw.days;
            if (VIEWS.some((v) => v[0] === raw.view)) base.view = raw.view;
            if (Array.isArray(raw.sources)) base.sources = raw.sources.filter((s) => SOURCES.some((x) => x[0] === s));
        } catch (e) { /* private window or blocked storage: the defaults */ }
        return base;
    }

    function writeFilters(f) {
        try { global.localStorage.setItem(FILTERS_KEY, JSON.stringify(f)); } catch (e) { /* not kept */ }
    }

    Object.assign(global.DashboardConfig.prototype, {

    renderTimelineSection() {
        const esc = (v) => this.dash.escapeHtml(v);
        if (!this._timeline) this._timeline = { filters: readFilters(), data: null, error: false, loading: false };
        const f = this._timeline.filters;
        const chips = SOURCES.map(([id, key, text]) => `<button type="button" class="tl-chip" data-tl-source="${id}" aria-pressed="${f.sources.includes(id)}">${esc(this.t(key, text))}</button>`).join('');
        const views = VIEWS.map(([id, key, text]) => `<label class="tl-radio"><input type="radio" name="tl-view" value="${id}"${f.view === id ? ' checked' : ''}> <span>${esc(this.t(key, text))}</span></label>`).join('');
        const days = [[1, 'config.timelineDay1', 'Last 24 hours'], [7, 'config.timelineDays7', 'Last 7 days'], [30, 'config.timelineDays30', 'Last 30 days']]
            .map(([n, key, text]) => `<option value="${n}"${f.days === n ? ' selected' : ''}>${esc(this.t(key, text))}</option>`).join('');
        return `
            <p class="config-view-intro">${esc(this.t('config.timelineIntro', 'Everything that happened, in one stream. An outage shows what came shortly before it.'))}</p>
            <div class="tl-toolbar">
                <div class="tl-chips" role="group" aria-label="${esc(this.t('config.timelineSources', 'Sources'))}">${chips}</div>
                <div class="tl-controls">
                    <fieldset class="tl-views"><legend class="sr-only">${esc(this.t('config.timelineView', 'Show'))}</legend>${views}</fieldset>
                    <select class="config-select tl-days" aria-label="${esc(this.t('config.timelinePeriod', 'Period'))}">${days}</select>
                    <button type="button" class="config-btn config-btn--small tl-refresh" title="${esc(this.t('config.timelineRefresh', 'Refresh'))}">${esc(this.t('config.timelineRefresh', 'Refresh'))}</button>
                </div>
            </div>
            <p class="tl-count" aria-live="polite"></p>
            <div class="tl-coverage"></div>
            <div id="config-timeline-list" class="tl-list"></div>`;
    },

    bindTimelineSection(container) {
        const st = this._timeline;
        const f = st.filters;
        const save = () => writeFilters(f);
        container.querySelectorAll('[data-tl-source]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.tlSource;
                f.sources = f.sources.includes(id) ? f.sources.filter((s) => s !== id) : [...f.sources, id];
                btn.setAttribute('aria-pressed', String(f.sources.includes(id)));
                save();
                void this.loadTimeline(container);
            });
        });
        container.querySelectorAll('input[name="tl-view"]').forEach((r) => {
            r.addEventListener('change', () => { f.view = r.value; save(); void this.loadTimeline(container); });
        });
        container.querySelector('.tl-days')?.addEventListener('change', (e) => {
            f.days = Number(e.target.value) || 7; save(); void this.loadTimeline(container);
        });
        container.querySelector('.tl-refresh')?.addEventListener('click', () => void this.loadTimeline(container));
        // On the list, which is made again with the section: one listener on the
        // long-lived container would be added once more by every visit.
        container.querySelector('#config-timeline-list')?.addEventListener('click', (e) => {
            if (e.target.closest('[data-tl-showall]')) {
                f.view = 'all';
                f.sources = SOURCES.map((s) => s[0]);
                save();
                container.querySelectorAll('[data-tl-source]').forEach((b) => b.setAttribute('aria-pressed', 'true'));
                const all = container.querySelector('input[name="tl-view"][value="all"]');
                if (all) all.checked = true;
                void this.loadTimeline(container);
            }
        });
        void this.loadTimeline(container);
    },

    async loadTimeline(container) {
        const st = this._timeline;
        const f = st.filters;
        st.abort?.abort();
        const ctl = new AbortController();
        st.abort = ctl;
        const q = new URLSearchParams({ days: String(f.days) });
        if (f.sources.length !== SOURCES.length) q.set('sources', f.sources.join(',') || 'none');
        if (f.view !== 'all') q.set('only', f.view);
        try {
            const res = await fetch(`/api/timeline?${q}`, { cache: 'no-store', signal: ctl.signal });
            if (!res.ok) throw new Error(String(res.status));
            st.data = await res.json();
            st.error = false;
        } catch (e) {
            if (e.name === 'AbortError') return;
            st.error = true;
        }
        if (this.section !== 'timeline' || !container.isConnected) return;
        this.paintTimeline(container);
    },

    timelineMinutes(ms) {
        const s = Math.round(Math.abs(ms) / 1000);
        if (s < 60) return this.t('config.timelineUnderMinute', 'under a minute');
        const m = Math.round(s / 60);
        if (m < 60) return this.t('config.timelineMin', '{n} min').replace('{n}', String(m));
        const h = Math.floor(m / 60);
        if (h < 48) return this.t('config.timelineHours', '{h}h {m}m').replace('{h}', String(h)).replace('{m}', String(m % 60));
        return this.t('config.timelineDaysN', '{n} days').replace('{n}', String(Math.floor(h / 24)));
    },

    /** What a row says, as a sentence a person would write. */
    timelineText(e) {
        const t = (k, d) => this.t(k, d);
        const name = e.subject?.name || '';
        const detail = e.detail ? ` (${e.detail})` : '';
        const fill = (s, v) => s.replace('{name}', name).replace('{detail}', v ?? '');
        if (e.source === 'update') {
            const ver = e.from || e.to ? ` ${e.from || '?'} → ${e.to || '?'}` : '';
            const map = {
                auto: t('config.timelineAutoUpdated', '{name} auto-updated'),
                manual: t('config.timelineUpdated', '{name} updated'),
                compose: t('config.timelineUpdatedCompose', '{name} updated (compose)'),
                'auto-rollback': t('config.timelineAutoRolledBack', '{name} rolled back automatically'),
            };
            if (e.kind === 'rollback') return fill(e.by === 'auto-rollback' ? map['auto-rollback'] : t('config.timelineRolledBack', '{name} rolled back')) + ver;
            return fill(map[e.by] || t('config.timelineUpdated', '{name} updated')) + ver;
        }
        if (e.source === 'docker') {
            const k = {
                start: ['config.timelineStarted', '{name} started'], stop: ['config.timelineStopped', '{name} stopped'],
                exit: ['config.timelineExited', '{name} exited'], crash: ['config.timelineCrashed', '{name} crashed'],
                unhealthy: ['config.timelineUnhealthy', '{name} unhealthy'], healthy: ['config.timelineHealthy', '{name} healthy again'],
                pause: ['config.timelinePaused', '{name} paused'], unpause: ['config.timelineUnpaused', '{name} resumed'],
                'restart-loop': ['config.timelineRestartLoop', '{name} restarting in a loop'],
            }[e.kind];
            if (!k) return `${name} ${e.kind}`;
            return fill(t(k[0], k[1])) + detail;
        }
        if (e.source === 'glances') {
            return `${name}: ${t('config.timelineOverRed', '{kind} over the red line').replace('{kind}', e.kind)}${e.detail ? ` (${e.detail})` : ''}`;
        }
        if (e.source === 'unraid') return e.detail || t('config.timelineUnraidEvent', 'Unraid event');
        // health and check outages
        return fill(t('config.timelineDown', '{name} down')) + (e.detail ? ` (${e.detail})` : '');
    },

    timelineSourceLabel(e) {
        const hit = SOURCES.find((s) => s[0] === e.source);
        return hit ? this.t(hit[1], hit[2]) : e.source;
    },

    timelineCauseSentence(c, ev) {
        const dur = this.timelineMinutes(c.gapMs);
        const when = c.gapMs >= 0
            ? this.t('config.timelineAfter', '{when} after').replace('{when}', dur)
            : this.t('config.timelineBefore', '{when} before').replace('{when}', dur);
        const what = this.timelineText(ev);
        return `${when} ${what.charAt(0).toLowerCase()}${what.slice(1)}`;
    },

    paintTimeline(container) {
        const esc = (v) => this.dash.escapeHtml(v);
        const st = this._timeline;
        const list = container.querySelector('#config-timeline-list');
        const count = container.querySelector('.tl-count');
        const cov = container.querySelector('.tl-coverage');
        if (!list) return;
        if (st.error || !st.data) {
            list.innerHTML = `<div class="tl-empty"><p>${esc(this.t('config.timelineError', 'Couldn\'t load the timeline.'))}</p><button type="button" class="config-btn config-btn--small tl-refresh-again">${esc(this.t('config.timelineTryAgain', 'Try again'))}</button></div>`;
            list.querySelector('.tl-refresh-again')?.addEventListener('click', () => void this.loadTimeline(container));
            if (count) count.textContent = '';
            return;
        }
        const data = st.data;
        const byId = new Map([...data.events, ...data.related].map((e) => [e.id, e]));

        // Where a source cannot reach as far back as the period, say so.
        const notes = [];
        for (const [id, key, text] of SOURCES) {
            const c = data.coverage?.[id];
            if (!c) continue;
            if (!c.ok && c.reason === 'not-configured') continue;
            if (c.ok && c.since && c.since > data.from + 3600e3 && (id === 'health' || id === 'check' || id === 'unraid')) {
                notes.push(this.t('config.timelineCoverageSince', '{source}: recorded since {when}')
                    .replace('{source}', this.t(key, text)).replace('{when}', this.formatRelative(c.since)));
            }
        }
        if (data.coverage?.links && !data.coverage.links.ok) {
            notes.push(this.t('config.timelineLinksUnknown', 'Containers could not be read, so outages are not tied to containers.'));
        }
        if (cov) cov.innerHTML = notes.length ? `<ul class="tl-notes">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '';

        if (count) {
            const n = data.events.length;
            count.textContent = n === 1
                ? this.t('config.timelineCountOne', '1 event')
                : this.t('config.timelineCount', '{n} events').replace('{n}', String(n));
        }
        if (!data.events.length) {
            const filtered = st.filters.view !== 'all' || st.filters.sources.length !== SOURCES.length;
            list.innerHTML = filtered
                ? `<div class="tl-empty"><p>${esc(this.t('config.timelineFilteredEmpty', 'Nothing matches these filters.'))}</p><button type="button" class="config-btn config-btn--small" data-tl-showall>${esc(this.t('config.timelineShowAll', 'Show all'))}</button></div>`
                : `<div class="tl-empty"><p>${esc(this.t('config.timelineEmpty', 'Nothing has happened in this period.'))}</p></div>`;
            return;
        }

        const lang = this.dash.language?.current || undefined;
        const dayFmt = new Intl.DateTimeFormat(lang, { weekday: 'long', day: 'numeric', month: 'long' });
        const timeFmt = new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' });
        const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
        const today = startOfDay(Date.now());
        const dayLabel = (ms) => {
            const day = startOfDay(ms);
            if (day === today) return this.t('config.timelineToday', 'Today');
            if (day === today - 86400e3) return this.t('config.timelineYesterday', 'Yesterday');
            return dayFmt.format(new Date(ms));
        };

        let html = '';
        let current = null;
        for (const e of data.events) {
            const day = startOfDay(e.at);
            if (day !== current) {
                if (current !== null) html += '</ol></section>';
                current = day;
                html += `<section class="tl-day"><h3 class="tl-day-title">${esc(dayLabel(e.at))}</h3><ol class="tl-items">`;
            }
            html += this.timelineRowHtml(e, byId, timeFmt);
        }
        if (current !== null) html += '</ol></section>';
        if (data.truncated) {
            html += `<p class="tl-more">${esc(this.t('config.timelineTruncated', 'Older events are left out. Pick a shorter period or a source to see fewer.'))}</p>`;
        }
        list.innerHTML = html;
    },

    timelineRowHtml(e, byId, timeFmt) {
        const esc = (v) => this.dash.escapeHtml(v);
        const tone = e.outage ? 'warn' : (ICONS[e.kind] || 'neutral');
        const iso = new Date(e.at).toISOString();
        let tail = '';
        if (e.ongoing) tail = ` · ${this.t('config.timelineOngoing', 'ongoing')}`;
        else if (e.durationMs) tail = ` · ${this.timelineMinutes(e.durationMs)}`;
        if (e.count > 1 && e.kind === 'down') tail += ` · ${this.t('config.timelineTimes', '{n} times').replace('{n}', String(e.count))}`;
        let cause = '';
        if (e.outage) {
            const parts = (e.causes || []).map((c) => ({ c, ev: byId.get(c.eventId) })).filter((p) => p.ev);
            if (parts.length) {
                const [main, ...rest] = parts;
                const label = main.c.confidence === 'likely'
                    ? this.t('config.timelinePossibleCause', 'Possible cause')
                    : this.t('config.timelineLikelyCause', 'Likely cause');
                const link = main.ev.link ? ` <a class="tl-cause-link" href="${esc(main.ev.link)}">${esc(this.t('config.timelineOpen', 'Open'))}</a>` : '';
                const others = rest.length
                    ? `<span class="tl-also">${esc(this.t('config.timelineAlso', 'Also nearby'))}: ${rest.map((p) => esc(this.timelineText(p.ev))).join('; ')}</span>`
                    : '';
                cause = `<div class="tl-cause"><span>${esc(label)}: ${esc(this.timelineCauseSentence(main.c, main.ev))}${link}</span>${others}</div>`;
            } else {
                cause = `<div class="tl-cause tl-cause--none">${esc(this.t('config.timelineNoCause', 'No cause found'))}</div>`;
            }
        }
        const text = esc(this.timelineText(e));
        const body = e.link ? `<a class="tl-text" href="${esc(e.link)}">${text}</a>` : `<span class="tl-text">${text}</span>`;
        return `<li class="tl-item tl-item--${tone}">
            <div class="tl-row">
                <time class="tl-time" datetime="${esc(iso)}">${esc(timeFmt.format(new Date(e.at)))}</time>
                <span class="tl-dot" aria-hidden="true"></span>
                <span class="tl-main">${body}<span class="tl-tail">${esc(tail)}</span></span>
                <span class="tl-src">${esc(this.timelineSourceLabel(e))}</span>
            </div>${cause}</li>`;
    },

    });

    global.DashboardConfigTimelineReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
