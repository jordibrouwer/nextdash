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
        static CLICK_OUTSIDE_DELAY_MS = 500;

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
            if (!this.isInlineEditUnsavedChanges()) {
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
