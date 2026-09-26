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
const INBOX_SECTIONS_DEFAULT = ['preview', 'note', 'tags'];

class InboxDrawer {
    constructor(view) {
        this.view = view;
        this.base = new window.ListViewDrawer({
            id: 'inbox',
            storageKey: INBOX_SECTIONS_KEY,
            defaultSections: INBOX_SECTIONS_DEFAULT,
            closeLabel: this.t('inboxDrawerClose', 'Close'),
            onClose: () => this.view.onDrawerClosed?.(),
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

    /** section: one to open on arrival. */
    open(item, { section = null } = {}) {
        if (!item) return;
        const title = item.previewTitle || item.title || item.domain || item.url;
        this.base.open(item.id, {
            title,
            build: (panel, ctx) => {
                panel.classList.add('inbox-drawer');
                panel.setAttribute('data-inbox-drawer', item.id);
                this._fillHead(ctx, item);
                if (String(item.previewImage || '').trim() || item.previewDesc) {
                    this._fillPreview(ctx.section('preview', this.t('inboxDrawerPreview', 'Preview')), item);
                }
                this._fillNote(ctx.section('note', this.t('inboxDrawerNote', 'Note')), item);
                this._fillTags(ctx.section('tags', this.t('inboxDrawerTags', 'Tags')), item);
                this._fillDetails(ctx.section('details', this.t('inboxDrawerDetails', 'Details')), item);
            },
        });
        if (section) this.base.openSection(section);
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
        const open = Array.from(this.base.panel?.querySelectorAll('.lvs-drawer-section[open]') || [])
            .map((el) => el.getAttribute('data-lvs-section'));
        const scroll = this.base.panel?.scrollTop || 0;
        this.open(item);
        open.forEach((name) => this.base.openSection(name));
        if (this.base.panel) this.base.panel.scrollTop = scroll;
    }

    /* ── Head ─────────────────────────────────────────────────────────── */

    _button(host, action, label, onClick) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'lvs-action';
        b.setAttribute('data-inbox-drawer-action', action);
        b.textContent = label;
        b.addEventListener('click', onClick);
        host.appendChild(b);
        return b;
    }

    _fillHead(ctx, item) {
        const view = this.view;
        const url = String(item.url || '');
        if (/^https?:\/\//i.test(url)) {
            const link = document.createElement('a');
            link.className = 'inbox-drawer-url';
            link.href = url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = view.formatUrlDisplay(url);
            ctx.head.insertBefore(link, ctx.actions);
        }

        if (item.readAt) {
            this._button(ctx.actions, 'unread', this.t('inboxMarkUnread', 'Mark unread'), () => void view.markUnreadFromRow(item));
        } else {
            this._button(ctx.actions, 'read', this.t('inboxMarkRead', 'Mark read'), () => void view.markReadFromKeyboard(item));
        }
        if (view.isSnoozed(item)) {
            this._button(ctx.actions, 'wake', this.t('inboxWake', 'Wake now'), () => void view.wakeItem(item));
        } else {
            this._button(ctx.actions, 'snooze', this.t('inboxSnooze', 'Snooze'), (e) => view.openSnoozeMenu(item, e.currentTarget));
        }
        this._button(ctx.actions, 'note',
            item.note ? this.t('inboxEditNote', 'Edit note') : this.t('inboxAddNote', 'Note'),
            () => void view.editNote(item));
        this._button(ctx.actions, 'delete', this.t('inboxDelete', 'Delete'), () => void view.deleteItemWithUndo(item.id))
            .classList.add('lvs-action--danger');
    }

    /* ── Sections ─────────────────────────────────────────────────────── */

    _fillPreview(body, item) {
        const view = this.view;
        const img = String(item.previewImage || '').trim();
        body.innerHTML = (img ? `<img class="inbox-drawer-preview-img" src="${view.escape(img)}" alt="" loading="lazy">` : '')
            + (item.previewDesc ? `<p class="inbox-drawer-desc">${view.escape(item.previewDesc)}</p>` : '');
        body.querySelector('.inbox-drawer-preview-img')?.addEventListener('error', (e) => e.currentTarget.remove(), { once: true });
    }

    _fillNote(body, item) {
        const view = this.view;
        body.innerHTML = item.note
            ? `<p class="inbox-drawer-note">${view.escape(item.note)}</p>`
            : `<p class="inbox-drawer-empty">${view.escape(this.t('inboxDrawerNoNote', 'No note yet.'))}</p>`;
    }

    /** The tags (a click filters, as it did on the row) and the engine's offers. */
    _fillTags(body, item) {
        const view = this.view;
        body.innerHTML = `${view.renderItemTags(item)}<span class="tag-suggest-chips" data-inbox-suggest></span>`;
        body.querySelectorAll('[data-inbox-tag]').forEach((chip) => {
            chip.addEventListener('click', () => view.filterByTag(chip.getAttribute('data-inbox-tag')));
        });
        view.fillSuggestChips(body, item);
        const actions = document.createElement('div');
        actions.className = 'inbox-drawer-section-actions';
        this._button(actions, 'tags', this.t('inboxTagsAction', 'Tags'), () => void view.editTags(item));
        body.appendChild(actions);
    }

    _fillDetails(body, item) {
        const view = this.view;
        const row = (label, value, attr = '') => (value
            ? `<div class="inbox-drawer-field"><span class="inbox-drawer-field-label">${view.escape(label)}</span><span${attr}>${view.escape(value)}</span></div>`
            : '');
        // Paste is how most links arrive, so it goes unsaid.
        const source = String(item.source || '').trim();
        body.innerHTML = [
            row(this.t('inboxDrawerSource', 'Source'), source && source !== 'paste' ? source : '', ' data-inbox-source'),
            row(this.t('inboxDrawerAdded', 'Added'), view.formatAddedDate(item.addedAt)),
            row(this.t('inboxDrawerRead', 'Read'), item.readAt ? view.formatAddedDate(item.readAt) : ''),
            row(this.t('inboxDrawerSleeping', 'Sleeping until'), view.isSnoozed(item) ? view.formatSnoozeWake(item.snoozedUntil) : ''),
        ].join('');
    }
}

window.InboxDrawer = InboxDrawer;
