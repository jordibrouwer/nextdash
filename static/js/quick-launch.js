/**
 * Quick launch: one panel in the middle of the screen with the bookmarks you
 * put there, the ones you pinned and the ones you open most.
 *
 * Three things open it and all of them do the same: the corner element, Shift+Q,
 * and a mouse drawn in circles. The panel is a modal (AppModal), so it takes the
 * material of the active theme, traps focus, closes on Esc and follows the
 * animation switches like every other overlay. It unfolds from the corner
 * element when that is on screen (ModalOrigin).
 *
 * What it holds is quick-launch-core.js. Putting a bookmark in, or taking one
 * out, works three ways: the + in the panel (a picker), Shift+Q with a bookmark
 * under the cursor, and the bookmark's context menu. Where it works: the
 * dashboard view, on a computer. The corner element only shows at 992 px and
 * wider with a real mouse (quick-launch.css); the key and the gesture are left
 * to the keyboard and the mouse that have them.
 */
(function (global) {
    'use strict';

    const MODAL_CLASS = 'quick-launch-modal';
    const PICK_LIMIT = 40;
    const dash = () => global.dashboardInstance;
    const settings = () => dash()?.settings || {};
    const label = (key, vars, fallback) => {
        const d = dash();
        return d?.formatDashboardLabel ? d.formatDashboardLabel(key, vars || {}, fallback) : fallback;
    };
    const esc = (value) => (dash()?.escapeHtml ? dash().escapeHtml(String(value)) : String(value)
        .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
    const urlOf = (bookmark) => String(bookmark?.url || '').trim();
    const listOf = (key) => (Array.isArray(settings()[key]) ? settings()[key].slice() : []);

    let shown = [];
    let picking = false;
    let recognizer = null;
    let cooldownUntil = 0;
    let ring = null;
    let closeTimer = null;
    let watching = false;

    function core() { return global.QuickLaunchCore; }

    /** The page on screen first, then every other page, as the Recent sheet reads them. */
    function pool() {
        const d = dash();
        const current = Array.isArray(d?.bookmarks) ? d.bookmarks : [];
        const currentId = Number(d?.currentPageId);
        const others = (Array.isArray(d?.allBookmarks) ? d.allBookmarks : [])
            .filter((bookmark) => Number(bookmark?.pageId ?? bookmark?.pageID) !== currentId);
        return current.concat(others);
    }

    /** The most the panel holds. The ones put in by hand come first; the rest fill what is left. */
    function count() {
        return 12;
    }

    /**
     * The addresses put in by hand that still belong to a bookmark: a deleted or edited one is dead weight.
     *
     * Only once every page is loaded: before that, one added from another page looks
     * deleted, and the next add would save the list without it.
     */
    function liveAdded() {
        const d = dash();
        if (!d?._unsortedLoaded) return listOf('quickLaunchAdded');
        const unsorted = Array.isArray(d.unsortedBookmarks) ? d.unsortedBookmarks : [];
        const urls = new Set(pool().concat(unsorted).map(urlOf));
        return listOf('quickLaunchAdded').filter((url) => urls.has(url));
    }

    function list() {
        const s = settings();
        return core().buildList(pool(), {
            source: s.quickLaunchSource,
            count: count(),
            hidden: s.quickLaunchHidden,
            added: s.quickLaunchAdded,
        });
    }

    function isOpen() {
        const overlay = document.getElementById('app-modal');
        return Boolean(overlay && overlay.classList.contains('show') && overlay.querySelector('.modal.' + MODAL_CLASS));
    }

    /** Whether something else owns the screen: another panel, the search, a field. */
    function busy() {
        const d = dash();
        if (!d || !d.isBookmarksView?.()) return true;
        if (isOpen()) return false;
        if (d.isModalOpen?.()) return true;
        if (d.searchComponent?.isActive?.()) return true;
        if (document.body.classList.contains('bookmark-inline-edit-active')) return true;
        if (global.DashboardTagCloud?.modalOpen) return true;
        return false;
    }

    function typing(target) {
        const tag = (target?.tagName || '').toLowerCase();
        return tag === 'input' || tag === 'textarea' || tag === 'select' || Boolean(target?.isContentEditable);
    }

    function iconNode(bookmark) {
        const slot = document.createElement('span');
        slot.className = 'quick-launch-icon';
        const raw = String(bookmark.icon || '').trim();
        const letter = () => {
            const el = document.createElement('span');
            el.className = 'quick-launch-icon-letter';
            el.setAttribute('aria-hidden', 'true');
            el.textContent = (String(bookmark.name || '').trim()[0] || '?').toUpperCase();
            return el;
        };
        if (raw) {
            const img = document.createElement('img');
            img.alt = '';
            img.loading = 'lazy';
            img.decoding = 'async';
            img.draggable = false;
            img.src = /^(https?:|data:|\/)/i.test(raw) ? raw : '/data/icons/' + encodeURIComponent(raw);
            img.addEventListener('error', () => { img.remove(); slot.appendChild(letter()); });
            slot.appendChild(img);
        } else {
            const el = letter();
            slot.appendChild(el);
            // No icon of its own: the app's set icon where the sets know the address.
            if (bookmark.url && global.IconSetAuto && bookmark.iconMode !== 'letter') {
                el.setAttribute('data-icon-auto-url', bookmark.url);
                global.IconSetAuto.queue(el);
            }
        }
        return slot;
    }

    function tileHtml(entry, index) {
        const d = dash();
        const bookmark = entry.bookmark;
        const href = d.safeBookmarkOpenHref ? d.safeBookmarkOpenHref(bookmark.url) : bookmark.url;
        const name = bookmark.name || d.bookmarkFallbackName?.() || bookmark.url;
        const newTab = global.opensInNewTab?.(settings());
        const opensNote = entry.group === 'top' && Number(bookmark.openCount) > 0
            ? `<span class="quick-launch-opens">${esc(bookmark.openCount)}×</span>` : '';
        const added = entry.group === 'added';
        const removeText = added
            ? label('quickLaunchRemove', { name }, 'Remove {name} from Quick launch')
            : label('quickLaunchHide', { name }, 'Hide {name} from Quick launch');
        return `<div class="quick-launch-cell" data-index="${index}">
            <a class="quick-launch-tile" href="${esc(href || '#')}" data-index="${index}"${newTab ? ' target="_blank" rel="noopener noreferrer"' : ''}>
                <span class="quick-launch-key" aria-hidden="true">${index < 9 ? index + 1 : ''}</span>
                <span class="quick-launch-icon-slot"></span>
                <span class="quick-launch-name">${esc(name)}</span>
                ${opensNote}
            </a>
            <button type="button" class="quick-launch-remove" data-index="${index}" aria-label="${esc(removeText)}" title="${esc(added
                ? label('quickLaunchRemoveTitle', {}, 'Remove from Quick launch')
                : label('quickLaunchHideTitle', {}, 'Hide from Quick launch'))}">×</button>
        </div>`;
    }

    /** Tiles per row: four, two in a narrow window. The width of a tile does not change with the row. */
    function perRow() {
        return global.matchMedia?.('(max-width: 560px)').matches ? 2 : 4;
    }

    /**
     * How many cells go in each row: as few rows as the per-row maximum allows, then
     * as even as possible, the longer rows first (5 is 3+2, 7 is 4+3, 9 is 3+3+3).
     */
    function balancedRows(cells, max) {
        if (cells <= 0) return [];
        const rows = Math.ceil(cells / max);
        const base = Math.floor(cells / rows);
        const extra = cells % rows;
        return Array.from({ length: rows }, (_, i) => base + (i < extra ? 1 : 0));
    }

    function addTileHtml() {
        return `<div class="quick-launch-cell quick-launch-cell--add">
            <button type="button" class="quick-launch-tile quick-launch-tile--add" aria-label="${esc(label('quickLaunchAddTitle', {}, 'Add a bookmark'))}" title="${esc(label('quickLaunchAddTitle', {}, 'Add a bookmark'))}">
                <span class="quick-launch-add-plus" aria-hidden="true">+</span>
                <span class="quick-launch-name">${esc(label('quickLaunchAddShort', {}, 'Add'))}</span>
            </button>
        </div>`;
    }

    function gridHtml() {
        shown = list();
        const hidden = listOf('quickLaunchHidden').length;
        const groups = [
            ['added', label('quickLaunchAdded', {}, 'Yours')],
            ['pinned', label('quickLaunchPinned', {}, 'Pinned')],
            ['top', label('quickLaunchMostOpened', {}, 'Most opened')],
        ];
        let html = '';
        // A plus tile closes the last group while there is room: it is the way in, so the
        // footer needs no second button for it.
        const plusTile = shown.length > 0 && shown.length < count();
        const lastGroup = groups.map(([group]) => group).filter((group) => shown.some((entry) => entry.group === group)).pop();
        const max = perRow();
        groups.forEach(([group, title]) => {
            const entries = shown.map((entry, index) => ({ entry, index })).filter((x) => x.entry.group === group);
            if (!entries.length) return;
            const cells = entries.map((x) => tileHtml(x.entry, x.index));
            if (plusTile && group === lastGroup) cells.push(addTileHtml());
            let at = 0;
            const rows = balancedRows(cells.length, max).map((n) => {
                const row = cells.slice(at, at + n).join('');
                at += n;
                return `<div class="quick-launch-row">${row}</div>`;
            }).join('');
            html += `<section class="quick-launch-group" data-group="${group}">
                <h3 class="quick-launch-group-title">${esc(title)}</h3>
                <div class="quick-launch-grid">${rows}</div>
            </section>`;
        });
        if (!shown.length) {
            html += `<p class="quick-launch-empty">${esc(label('quickLaunchEmpty', {},
                'Nothing here yet. Add a bookmark with +, pin one with Shift+P, or open a few: the ones you open most appear here.'))}</p>`;
        }
        const full = liveAdded().length >= count();
        html += `<div class="quick-launch-foot">
            ${plusTile ? '' : `<button type="button" class="quick-launch-add"${full ? ' disabled' : ''} title="${esc(full
                ? label('quickLaunchFull', { n: count() }, 'Quick launch holds {n} bookmarks. Remove one, or raise the number in Config.')
                : label('quickLaunchAddTitle', {}, 'Add a bookmark'))}">
                <span aria-hidden="true">+</span> ${esc(label('quickLaunchAddLabel', {}, 'Add a bookmark'))}
            </button>`}
            <span class="quick-launch-foot-keys">${esc(label('quickLaunchFootKeys', { max: Math.min(9, Math.max(1, shown.length)) }, '1–{max} opens · Esc closes'))}</span>
            ${hidden ? `<button type="button" class="quick-launch-unhide" title="${esc(label('quickLaunchRestoreTitle', { n: hidden }, 'Put back the {n} bookmark(s) you took out of the automatic part of Quick launch. They are not deleted.'))}">${esc(label('quickLaunchRestoreHidden', { n: hidden }, 'Restore hidden ({n})'))}</button>` : ''}
        </div>`;
        return html;
    }

    function contentEl() {
        const panel = document.querySelector('.modal.' + MODAL_CLASS);
        return document.getElementById('modal-text') || panel?.querySelector('.modal-body') || null;
    }

    function fill() {
        const content = contentEl();
        if (!content) return;
        picking = false;
        content.innerHTML = gridHtml();
        content.querySelectorAll('.quick-launch-tile').forEach((tile) => {
            const entry = shown[Number(tile.dataset.index)];
            if (!entry) return;
            tile.querySelector('.quick-launch-icon-slot')?.replaceWith(iconNode(entry.bookmark));
            tile.addEventListener('click', () => opened(entry.bookmark));
        });
        content.querySelectorAll('.quick-launch-remove').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const entry = shown[Number(button.dataset.index)];
                if (!entry) return;
                if (entry.group === 'added') removeAdded(entry.bookmark);
                else hide(entry.bookmark);
                fill();
                focusFirst();
            });
        });
        content.querySelector('.quick-launch-add')?.addEventListener('click', () => fillPicker());
        content.querySelector('.quick-launch-tile--add')?.addEventListener('click', () => fillPicker());
        content.querySelector('.quick-launch-unhide')?.addEventListener('click', () => {
            unhideAll();
            fill();
        });
        content.setAttribute('aria-busy', 'false');
    }

    /** The picker: every bookmark that is not on the panel yet, found by name or address. */
    function fillPicker(query) {
        const content = contentEl();
        if (!content) return;
        picking = true;
        const addedNow = new Set(listOf('quickLaunchAdded'));
        const q = String(query || '').trim().toLowerCase();
        const seen = new Set();
        const matches = [];
        pool().forEach((bookmark) => {
            const url = urlOf(bookmark);
            if (!/^https?:/i.test(url) || seen.has(url) || addedNow.has(url)) return;
            seen.add(url);
            const name = String(bookmark.name || '');
            if (q && !name.toLowerCase().includes(q) && !url.toLowerCase().includes(q)) return;
            matches.push(bookmark);
        });
        const shownHere = matches.slice(0, PICK_LIMIT);
        content.innerHTML = `<div class="quick-launch-picker">
            <div class="quick-launch-picker-bar">
                <button type="button" class="quick-launch-back" aria-label="${esc(label('quickLaunchBack', {}, 'Back to Quick launch'))}">‹</button>
                <input type="search" class="quick-launch-search" autocomplete="off" spellcheck="false"
                    placeholder="${esc(label('quickLaunchSearchPlaceholder', {}, 'Find a bookmark'))}"
                    aria-label="${esc(label('quickLaunchSearchPlaceholder', {}, 'Find a bookmark'))}" value="${esc(query || '')}">
            </div>
            <ul class="quick-launch-results" role="listbox">
                ${shownHere.map((bookmark, i) => `<li><button type="button" class="quick-launch-result" data-i="${i}" role="option">
                    <span class="quick-launch-result-icon"></span>
                    <span class="quick-launch-result-name">${esc(bookmark.name || urlOf(bookmark))}</span>
                    <span class="quick-launch-result-url">${esc(urlOf(bookmark).replace(/^https?:\/\//i, '').replace(/\/$/, ''))}</span>
                </button></li>`).join('')}
            </ul>
            ${shownHere.length === 0 ? `<p class="quick-launch-empty">${esc(label('quickLaunchNoResults', {}, 'No bookmark found.'))}</p>` : ''}
            ${matches.length > PICK_LIMIT ? `<p class="quick-launch-more">${esc(label('quickLaunchMoreResults', { n: matches.length - PICK_LIMIT }, 'Type to narrow down: {n} more'))}</p>` : ''}
        </div>`;
        content.querySelectorAll('.quick-launch-result').forEach((button) => {
            const bookmark = shownHere[Number(button.dataset.i)];
            button.querySelector('.quick-launch-result-icon')?.replaceWith(iconNode(bookmark));
            button.addEventListener('click', () => {
                addBookmark(bookmark);
                fill();
                focusFirst();
            });
        });
        content.querySelector('.quick-launch-back')?.addEventListener('click', () => { fill(); focusFirst(); });
        const input = content.querySelector('.quick-launch-search');
        // Redrawn per keystroke, field and all: mid-composition that throws away what an
        // input method (pinyin, kana) is still putting together, so wait for it to finish.
        input?.addEventListener('compositionend', () => input.dispatchEvent(new Event('input')));
        input?.addEventListener('input', (event) => {
            if (event.isComposing) return;
            const caret = input.selectionStart;
            fillPicker(input.value);
            const again = contentEl()?.querySelector('.quick-launch-search');
            again?.focus();
            try { again?.setSelectionRange(caret, caret); } catch (error) { /* a search field may not allow it */ }
        });
        input?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                const first = contentEl()?.querySelector('.quick-launch-result');
                if (first) { event.preventDefault(); first.click(); }
            } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                contentEl()?.querySelector('.quick-launch-result')?.focus();
            }
        });
        content.querySelector('.quick-launch-results')?.addEventListener('keydown', (event) => {
            const results = Array.from(content.querySelectorAll('.quick-launch-result'));
            const at = results.indexOf(document.activeElement);
            if (event.key === 'ArrowDown') { event.preventDefault(); results[Math.min(results.length - 1, at + 1)]?.focus(); }
            if (event.key === 'ArrowUp') {
                event.preventDefault();
                if (at <= 0) input?.focus(); else results[at - 1].focus();
            }
        });
        input?.focus({ preventScroll: true });
    }

    function opened(bookmark) {
        const d = dash();
        try {
            d.recent?.recordBookmarkOpened?.(bookmark, d.resolveBookmarkIndex?.(bookmark), 'quick-launch');
        } catch (error) { /* an open that cannot be counted is still an open */ }
        global.AppModal?.hide?.();
    }

    /** Both lists are settings, saved the way every other setting is. */
    function save(patch) {
        const d = dash();
        Object.assign(d.settings, patch);
        refreshCorner();
        return Promise.resolve(d.saveSettings?.()).catch(() => {});
    }

    function addBookmark(bookmark) {
        const url = urlOf(bookmark);
        if (!url) return false;
        const added = liveAdded();
        if (added.includes(url)) return true;
        if (added.length >= count()) return false;
        added.push(url);
        // Put in by hand beats left out by hand.
        void save({ quickLaunchAdded: added, quickLaunchHidden: listOf('quickLaunchHidden').filter((u) => u !== url) });
        return true;
    }

    function removeAdded(bookmark) {
        const url = urlOf(bookmark);
        void save({ quickLaunchAdded: listOf('quickLaunchAdded').filter((u) => u !== url) });
    }

    function hide(bookmark) {
        const url = urlOf(bookmark);
        const current = listOf('quickLaunchHidden');
        if (!current.includes(url)) current.push(url);
        void save({ quickLaunchHidden: current });
    }

    function unhideAll() {
        void save({ quickLaunchHidden: [] });
    }

    /** Whether the panel holds this bookmark right now, by hand or by itself. */
    function holds(bookmark) {
        const url = urlOf(bookmark);
        if (!url) return false;
        // One put in by hand counts even when the count has since been lowered below it.
        return listOf('quickLaunchAdded').includes(url) || list().some((entry) => urlOf(entry.bookmark) === url);
    }

    /**
     * The key and the context menu: take the bookmark out if the panel holds it,
     * put it in if not. Answers what happened, so the caller can say it.
     */
    function toggleBookmark(bookmark) {
        const url = urlOf(bookmark);
        if (!url) return null;
        const d = dash();
        const name = bookmark.name || url;
        const wasAdded = listOf('quickLaunchAdded').includes(url);
        const wasHidden = listOf('quickLaunchHidden').includes(url);
        const before = list().map((entry) => entry.bookmark);
        let result;
        if (wasAdded) {
            removeAdded(bookmark);
            result = 'removed';
        } else if (wasHidden) {
            // Taken out by hand before: the same key puts it back.
            void save({ quickLaunchHidden: listOf('quickLaunchHidden').filter((u) => u !== url) });
            result = 'added';
        } else if (holds(bookmark)) {
            hide(bookmark);
            result = 'removed';
        } else if (addBookmark(bookmark)) {
            result = 'added';
        } else {
            result = 'full';
        }
        // A full panel makes room by dropping its last automatic tile; say which.
        let pushed = '';
        if (result === 'added') {
            const kept = new Set(list().map((entry) => urlOf(entry.bookmark)));
            pushed = before.filter((bookmark) => !kept.has(urlOf(bookmark)))
                .map((bookmark) => bookmark.name || urlOf(bookmark)).join(', ');
        }
        const text = {
            added: pushed
                ? label('quickLaunchToastAddedPushed', { name, pushed }, 'Added \u201C{name}\u201D to Quick launch (pushed out: {pushed})')
                : label('quickLaunchToastAdded', { name }, 'Added \u201C{name}\u201D to Quick launch'),
            removed: label('quickLaunchToastRemoved', { name }, 'Removed \u201C{name}\u201D from Quick launch'),
            full: label('quickLaunchFull', { n: count() }, 'Quick launch holds {n} bookmarks. Remove one, or raise the number in Config.'),
        }[result];
        // A stray key is easy to take back: a notice with Undo, as for pin.
        const undo = result === 'full' ? undefined : () => {
            const back = { quickLaunchAdded: listOf('quickLaunchAdded').filter((u) => u !== url), quickLaunchHidden: listOf('quickLaunchHidden').filter((u) => u !== url) };
            if (wasAdded) back.quickLaunchAdded.push(url);
            if (wasHidden) back.quickLaunchHidden.push(url);
            void save(back);
        };
        try {
            d?.showNotification?.(text, result === 'full' ? 'warning' : 'success', { duration: 6000, undoCallback: undo });
        } catch (error) { /* a notice is a courtesy */ }
        return result;
    }

    function focusFirst() {
        const panel = document.querySelector('.modal.' + MODAL_CLASS);
        const first = panel?.querySelector('.quick-launch-tile')
            || panel?.querySelector('.quick-launch-add:not([disabled])')
            || panel?.querySelector('.quick-launch-unhide');
        first?.focus?.({ preventScroll: true });
    }

    function open() {
        const d = dash();
        if (!global.AppModal || !d || busy()) return false;
        if (isOpen()) return true;
        d.keyboardNavigation?.clearSelection?.({ restoreFocus: false });
        global.ModalOrigin?.remember?.(document.getElementById('quick-launch-button'));
        picking = false;
        global.AppModal.show({
            title: label('quickLaunchTitle', {}, 'Quick launch'),
            htmlMessage: '<div class="quick-launch-loading" aria-hidden="true"></div>',
            confirmText: label('close', {}, 'Close'),
            showCancel: false,
            modalClass: MODAL_CLASS,
            modalMaxWidth: '34rem',
            onHide: () => {
                picking = false;
                stopWatching();
                document.getElementById('quick-launch-button')?.setAttribute('aria-expanded', 'false');
            },
        });
        document.getElementById('quick-launch-button')?.setAttribute('aria-expanded', 'true');
        startWatching();
        const header = document.querySelector('.modal.' + MODAL_CLASS + ' .modal-header');
        if (header && !header.querySelector('.quick-launch-modal-key')) {
            const chip = document.createElement('span');
            chip.className = 'quick-launch-modal-key';
            chip.dataset.modalHeaderExtra = 'true';
            chip.setAttribute('aria-hidden', 'true');
            chip.textContent = '⇧Q';
            document.getElementById('modal-title')?.after(chip);
            const close = document.createElement('button');
            close.type = 'button';
            close.className = 'quick-launch-modal-close';
            close.dataset.modalHeaderExtra = 'true';
            close.setAttribute('aria-label', label('close', {}, 'Close'));
            close.innerHTML = '<span aria-hidden="true">Esc</span> ×';
            close.addEventListener('click', () => global.AppModal.hide());
            header.appendChild(close);
        }
        const render = () => { if (isOpen()) { fill(); focusFirst(); refreshCorner(); } };
        if (d._bookmarksReady) requestAnimationFrame(render);
        else {
            const wait = setInterval(() => {
                if (!isOpen()) { clearInterval(wait); return; }
                if (dash()?._bookmarksReady) { clearInterval(wait); render(); }
            }, 100);
        }
        // Every page's bookmarks, not only this one's, as the Recent sheet does.
        if (!d._unsortedLoaded && typeof d.loadAllBookmarks === 'function') {
            void Promise.resolve(d.loadAllBookmarks())
                .then(() => {
                    if (!isOpen() || picking) return;
                    const hadFocus = Boolean(document.querySelector('.modal.' + MODAL_CLASS)?.contains(document.activeElement));
                    fill();
                    if (hadFocus) focusFirst();
                    refreshCorner();
                })
                .catch(() => {});
        }
        return true;
    }

    function close() {
        if (isOpen()) global.AppModal.hide();
    }

    /*
     * A panel the pointer has left closes itself: the reader is looking at the page
     * again. The clock starts when the mouse moves outside the panel and stops when
     * it comes back or a key is pressed; a mouse that rests where it was when the
     * panel opened (opened by the key) never starts it, and neither does the picker.
     */
    function watchPointer(event) {
        if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
        clearTimeout(closeTimer);
        closeTimer = null;
        const seconds = Number(settings().quickLaunchAutoClose);
        if (!(seconds > 0) || picking || !isOpen()) return;
        if (event.target?.closest?.('.modal.' + MODAL_CLASS)) return;
        closeTimer = setTimeout(() => { if (isOpen() && !picking) close(); }, seconds * 1000);
    }

    function watchKey() {
        clearTimeout(closeTimer);
        closeTimer = null;
    }

    function startWatching() {
        if (watching) return;
        watching = true;
        document.addEventListener('pointermove', watchPointer, true);
        document.addEventListener('keydown', watchKey, true);
    }

    function stopWatching() {
        clearTimeout(closeTimer);
        closeTimer = null;
        watching = false;
        document.removeEventListener('pointermove', watchPointer, true);
        document.removeEventListener('keydown', watchKey, true);
    }

    function toggle() {
        if (isOpen()) { close(); return true; }
        return open();
    }

    /** The four tiles of the corner element: the first of what the panel would show. */
    function refreshCorner() {
        const holder = document.getElementById('quick-launch-minis');
        if (!holder || !core()) return;
        const first = list().slice(0, 4);
        holder.textContent = '';
        for (let i = 0; i < 4; i += 1) {
            const cell = document.createElement('span');
            cell.className = 'quick-launch-mini';
            const entry = first[i];
            if (entry) cell.appendChild(iconNode(entry.bookmark));
            else cell.classList.add('is-empty');
            holder.appendChild(cell);
        }
    }

    function sync() {
        const s = settings();
        document.body.setAttribute('data-quick-launch-button', s.quickLaunchButton !== false);
        document.body.setAttribute('data-quick-launch-gesture', s.quickLaunchGesture !== false);
        recognizer?.setTurns(s.quickLaunchTurns);
        refreshCorner();
    }

    /* The gesture. */
    function ringNode() {
        if (ring) return ring;
        ring = document.createElement('div');
        ring.className = 'quick-launch-ring';
        ring.setAttribute('aria-hidden', 'true');
        document.body.appendChild(ring);
        return ring;
    }

    function setRing(progress, event) {
        const el = ringNode();
        el.style.setProperty('--p', String(Math.round(progress * 100)));
        el.style.left = event.clientX + 'px';
        el.style.top = event.clientY + 'px';
        el.classList.toggle('on', progress > 0.15);
    }

    let wideQuery = null;
    function wideScreen() {
        if (!wideQuery) wideQuery = global.matchMedia('(min-width: 992px)');
        return wideQuery;
    }

    function onPointerMove(event) {
        if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
        const s = settings();
        const idle = () => { recognizer?.reset(); if (ring) setRing(0, event); };
        if (s.quickLaunchGesture === false || event.buttons) { idle(); return; }
        if (!wideScreen().matches) return;
        const now = performance.now();
        if (now < cooldownUntil || document.body.getAttribute('data-edit-mode') === 'on'
            || typing(event.target) || busy()
            || (global.getSelection && String(global.getSelection()).length > 0)) { idle(); return; }
        if (!recognizer) recognizer = core().createRecognizer({ turns: s.quickLaunchTurns });
        else recognizer.setTurns(s.quickLaunchTurns);
        const progress = recognizer.feed(event.clientX, event.clientY, now);
        setRing(progress, event);
        if (progress >= 1) {
            recognizer.reset();
            setRing(0, event);
            cooldownUntil = now + 1000;
            open();
        }
    }

    function onKeyDown(event) {
        if (event.ctrlKey || event.altKey || event.metaKey) return;
        const d = dash();
        if (!d) return;
        // The picker keeps Esc for itself: one press goes back to the panel.
        if (event.key === 'Escape' && isOpen() && picking) {
            event.preventDefault();
            event.stopPropagation();
            fill();
            focusFirst();
            return;
        }
        // Shift+Q opens or closes the panel. With a bookmark under the cursor it is
        // that bookmark's key instead (keyboard-navigation.js), as Shift+P is for pin.
        if (event.shiftKey && event.code === 'KeyQ') {
            if (typing(event.target)) return;
            if (!isOpen() && (busy() || d.keyboardNavigation?._cursorOnBookmarkRow?.())) return;
            event.preventDefault();
            event.stopPropagation();
            // A held key must not open and close it in a burst.
            if (event.repeat) return;
            global.nextdashRecordKey?.('Shift + Q');
            toggle();
            return;
        }
        if (!isOpen() || picking || typing(event.target)) return;
        if (!event.shiftKey && /^[1-9]$/.test(event.key)) {
            const tile = document.querySelector('.modal.' + MODAL_CLASS + ' .quick-launch-tile[data-index="' + (Number(event.key) - 1) + '"]');
            if (!tile) return;
            event.preventDefault();
            event.stopPropagation();
            // A click on the link follows it and counts the open; nothing else to do.
            tile.click();
            return;
        }
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft' || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            const tiles = Array.from(document.querySelectorAll('.modal.' + MODAL_CLASS + ' .quick-launch-tile'));
            if (!tiles.length) return;
            const at = tiles.indexOf(document.activeElement);
            const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
            event.preventDefault();
            tiles[(at + step + tiles.length) % tiles.length].focus();
        }
    }

    function init() {
        if (!core()) return;
        document.addEventListener('keydown', onKeyDown, true);
        document.addEventListener('pointermove', onPointerMove, { passive: true });
        document.getElementById('quick-launch-button')?.addEventListener('click', (event) => {
            event.preventDefault();
            toggle();
        });
        sync();
    }

    global.QuickLaunch = {
        open, close, toggle, isOpen, sync, refreshCorner, list, holds, toggleBookmark,
        addBookmark, removeAdded, hide, unhideAll,
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
}(window));
