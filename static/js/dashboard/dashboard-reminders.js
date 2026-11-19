/**
 * Reminders on bookmarks.
 *
 * A bookmark can carry `remindAt`, a time the reader chose to be reminded of
 * the link. This file is everything the browser does with it: choosing the
 * time (a small menu, the same presets the Inbox offers for a snooze), writing
 * it, the clock on the row, and the list of reminders that are due, which the
 * bell reads (reminder-bell-source.js). The server pushes a due reminder while
 * the dashboard is closed (internal/app/reminder.go); nothing here depends on
 * that having happened.
 *
 * The time is written with PATCH /api/bookmarks and a `fields` entry, so a tab
 * that holds an old copy of the page cannot write another bookmark back over
 * it, and the server resets "already pushed" when the time changes.
 */
class DashboardReminders {
    constructor(dash) {
        this.dash = dash;
        this._menu = null;
        this._outside = null;
        this._keys = null;
        // The due reminders as the server lists them (see refreshDue); null until asked.
        this._dueRows = null;
    }

    t(key, fallback, params) {
        const val = this.dash.language?.t ? this.dash.language.t(key) : null;
        const text = (val && val !== key) ? val : fallback;
        return params
            ? Object.entries(params).reduce(
                (acc, [name, value]) => acc.replaceAll(`{${name}}`, String(value)),
                String(text)
            )
            : String(text);
    }

    escape(text) {
        return window.NextDashHtml.escapeHtml(String(text ?? ''));
    }

    /* ── Times ─────────────────────────────────────────────────────────────── */

