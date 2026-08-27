/**
 * Lazy loaders for bookmark row interactions: inline edit (long-press / keyboard)
 * and the right-click context menu. Both modules are fetched together on first
 * use so a right-click → Edit does not pay for a second load.
 */
(function () {
    'use strict';

    const INLINE_EDIT = 'js/dashboard/dashboard-inline-edit.js';
    const CONTEXT_MENU = 'js/dashboard/dashboard-context-menu.js';

    let sharedLoadPromise = null;
    /** Mirrors DashboardContextMenu._shareRefused before that class is fetched. */
    let shareRefused = false;

    function markShareRefused() {
        shareRefused = true;
        if (typeof window.DashboardContextMenu !== 'undefined') {
            window.DashboardContextMenu.markShareRefused();
        }
    }

    function isShareRefused() {
        return shareRefused || window.DashboardContextMenu?._shareRefused === true;
    }

    function assetURL(rel) {
        return (window.NEXTDASH_ASSETS && window.NEXTDASH_ASSETS[rel]) || `/static/${rel}`;
    }

    function scriptReady(rel) {
        if (rel === INLINE_EDIT) return typeof window.DashboardInlineEdit === 'function';
        if (rel === CONTEXT_MENU) return typeof window.DashboardContextMenu === 'function';
        return false;
    }

    function loadScript(rel, datasetKey) {
        const src = assetURL(rel);
        return new Promise((resolve, reject) => {
            if (scriptReady(rel)) {
                resolve();
                return;
            }
            const existing = document.querySelector(`script[data-${datasetKey}]`);
            if (existing) {
                if (scriptReady(rel)) {
                    resolve();
                    return;
                }
                existing.addEventListener('load', () => resolve(), { once: true });
                existing.addEventListener('error', () => reject(new Error(`${rel} failed to load`)), { once: true });
                return;
            }
            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.dataset[datasetKey] = 'true';
            script.onload = () => resolve();
            script.onerror = () => reject(new Error(`${rel} failed to load`));
            document.head.appendChild(script);
        });
    }

    function loadInteractionModules() {
        if (typeof window.DashboardInlineEdit === 'function'
            && typeof window.DashboardContextMenu === 'function') {
            return Promise.resolve();
        }
        if (sharedLoadPromise) return sharedLoadPromise;

        sharedLoadPromise = loadScript(INLINE_EDIT, 'dashboardInlineEditModule')
            .then(() => loadScript(CONTEXT_MENU, 'dashboardContextMenuModule'))
            .then(() => {
                if (typeof window.DashboardInlineEdit !== 'function') {
                    throw new Error('inline edit module loaded without defining DashboardInlineEdit');
                }
                if (typeof window.DashboardContextMenu !== 'function') {
                    throw new Error('context menu module loaded without defining DashboardContextMenu');
                }
            })
            .catch((err) => {
                sharedLoadPromise = null;
                throw err;
            });

        return sharedLoadPromise;
    }

    class DashboardInlineEditLoader {
        static ROW_LONG_PRESS_MS = 500;

        constructor(dashboard) {
            this.dash = dashboard;
            this._module = null;
            this._modulePromise = null;
        }

        get instance() {
            return this._module;
        }

        /**
         * Cheap guard used all over the shell — must not pull in the module.
         * Mirrors DashboardInlineEdit.isInlineEditActive.
         */
        isInlineEditActive() {
            if (document.getElementById('bookmark-form-modal')?.classList.contains('show')) {
                return true;
            }
            const d = this.dash;
            return d.inlineEditingBookmarkIndex !== null
                || Boolean(document.querySelector('.bookmark-inline-editing'));
        }

        hasInlineEditUnsavedChanges() {
            if (!this.isInlineEditActive()) {
                return false;
            }
            return this._module?.hasInlineEditUnsavedChanges?.() ?? false;
        }

        /** Called on every dashboard render — must not fetch the module. */
        _abortInlineEditForRender() {
            const d = this.dash;
            if (d.inlineEditingBookmarkIndex !== null) {
                if (this.hasInlineEditUnsavedChanges()) {
                    return;
                }
                d._inlineEditGlobalCleanup?.();
                d.inlineEditingBookmarkIndex = null;
            }
            d._inlineEditAutoFetchClear?.();
            d._inlineEditAutoFetchClear = null;
            d._inlineEditContext = null;
            document.body.classList.remove('bookmark-inline-edit-active');
        }

        ensureBookmarkMutationSnapshot() {
            const d = this.dash;
            if (!d.pendingReorderSnapshot) {
                d.pendingReorderSnapshot = d.bookmarks.map((bm) => ({ ...bm }));
            }
        }

        syncInlineEditCategoryAfterMove(categoryId, affectedRefs = []) {
            const d = this.dash;
            const ctx = d._inlineEditContext;
            if (!ctx?.fields?.catSelect || !ctx.bookmarkRef?.bookmark) {
                return;
            }
            const editingRef = ctx.bookmarkRef;
            const isAffected = (affectedRefs || []).some((ref) => (
                ref === editingRef
                || ref?.bookmark === editingRef.bookmark
                || d.isSameBookmarkReference?.(editingRef, ref?.bookmark)
            ));
            if (!isAffected) {
                return;
            }
            ctx.fields.catSelect.value = String(categoryId ?? '');
            editingRef.bookmark.category = categoryId;
            if (editingRef.original) {
                editingRef.original.category = categoryId;
            }
        }

        dismissInlineEditForNavigation() {
            if (!this.isInlineEditActive()) {
                this._abortInlineEditForRender();
                return;
            }
            void this.load().then((mod) => mod.dismissInlineEditForNavigation()).catch(() => {});
        }

        confirmInlineEditBeforeNavigation() {
            if (!this.isInlineEditActive()) {
                return Promise.resolve(true);
            }
            return this.load().then((mod) => mod.confirmInlineEditBeforeNavigation());
        }

        confirmDiscardInlineEdit() {
            // hasInlineEdit..., not isInlineEdit...: the stub defines the
            // former a dozen lines up and nothing anywhere defines the latter,
            // so this threw a TypeError instead of returning a promise, and
            // every caller was awaiting it.
            if (!this.hasInlineEditUnsavedChanges()) {
                return Promise.resolve(true);
            }
            return this.load().then((mod) => mod.confirmDiscardInlineEdit());
        }

        /**
         * Keyboard `;` expects a synchronous boolean. Row resolution stays on the
         * stub; opening the editor loads the module on demand.
         */
        tryOpenInlineBookmarkEdit() {
            const d = this.dash;
            const kn = d.keyboardNavigation;
            const layout = document.getElementById('dashboard-layout');
            let el = null;
            if (layout && document.activeElement && document.activeElement.closest) {
                const hit = document.activeElement.closest('.bookmark-link');
                if (hit && layout.contains(hit) && !hit.classList.contains('recent-bookmark-link')) {
                    el = hit;
                }
            }
            if (!el && kn && kn.currentIndex >= 0 && Array.isArray(kn.navigableElements)) {
                el = kn.navigableElements[kn.currentIndex];
            }
            if (!el || !el.classList.contains('bookmark-link') || el.classList.contains('bookmark-inline-editing')) {
                return false;
            }

            let bookmark = null;
            if (el.hasAttribute('data-bookmark-index')) {
                const idx = parseInt(el.getAttribute('data-bookmark-index'), 10);
                if (Number.isFinite(idx) && idx >= 0 && d.bookmarks[idx]) {
                    bookmark = d.bookmarks[idx];
                }
            }
            if (!bookmark) {
                const url = String(el.getAttribute('data-bookmark-url') || '').trim();
                const cat = String(el.getAttribute('data-category-id') || '').trim();
                if (url) {
                    bookmark = d.bookmarks.find(
                        (b) => String((b.url || '').trim()) === url && String(b.category || '') === cat
                    ) || d.bookmarks.find((b) => String((b.url || '').trim()) === url);
                }
            }
            if (!bookmark && Array.isArray(d.allBookmarks)) {
                const url = String(el.getAttribute('data-bookmark-url') || '').trim();
                const cat = String(el.getAttribute('data-category-id') || '').trim();
                if (url) {
                    bookmark = d.allBookmarks.find(
                        (b) => String((b.url || '').trim()) === url && String(b.category || '') === cat
                    ) || d.allBookmarks.find((b) => String((b.url || '').trim()) === url);
                }
            }
            if (!bookmark) {
                return false;
            }
            const bookmarkRef = d.resolveBookmarkReference(bookmark);
            if (!bookmarkRef) {
                return false;
            }
            void this.load().then((mod) => mod.openBookmarkInlineEditor(el, bookmarkRef)).catch(() => {});
            return true;
        }

        openBookmarkFormModal(options) {
            return this.load().then((mod) => mod.openBookmarkFormModal(options));
        }

        load() {
            if (this._module) return Promise.resolve(this._module);
            if (this._modulePromise) return this._modulePromise;

            this._modulePromise = loadInteractionModules().then(() => {
                this._module = new window.DashboardInlineEdit(this.dash);
                return this._module;
            }).catch((err) => {
                this._modulePromise = null;
                throw err;
            });

            return this._modulePromise;
        }

        /**
         * Long-press wiring is duplicated here so rows can be rendered without
         * fetching ~2k lines of inline-edit code. Only the timer callback loads.
         */
        attachBookmarkRowLongPress(row, openLink, bookmarkRef, signal) {
            const longMs = DashboardInlineEditLoader.ROW_LONG_PRESS_MS;
            const slop = 8;
            let timer = null;
            let startX = 0;
            let startY = 0;
            let activePointerId = null;

            const clearTimer = () => {
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }
                row.classList.remove('bookmark-longpress-armed');
                activePointerId = null;
            };

            const onPointerDown = (e) => {
                if (e.button !== undefined && e.button !== 0) return;
                if (e.target.closest('.bookmark-reorder-handle')) return;
                if (e.target.closest('.bookmark-inline-form')) return;
                clearTimer();
                startX = e.clientX;
                startY = e.clientY;
                activePointerId = e.pointerId;
                row.classList.add('bookmark-longpress-armed');
                timer = setTimeout(() => {
                    timer = null;
                    row.classList.remove('bookmark-longpress-armed');
                    activePointerId = null;
                    if (row.classList.contains('bookmark-inline-editing')) return;
                    if (document.body.classList.contains('bookmark-dragging')
                        || row.classList.contains('is-draggable')) {
                        return;
                    }
                    void this.load().then((mod) => {
                        mod.openBookmarkInlineEditor(row, bookmarkRef);
                        const blockNav = (ev) => {
                            ev.preventDefault();
                            ev.stopPropagation();
                            openLink.removeEventListener('click', blockNav, true);
                        };
                        openLink.addEventListener('click', blockNav, { capture: true, once: true });
                    }).catch(() => {});
                }, longMs);
            };

            const onPointerMove = (e) => {
                if (activePointerId !== null && e.pointerId !== activePointerId) return;
                if (!timer) return;
                const dx = Math.abs(e.clientX - startX);
                const dy = Math.abs(e.clientY - startY);
                if (dx > slop || dy > slop) clearTimer();
            };

            const onPointerEnd = (e) => {
                if (activePointerId !== null && e.pointerId !== activePointerId) return;
                clearTimer();
            };

            const onDragStart = () => clearTimer();

            row.addEventListener('pointerdown', onPointerDown, { capture: false, signal });
            row.addEventListener('pointermove', onPointerMove, { capture: false, signal });
            row.addEventListener('pointerup', onPointerEnd, { capture: false, signal });
            row.addEventListener('pointerleave', onPointerEnd, { capture: false, signal });
            row.addEventListener('pointercancel', onPointerEnd, { capture: false, signal });
            row.addEventListener('lostpointercapture', onPointerEnd, { capture: false, signal });
            row.addEventListener('dragstart', onDragStart, { capture: true, signal });
        }
    }

    class DashboardContextMenuLoader {
        constructor(dashboard) {
            this.dash = dashboard;
            this._module = null;
            this._modulePromise = null;
        }

        get instance() {
            return this._module;
        }

        load() {
            if (this._module) return Promise.resolve(this._module);
            if (this._modulePromise) return this._modulePromise;

            this._modulePromise = loadInteractionModules().then(() => {
                this._module = new window.DashboardContextMenu(this.dash);
                if (shareRefused) {
                    window.DashboardContextMenu.markShareRefused();
                }
                return this._module;
            }).catch((err) => {
                this._modulePromise = null;
                throw err;
            });

            return this._modulePromise;
        }

        /**
         * Deferred contextmenu binding — rows render without the menu module.
         * Guards that must fire before fetch mirror DashboardContextMenu.handleContextMenu.
         */
        /**
         * Health and config build share menu labels before this module loads.
         * Mirrors DashboardContextMenu.canOpenShareSheet without fetching the script.
         */
        canOpenShareSheet() {
            if (this._module) {
                return this._module.canOpenShareSheet();
            }
            if (typeof navigator.share !== 'function') return false;
            return !isShareRefused();
        }

        menuT(key, fallback, params) {
            const d = this.dash;
            const val = d.language?.t?.(key);
            const text = (val && val !== key) ? val : fallback;
            return params
                ? Object.entries(params).reduce(
                    (acc, [name, value]) => acc.replaceAll(`{${name}}`, String(value)),
                    String(text)
                )
                : String(text);
        }

        execCopyFallback(value) {
            const ta = document.createElement('textarea');
            ta.value = value;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            let ok = false;
            try { ok = document.execCommand('copy'); } catch { ok = false; }
            document.body.removeChild(ta);
            return ok;
        }

        copyShareText(text, row) {
            const d = this.dash;
            const value = String(text || '').trim();
            if (!value) return false;

            const done = () => {
                if (row) {
                    // Shared helper: the remove/reflow/add dance replays an animation that
                    // may still be running, and was written out by hand in five places.
                    this.dash?.bookmarkRows?.restartRowAnimation?.(row, 'bookmark-copy-flash');
                }
                const refused = isShareRefused();
                const insecure = !refused && window.isSecureContext === false;
                const explained = refused || insecure;
                let message;
                if (refused) {
                    message = this.menuT(
                        'dashboard.shareCopiedUnavailable',
                        'Copied — this browser will not open a share sheet here'
                    );
                } else if (insecure) {
                    message = this.menuT(
                        'dashboard.shareCopiedInsecure',
                        'Copied — sharing needs HTTPS or localhost'
                    );
                } else {
                    message = this.menuT('dashboard.shareCopied', 'Link copied to share');
                }
                d.showNotification?.(message, 'success', { duration: explained ? 4000 : 2000 });
            };

            if (navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(value).then(done).catch(() => {
                    if (this.execCopyFallback(value)) done();
                });
                return true;
            }
            if (this.execCopyFallback(value)) {
                done();
                return true;
            }
            return false;
        }

        /**
         * Synchronous entry point for health/config row menus. Must not await
         * module load first — navigator.share() and clipboard writes need the
         * click gesture that opened the menu.
         */
        async shareBookmark(bookmark, row) {
            if (this._module) {
                return this._module.shareBookmark(bookmark, row);
            }
            const url = String(bookmark?.url || '').trim();
            if (!url) return 'none';
            const title = String(bookmark?.name || '').trim();

            if (navigator.share) {
                try {
                    await navigator.share(title ? { title, text: title, url } : { url });
                    return 'shared';
                } catch (err) {
                    if (err?.name === 'AbortError') return 'cancelled';
                    if (err?.name === 'NotAllowedError') {
                        markShareRefused();
                    }
                }
            }

            return this.copyShareText(title ? `${title} — ${url}` : url, row) ? 'copied' : 'none';
        }

        /**
         * Resolving a row to its bookmark answers synchronously here too.
         *
         * Callers read the result straight away — `ref.bookmark` — so going
         * through the proxy's generic path, which answers with a Promise until
         * the module is fetched, left them holding an object with no bookmark on
         * it and silently doing nothing. Same shape as
         * DashboardContextMenu.resolveRowBookmark, which this mirrors.
         */
        resolveRowBookmark(row) {
            if (this._module) {
                return this._module.resolveRowBookmark(row);
            }
            const d = this.dash;
            if (!row) return null;
            if (row.classList.contains('inbox-item')) {
                const id = row.getAttribute('data-inbox-id');
                const item = (d.inbox?.items || []).find((entry) => entry.id === id);
                const url = String(item?.url || row.getAttribute('data-bookmark-url') || '').trim();
                if (!url) return null;
                const name = String(
                    item?.previewTitle || item?.title || item?.domain
                    || row.getAttribute('data-inbox-share-name') || ''
                ).trim();
                return {
                    bookmark: { name, url },
                    index: -1,
                    scope: 'inbox',
                    pageId: 0,
                    original: null,
                };
            }
            const rawIndex = row.getAttribute('data-bookmark-index');
            if (rawIndex !== null) {
                const index = Number(rawIndex);
                const bookmark = d.bookmarks?.[index];
                if (bookmark) {
                    return {
                        bookmark,
                        index,
                        scope: 'current',
                        pageId: Number(d.currentPageId),
                        original: { ...bookmark },
                    };
                }
            }
            // Kept in step with DashboardContextMenu.resolveRowBookmark: the same
            // URL sits on more than one page, so the copy whose name matches the
            // row's label is the one that was clicked. Preferring the current
            // page by list order resolved another page's row to the wrong
            // bookmark. This copy is the one that runs on the first right-click
            // of a session, before the module has loaded.
            const url = row.getAttribute('data-bookmark-url');
            if (!url) return null;
            const label = (row.querySelector('.bookmark-text')?.textContent || '').trim();
            const candidates = [];
            [d.bookmarks, d.allBookmarks].forEach((list) => {
                (list || []).forEach((b) => {
                    if (b?.url === url && !candidates.includes(b)) candidates.push(b);
                });
            });
            if (!candidates.length) return null;
            const bookmark = (label && candidates.find((b) => String(b.name || '').trim() === label))
                || candidates[0];
            return d.resolveBookmarkReference(bookmark);
        }

        /** Sync label for menu markup — must not return a Promise from the loader proxy. */
        shareActionLabel() {
            if (this._module) {
                return this._module.shareActionLabel();
            }
            const d = this.dash;
            const share = d.language?.t?.('dashboard.contextMenuShare');
            const copy = d.language?.t?.('dashboard.contextMenuCopyNameUrl');
            return this.canOpenShareSheet()
                ? (share && share !== 'dashboard.contextMenuShare' ? share : 'Share…')
                : (copy && copy !== 'dashboard.contextMenuCopyNameUrl' ? copy : 'Copy name + URL');
        }

        bindRow(row) {
            if (!(row instanceof HTMLElement) || row.dataset.contextMenuBound === '1') return;
            row.dataset.contextMenuBound = '1';
            row.addEventListener('contextmenu', (e) => {
                const d = this.dash;
                if (row.classList.contains('bookmark-inline-editing')) return;
                if (d.uiHelpers?.isModalOpen?.()) return;
                if (e.shiftKey) return;
                if (!row.getAttribute('data-bookmark-index') && !row.getAttribute('data-bookmark-url')) {
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                void this.load().then((mod) => mod.handleContextMenu(e, row)).catch(() => {});
            });
        }
    }

    function createProxyLoader(stub) {
        return new Proxy(stub, {
            get(target, prop, receiver) {
                if (prop in target) return Reflect.get(target, prop, receiver);
                const mod = target.instance;
                if (mod) {
                    const value = mod[prop];
                    return typeof value === 'function' ? value.bind(mod) : value;
                }
                if (typeof prop === 'string' && prop in (target.constructor || {})) {
                    return target.constructor[prop];
                }
                return (...args) => target.load().then((loaded) => {
                    const value = loaded[prop];
                    return typeof value === 'function' ? value.apply(loaded, args) : value;
                });
            },
            set(target, prop, value, receiver) {
                if (prop in target) return Reflect.set(target, prop, value, receiver);
                const mod = target.instance;
                if (mod) {
                    mod[prop] = value;
                    return true;
                }
                return Reflect.set(target, prop, value, receiver);
            },
        });
    }

    window.DashboardInlineEditLoader = DashboardInlineEditLoader;
    window.DashboardContextMenuLoader = DashboardContextMenuLoader;
    window.createDashboardInlineEditLoader = (dashboard) => createProxyLoader(new DashboardInlineEditLoader(dashboard));
    window.createDashboardContextMenuLoader = (dashboard) => createProxyLoader(new DashboardContextMenuLoader(dashboard));
}());
