'use strict';
/**
 * Inbox's side panel: one saved link, read in full.
 *
 * The panel itself -- host, placement, phone fullscreen, ScrollLock and the
 * remembered sections -- is the shared one (list-view-drawer.js), the same the
 * Containers and Health views open. This class fills it. Every button calls
 * the method the row's own button used to call, so the panel and the keys
 * cannot disagree about what an action does.
 */
const INBOX_SECTIONS_KEY = 'nextdash.inbox.sections';
const INBOX_SECTIONS_DEFAULT = [];

class InboxDrawer {
    constructor(view) {
        this.view = view;
        this.base = new window.ListViewDrawer({
            id: 'inbox',
            storageKey: INBOX_SECTIONS_KEY,
            defaultSections: INBOX_SECTIONS_DEFAULT,
            closeLabel: this.t('inboxDrawerClose', 'Close'),
            onClose: () => this.view.onDrawerClosed?.(),
            // Config → Inbox: a press beside the panel closes it (a row moves
            // it instead), unless the setting keeps it open.
            closeOnOutside: (target) => this.view.dash?.settings?.inboxViewCloseOutside !== false
                && !target.closest('.inbox-item'),
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

    /** section: one to open on arrival (an accordion section's name). */
    open(item, { section = null } = {}) {
        if (!item) return;
        const title = item.previewTitle || item.title || item.domain || item.url;
        this.base.open(item.id, {
            title,
            build: (panel, ctx) => {
                panel.classList.add('inbox-drawer', 'config-bm-drawer');
                // Config → Inbox: the wider panel.
                panel.parentElement?.classList.toggle('is-wide', this.view.dash?.settings?.inboxViewPanelWidth === 'wide');
                panel.setAttribute('data-inbox-drawer', item.id);
                // The layout carries its own name; the side panel's heading
                // would say it twice (as in the Bookmarks view).
                ctx.heading.hidden = true;
                panel.insertAdjacentHTML('beforeend', this._render(item));
                this._wire(panel, item);
            },
        });
        if (section) {
            const acc = this.base.panel?.querySelector(`[data-slp-acc="${CSS.escape(section)}"]`);
            if (acc) {
                acc.open = true;
                acc.scrollIntoView?.({ block: 'nearest' });
            }
        }
    }

    close() {
        this.base.close({ silent: true });
    }

    destroy() {
        this.base.destroy();
    }

    /**
     * Rebuild for the item on show, from the view's current items, so a read,
     * a snooze or a note shows at once. A field with focus is left alone, and
     * an item that is gone closes the panel.
     */
    refresh() {
        if (!this.isOpen()) return;
        const active = document.activeElement;
        if (active && this.base.panel?.contains(active) && active.matches?.('input, textarea')) return;
        const item = this.view.itemById(this.currentKey());
        if (!item) {
            this.close();
            this.view.onDrawerClosed?.();
            return;
        }
        // Which sections are open is remembered by the layout itself.
        const scroll = this.base.panel?.scrollTop || 0;
        this.open(item);
        if (this.base.panel) this.base.panel.scrollTop = scroll;
    }

    /* ── The layout (shared/side-panel-layout.js) ─────────────────────── */

    _render(item) {
        const view = this.view;
        const L = window.SidePanelLayout;
        const esc = (v) => view.escape(v);
        const url = String(item.url || '');
        const snoozed = view.isSnoozed(item);
        const iconSrc = view.resolveIconSrc(item.icon) || String(item.previewImage || '').trim();
        const icon = window.BookmarkFeedRow?.renderIcon?.(iconSrc, esc)
            || (iconSrc ? `<img src="${esc(iconSrc)}" alt="" loading="lazy">` : '🔗');
        const source = String(item.source || '').trim();
        const added = view.formatAddedDate(item.addedAt);
        const where = [
            view.formatRelativeTime(item.addedAt) ? this.t('inboxDrawerAddedAgo', 'added {when}', { when: view.formatRelativeTime(item.addedAt) }) : '',
            source && source !== 'paste' ? this.t('inboxDrawerVia', 'via {source}', { source }) : '',
        ].filter(Boolean).join(' · ');
        const badge = snoozed
            ? { text: this.t('inboxDrawerSleepingBadge', 'sleeping'), tone: 'muted' }
            : (item.readAt ? { text: this.t('inboxDrawerReadBadge', 'read'), tone: 'muted' } : { text: this.t('inboxDrawerUnread', 'unread'), tone: 'info' });
        const actions = [
            { action: 'open', label: this.t('inboxOpen', 'Open'), primary: true },
            { action: 'promote', label: this.t('inboxPromote', 'Promote'), title: this.t('inboxPromoteHint', 'Give it a page (p)') },
            ...(view.keptEnabled() ? [{ action: 'keep', label: this.t('inboxTriageKeep', 'Keep'),
                title: `${this.t('inboxKeepExplains', 'Keeps the link for good, in Bookmarks → Unsorted, without giving it a page yet')} (Shift+K)` }] : []),
        ];
        const more = [
            item.readAt
                ? { action: 'unread', label: this.t('inboxMarkUnread', 'Mark unread') }
                : { action: 'read', label: this.t('inboxMarkRead', 'Mark read') },
            snoozed
                ? { action: 'wake', label: this.t('inboxWake', 'Wake now') }
                : { action: 'snooze', label: this.t('inboxSnooze', 'Snooze') },
            { action: 'share', label: this.t('inboxCopyItemLink', 'Copy link to this item') },
            { action: 'delete', label: this.t('inboxDelete', 'Delete'), danger: true },
        ];
        L.moreLabel = this.t('inboxMoreActions', 'More actions');
        const head = L.head(esc, {
            icon, title: item.previewTitle || item.title || item.domain || url, badge, more,
            url: /^https?:\/\//i.test(url) ? url : '', urlLabel: view.formatUrlDisplay(url), where, actions,
        });

        // The summary: the preview as the site gives it, then the facts.
        const img = String(item.previewImage || '').trim();
        const ptitle = String(item.previewTitle || '').trim();
        const desc = String(item.previewDesc || '').trim();
        const card = ptitle || desc || img
            ? `<div class="config-bm-details-card${img ? '' : ' is-text'}">
                    ${img ? `<img class="config-bm-details-image inbox-drawer-preview-img" src="${esc(img)}" alt="" loading="lazy">` : ''}
                    <div class="config-bm-details-text">
                        ${ptitle ? `<div class="config-bm-details-title">${esc(ptitle)}</div>` : ''}
                        ${desc ? `<div class="config-bm-details-desc inbox-drawer-desc">${esc(desc)}</div>` : ''}
                    </div>
                </div>`
            : `<p class="config-bm-panel-muted">${esc(this.t('inboxDrawerNoPreview', 'No preview yet.'))}</p>`;
        const tags = (Array.isArray(item.tags) ? item.tags : []).filter(Boolean);
        const chips = [
            ...tags.map((tag) => L.chip(esc, `#${tag}`, 'is-tag')),
            L.chip(esc, /^https:\/\//i.test(url) ? 'https' : this.t('inboxDrawerPlain', 'plain http'), /^https:\/\//i.test(url) ? '' : 'is-warn'),
            added ? L.chip(esc, this.t('inboxDrawerAddedOn', 'added {date}', { date: added })) : '',
            item.note ? L.chip(esc, this.t('inboxDrawerHasNote', 'note')) : '',
        ].join('');
        const summary = L.viz(`${card}<div class="config-bm-details-chips">${chips}</div>`);

        const field = (label, value, attr = '') => (value
            ? `<div class="config-bm-usage-kv"><span>${esc(label)}</span><span${attr}>${esc(value)}</span></div>`
            : '');
        const details = [
            field(this.t('inboxDrawerSource', 'Source'), source && source !== 'paste' ? source : '', ' data-inbox-source'),
            field(this.t('inboxDrawerAdded', 'Added'), added),
            field(this.t('inboxDrawerRead', 'Read'), item.readAt ? view.formatAddedDate(item.readAt) : this.t('inboxDrawerNotYet', 'not yet')),
            field(this.t('inboxDrawerSleeping', 'Sleeping until'), snoozed ? view.formatSnoozeWake(item.snoozedUntil) : ''),
        ].join('');
        const note = String(item.note || '');
        const sections = [
            L.acc(esc, 'inbox', 'note', this.t('inboxDrawerNote', 'Note'),
                note ? this.t('inboxDrawerNoteSaves', 'saves as you go') : this.t('inboxDrawerNoneYet', 'none yet'),
                `<label class="config-bm-field inbox-drawer-note-field">
                    <textarea class="config-text inbox-drawer-note-input" data-inbox-note rows="3"
                        aria-label="${esc(this.t('inboxDrawerNote', 'Note'))}"
                        placeholder="${esc(this.t('inboxDrawerNotePlaceholder', 'A line on why this was saved'))}">${esc(note)}</textarea>
                    <span class="config-bm-field-status" role="status" data-inbox-note-status></span>
                </label>`, true),
            L.acc(esc, 'inbox', 'tags', this.t('inboxDrawerTags', 'Tags'),
                tags.length ? this.t('inboxDrawerTagCount', '{n} tags', { n: tags.length }) : this.t('inboxDrawerNoneYet', 'none yet'),
                `${view.renderItemTags(item) || `<p class="config-bm-panel-muted">${esc(this.t('inboxDrawerNoTags', 'No tags yet.'))}</p>`}
                 <span class="tag-suggest-chips" data-inbox-suggest></span>
                 <div class="config-bm-details-buttons">
                    <button type="button" class="config-btn config-btn--small" data-slp-action="tags">${esc(this.t('inboxTagsEdit', 'Edit tags'))}</button>
                 </div>`, true),
            L.acc(esc, 'inbox', 'details', this.t('inboxDrawerDetails', 'Details'),
                item.readAt ? this.t('inboxDrawerReadBadge', 'read') : this.t('inboxDrawerUnread', 'unread'), details),
            L.acc(esc, 'inbox', 'remove', this.t('inboxDrawerRemove', 'Remove'), '',
                `<div class="config-bm-details-buttons">
                    <button type="button" class="config-btn config-btn--small config-btn--danger" data-slp-action="delete">${esc(this.t('inboxDelete', 'Delete'))}</button>
                 </div>
                 <p class="config-bm-panel-muted">${esc(this.t('inboxDrawerDeleteHint', 'Undo is offered right after.'))}</p>`),
        ];
        return `${head}${summary}${L.accList(sections)}`;
    }

    _wire(panel, item) {
        const view = this.view;
        window.SidePanelLayout.bind(panel, {
            group: 'inbox',
            onAction: (action, button) => this._act(action, item, button),
        });
        panel.querySelector('.inbox-drawer-preview-img')?.addEventListener('error', (e) => e.currentTarget.remove(), { once: true });
        panel.querySelectorAll('[data-inbox-tag]').forEach((chip) => {
            chip.addEventListener('click', () => view.filterByTag(chip.getAttribute('data-inbox-tag')));
        });
        view.fillSuggestChips(panel, item);

        // The note is edited where it is read, and kept on leaving the field.
        const note = panel.querySelector('[data-inbox-note]');
        const status = panel.querySelector('[data-inbox-note-status]');
        note?.addEventListener('change', async () => {
            const next = note.value;
            if (next.trim() === String(item.note || '').trim()) return;
            const ok = await view.saveNote(item, next, { skipRender: true, quiet: true });
            if (status) status.textContent = ok ? this.t('inboxNoteSaved', 'Note saved') : this.t('inboxNoteFailed', 'Could not save the note');
            if (ok) item.note = next.trim();
        });
    }

    _act(action, item, button) {
        const view = this.view;
        switch (action) {
            case 'open': view.openItem(item); break;
            case 'promote': view.promoteItem(item); break;
            case 'keep':
                view.selectItemById(item.id);
                void view.keepItem(item);
                break;
            case 'read': void view.markReadFromKeyboard(item); break;
            case 'unread': void view.markUnreadFromRow(item); break;
            case 'snooze': view.openSnoozeMenu(item, button); break;
            case 'wake': void view.wakeItem(item); break;
            case 'share': void view.copyItemLink(item.id); break;
            case 'tags': void view.editTags(item); break;
            case 'delete': void view.deleteItemWithUndo(item.id); break;
            default: break;
        }
    }
}

window.InboxDrawer = InboxDrawer;