    /** The presets, each resolved to a time on the real clock. */
    presets(now = new Date()) {
        const at = (date) => date.getTime();
        const day = (offset, hour) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, hour, 0, 0, 0);
        const list = [
            { key: '3h', label: this.t('dashboard.reminderIn3h', 'In 3 hours'), at: now.getTime() + 3 * 3600000 },
        ];
        // "This evening" only makes sense while it is still ahead, and not so
        // close that it is the same as "in 3 hours".
        if (now.getHours() < 15) {
            list.push({ key: 'evening', label: this.t('dashboard.reminderEvening', 'This evening'), at: at(day(0, 18)) });
        }
        // The first Saturday or Sunday 09:00 still ahead: on a Saturday morning
        // that is today, later that day it is Sunday, not a week on.
        const weekend = day(0, 9);
        while ((weekend.getDay() !== 6 && weekend.getDay() !== 0) || weekend.getTime() <= now.getTime()) {
            weekend.setDate(weekend.getDate() + 1);
        }
        list.push(
            { key: 'tomorrow', label: this.t('dashboard.reminderTomorrow', 'Tomorrow'), at: at(day(1, 9)) },
            { key: 'weekend', label: this.t('dashboard.reminderWeekend', 'This weekend'), at: at(weekend) },
            { key: 'week', label: this.t('dashboard.reminderNextWeek', 'Next week'), at: at(day(7, 9)) },
        );
        return list;
    }

    /**
     * A time typed in the palette: `tonight`, `tomorrow`, `weekend`, `next week`,
     * `3h`, `2d`, `1w`, a date (`2026-12-24`) or a day and month (`24 dec`).
     * Returns the time, or 0 when the words are not a time.
     */
    parseWhen(words, now = new Date()) {
        const text = String(words || '').trim().toLowerCase().replace(/\s+/g, ' ');
        if (!text) return 0;
        const presets = new Map(this.presets(now).map((p) => [p.key, p.at]));
        const day = (offset, hour) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, hour, 0, 0, 0).getTime();
        // 18:00, or 21:00 once 18:00 has passed, so "tonight" still works in the evening.
        const evening = day(0, 18) > now.getTime() ? day(0, 18) : day(0, 21);
        const named = {
            tonight: evening, evening, 'this evening': evening,
            tomorrow: presets.get('tomorrow'), weekend: presets.get('weekend'), 'this weekend': presets.get('weekend'),
            'next week': presets.get('week'),
        };
        let at = named[text] || 0;
        const rel = /^(\d{1,3})\s*(h|d|w)$/.exec(text);
        if (!at && rel) {
            const unit = { h: 3600000, d: 86400000, w: 604800000 }[rel[2]];
            at = now.getTime() + Number(rel[1]) * unit;
        }
        const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
        if (!at && iso) {
            const date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 9, 0, 0, 0);
            // 2026-02-31 would roll over into March: not a date.
            if (date.getMonth() === Number(iso[2]) - 1) at = date.getTime();
        }
        const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
        const dm = /^(\d{1,2}) ([a-z]{3})[a-z]*$/.exec(text);
        if (!at && dm && months.includes(dm[2])) {
            const month = months.indexOf(dm[2]);
            let date = new Date(now.getFullYear(), month, Number(dm[1]), 9, 0, 0, 0);
            if (date.getTime() <= now.getTime()) date = new Date(now.getFullYear() + 1, month, Number(dm[1]), 9, 0, 0, 0);
            // 31 feb would roll over into March: not a date.
            if (date.getMonth() === month) at = date.getTime();
        }
        return at > now.getTime() ? at : 0;
    }

    /** A time as the reader says it: "today 18:00", "tomorrow 09:00", "24 Dec 09:00". */
    formatWhen(ts) {
        const when = new Date(Number(ts) || 0);
        if (Number.isNaN(when.getTime()) || !ts) return '';
        const now = new Date();
        const hm = when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        const days = Math.round((startOfDay(when) - startOfDay(now)) / 86400000);
        if (days === 0) return `${this.t('dashboard.reminderToday', 'today')} ${hm}`;
        if (days === 1) return `${this.t('dashboard.reminderTomorrowLower', 'tomorrow')} ${hm}`;
        const date = when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
        return `${date} ${hm}`;
    }

    /* ── What is due ───────────────────────────────────────────────────────── */

    /** Every bookmark the dashboard holds, kept ones included, once per page and address. */
    _everyBookmark() {
        const d = this.dash;
        const seen = new Set();
        const out = [];
        [d.allBookmarks, d.unsortedBookmarks, d.bookmarks].forEach((list) => {
            (list || []).forEach((b) => {
                if (!b || !b.url) return;
                const key = `${Number(b.pageId) || 0}|${b.url}`;
                if (seen.has(key)) return;
                seen.add(key);
                out.push(b);
            });
        });
        return out;
    }

    /**
     * Ask the server which reminders are due. The dashboard does not always
     * hold the bookmarks of every page, and a reminder on another page has to
     * reach the bell all the same. Keeps the last answer when the request fails.
     */
    async refreshDue() {
        try {
            const res = await fetch('/api/reminders/due', { cache: 'no-store' });
            if (!res.ok) return;
            const rows = await res.json();
            if (Array.isArray(rows)) this._dueRows = rows.filter((row) => row && row.url);
        } catch {
            // The bell keeps what it had.
        }
    }

    /** Reminders whose time has come, oldest first. */
    due(now = Date.now()) {
        if (Array.isArray(this._dueRows)) {
            return this._dueRows.filter((row) => Number(row.remindAt) > 0 && Number(row.remindAt) <= now)
                .sort((a, b) => a.remindAt - b.remindAt);
        }
        return this._everyBookmark()
            .filter((b) => Number(b.remindAt) > 0 && Number(b.remindAt) <= now)
            .sort((a, b) => a.remindAt - b.remindAt);
    }

    /** The page a bookmark lives on, for the write. */
    pageIdOf(bookmark, fallback) {
        return Number(bookmark?.pageId) || Number(fallback) || Number(this.dash.currentPageId) || 0;
    }

    /* ── Writing ───────────────────────────────────────────────────────────── */

    /** Every in-memory copy of the row, so the grid and the bell agree at once. */
    _copiesOf(bookmark, pageId) {
        const d = this.dash;
        const out = new Set([bookmark]);
        [d.bookmarks, d.allBookmarks, d.unsortedBookmarks].forEach((list) => {
            (list || []).forEach((b) => {
                if (b && b.url === bookmark.url && (!b.pageId || Number(b.pageId) === Number(pageId))) out.add(b);
            });
        });
        return [...out];
    }

    /**
     * Set the reminder to `at` (a time), or clear it with 0. Applied at once
     * and put back when the write fails. Resolves to true when it was saved.
     */
    async set(ref, at, { quiet = false } = {}) {
        const d = this.dash;
        const bookmark = ref?.bookmark;
        if (!bookmark?.url) return false;
        const pageId = this.pageIdOf(bookmark, ref.pageId);
        if (!pageId) return false;
        const next = Math.max(0, Math.floor(Number(at) || 0));
        const before = Number(bookmark.remindAt) || 0;
        const apply = (value) => {
            this._copiesOf(bookmark, pageId).forEach((b) => {
                if (value > 0) b.remindAt = value; else delete b.remindAt;
                delete b.remindSentAt;
            });
        };
        apply(next);
        // A page held in the cache must not bring the old time back when it is
        // opened and saved.
        d.data?.invalidatePageDataCache?.(pageId);
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        try {
            const res = await fetcher('/api/bookmarks', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: pageId, updates: [{ url: bookmark.url, fields: { remindAt: next } }] }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const answer = await res.json().catch(() => ({}));
            if (answer && Number(answer.updated) === 0) throw new Error('not found');
        } catch {
            apply(before);
            d.data?.invalidatePageDataCache?.(pageId);
            this.refresh();
            d.showErrorNotification?.(this.t('dashboard.reminderFailed', 'Could not save the reminder'));
            return false;
        }
        this.refresh();
        if (!quiet) {
            const name = bookmark.name || bookmark.url;
            const message = next > 0
                ? this.t('dashboard.reminderSet', 'Reminder set for {time}: {name}', { time: this.formatWhen(next), name })
                : this.t('dashboard.reminderCleared', 'Reminder removed: {name}', { name });
            d.showNotification?.(message, 'success', {
                duration: 6000,
                undoCallback: () => { void this.set(ref, before, { quiet: true }); },
            });
        }
        return true;
    }

    /** Draw the rows again and ask the bell to look at the list. */
    refresh() {
        const d = this.dash;
        if (typeof d.renderDashboard === 'function') d.renderDashboard();
        window.ReminderBellSource?.refresh?.();
    }

    /* ── The menu ──────────────────────────────────────────────────────────── */

    closeMenu() {
        if (this._menu) { this._menu.remove(); this._menu = null; }
        if (this._outside) { document.removeEventListener('click', this._outside, true); this._outside = null; }
        if (this._keys) { document.removeEventListener('keydown', this._keys, true); this._keys = null; }
    }

    /**
     * The choice of a time, as a small popover under `anchor`: the presets, a
     * date and time field, and Remove when a reminder is set. Same look as the
     * Inbox's snooze menu, whose classes it borrows.
     */
    openMenu(ref, anchor, { onDone } = {}) {
        this.closeMenu();
        const bookmark = ref?.bookmark;
        if (!bookmark?.url) return;
        const menu = document.createElement('div');
        menu.className = 'inbox-snooze-menu reminder-menu';
        menu.id = 'reminder-menu';
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', this.t('dashboard.reminderMenuLabel', 'Remind me'));
        const current = Number(bookmark.remindAt) || 0;
        const soon = new Date(Date.now() + 60000);
        const pad = (n) => String(n).padStart(2, '0');
        const min = `${soon.getFullYear()}-${pad(soon.getMonth() + 1)}-${pad(soon.getDate())}T${pad(soon.getHours())}:${pad(soon.getMinutes())}`;
        const label = this.t('dashboard.reminderCustom', 'Pick a date and time');
        menu.innerHTML = this.presets()
            .map((p) => `<button type="button" class="inbox-snooze-option" role="menuitem" data-remind-at="${p.at}">${this.escape(p.label)}</button>`)
            .join('')
            + `<div class="inbox-snooze-custom">
                <label class="inbox-snooze-custom-label" for="reminder-when">${this.escape(label)}</label>
                <input type="datetime-local" id="reminder-when" class="inbox-snooze-date" min="${min}" aria-label="${this.escape(label)}">
                <button type="button" class="inbox-snooze-option" role="menuitem" data-remind-set>${this.escape(this.t('dashboard.reminderSetButton', 'Set reminder'))}</button>
            </div>`
            + (current > 0
                ? `<button type="button" class="inbox-snooze-option" role="menuitem" data-remind-clear>${this.escape(
                    this.t('dashboard.reminderRemove', 'Remove reminder ({time})', { time: this.formatWhen(current) }))}</button>`
                : '');
        document.body.appendChild(menu);
        this._menu = menu;

        const rect = anchor?.getBoundingClientRect?.();
        if (rect) {
            menu.style.left = `${Math.max(8, Math.round(Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8)))}px`;
            const below = rect.bottom + 6;
            menu.style.top = below + menu.offsetHeight > window.innerHeight - 8
                ? `${Math.max(8, Math.round(rect.top - menu.offsetHeight - 6))}px`
                : `${Math.round(below)}px`;
        }

        const choose = (at) => {
            this.closeMenu();
            void this.set(ref, at).then((ok) => { if (ok) onDone?.(); });
        };
        menu.querySelectorAll('[data-remind-at]').forEach((btn) => {
            btn.addEventListener('click', () => choose(Number(btn.getAttribute('data-remind-at')) || 0));
        });
        menu.querySelector('[data-remind-clear]')?.addEventListener('click', () => choose(0));
        const input = menu.querySelector('#reminder-when');
        // Not on `change`: a browser fires it while the minutes are still being
        // typed. The button, or Enter in the field, is the answer.
        const setFromField = () => {
            const at = input?.value ? new Date(input.value).getTime() : 0;
            // An empty or past time is a slip, not an instruction.
            if (!(at > Date.now())) return;
            choose(at);
        };
        menu.querySelector('[data-remind-set]')?.addEventListener('click', setFromField);
        input?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); setFromField(); }
            if (e.key !== 'Escape') e.stopPropagation();
        });

        this._outside = (e) => {
            if (!menu.contains(e.target) && !anchor?.contains?.(e.target)) this.closeMenu();
        };
        this._keys = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.closeMenu();
                anchor?.focus?.({ preventScroll: true });
                return;
            }
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) || !menu.contains(document.activeElement)) return;
            const stops = [...menu.querySelectorAll('[role="menuitem"]'), ...(input ? [input] : [])];
            if (!stops.length) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            const last = stops.length - 1;
            const at = stops.indexOf(document.activeElement);
            const next = e.key === 'Home' ? 0 : e.key === 'End' ? last
                : e.key === 'ArrowDown' ? (at >= last ? 0 : at + 1) : (at <= 0 ? last : at - 1);
            stops[next]?.focus({ preventScroll: true });
        };
        // On top of whatever view it opened from: Escape closes it and goes no further.
        window.EscapeOwner?.registerOwner?.('reminder-menu', {
            isOpen: () => Boolean(document.getElementById('reminder-menu')),
        });
        setTimeout(() => document.addEventListener('click', this._outside, true), 0);
        document.addEventListener('keydown', this._keys, true);
        menu.querySelector('.inbox-snooze-option')?.focus({ preventScroll: true });
    }

    /* ── The row ───────────────────────────────────────────────────────────── */

    /**
     * The small clock on a row that has a reminder: grey while it is ahead, in
     * the accent colour once it is due. Returns null for a row without one.
     */
    badgeFor(bookmark) {
        const at = Number(bookmark?.remindAt) || 0;
        if (at <= 0) return null;
        const due = at <= Date.now();
        const badge = document.createElement('span');
        badge.className = 'bookmark-remind-badge bookmark-superscript-badge' + (due ? ' is-due' : '');
        const text = due
            ? this.t('dashboard.reminderDue', 'Reminder due since {time}', { time: this.formatWhen(at) })
            : this.t('dashboard.reminderAt', 'Reminder: {time}', { time: this.formatWhen(at) });
        badge.title = text;
        badge.setAttribute('role', 'img');
        badge.setAttribute('aria-label', text);
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        svg.innerHTML = '<circle cx="12" cy="12" r="8.25"></circle><path d="M12 7.5V12l3 2"></path>';
        badge.appendChild(svg);
        return badge;
    }

    /** What the row's clock depends on, for the incremental renderer. */
    fingerprintFor(bookmark) {
        const at = Number(bookmark?.remindAt) || 0;
        return at > 0 ? `${at}:${at <= Date.now() ? 'due' : 'ahead'}` : '0';
    }
}

window.DashboardReminders = DashboardReminders;
