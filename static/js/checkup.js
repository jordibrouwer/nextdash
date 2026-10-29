/**
 * The checkup: one round through what is worth tidying on the dashboard.
 *
 * It opens with :checkup, from a button in the Bookmarks view, and from the
 * weekly digest. The bookmarks it names are the Health report's own findings
 * (broken, doubled, never opened, not opened lately); those steps lead to the
 * Bookmarks view on that filter, where the actions already are. The two kinds
 * the report cannot show are handled here: empty categories and pages, which
 * can be deleted from their row (after asking, and the trash keeps them), and
 * widgets that are broken or empty, which lead to Config.
 *
 * Nothing is stored. The steps are worked out each time the window opens, from
 * the report, /api/checkup/structure and what the widgets reported this session.
 */
(function (global) {
    'use strict';

    function dash() { return global.dashboardInstance || null; }

    function t(key, fallback, vars) {
        const language = dash()?.language;
        let text = fallback;
        if (language && typeof language.t === 'function') {
            const value = language.t(key);
            if (value && value !== key) text = value;
        }
        if (!vars) return text;
        // A function, so "$&" or "$1" in a name is text, not a pattern.
        return Object.entries(vars).reduce(
            (acc, [name, value]) => acc.replace(new RegExp(`\\{${name}\\}`, 'g'), () => String(value)),
            text
        );
    }

    function esc(value) {
        return global.NextDashHtml?.escapeHtml
            ? global.NextDashHtml.escapeHtml(String(value))
            : String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    }

    async function readJson(url) {
        try {
            const res = await fetch(url, { cache: 'no-store' });
            return res.ok ? await res.json() : null;
        } catch (_) {
            return null;
        }
    }

    /** What there is to look at, or null when none of it could be read. */
    async function gather() {
        const [report, structure] = await Promise.all([readJson('/api/bookmark-health'), readJson('/api/checkup/structure')]);
        if (!report && !structure) return null;
        // Only widgets that still exist: one deleted since it reported is gone.
        const exist = Array.isArray(structure?.widgetIds) ? new Set(structure.widgetIds) : null;
        const reported = global.WidgetState?.snapshot?.() || [];
        return {
            issues: Array.isArray(report?.issues) ? report.issues : [],
            structure: Array.isArray(structure?.items) ? structure.items : [],
            widgets: exist ? reported.filter((w) => exist.has(w.widgetId)) : reported,
        };
    }

    function stepTitle(id) {
        switch (id) {
            case 'broken': return t('checkup.brokenTitle', 'Broken links');
            case 'duplicate': return t('checkup.duplicateTitle', 'Doubled bookmarks');
            case 'unused': return t('checkup.unusedTitle', 'Never opened');
            case 'stale': return t('checkup.staleTitle', 'Not opened for a while');
            case 'structure': return t('checkup.structureTitle', 'Empty categories and pages');
            default: return t('checkup.widgetsTitle', 'Widgets that are not fine');
        }
    }

    function stepIntro(id) {
        switch (id) {
            case 'broken': return t('checkup.brokenIntro', 'A broken link is a bookmark whose address did not answer at the last check: the site is down, the page moved, or the address is wrong. Fix it, or let it go.');
            case 'duplicate': return t('checkup.duplicateIntro', 'The same address is saved more than once. One copy is enough; the Bookmarks view can merge them.');
            case 'unused': return t('checkup.unusedIntro', 'These bookmarks are on your dashboard but have never been opened. A link nobody uses is a candidate to move, archive or delete.');
            case 'stale': return t('checkup.staleIntro', 'You opened these once, but not for a long time. They may no longer be worth keeping.');
            case 'structure': return t('checkup.structureIntro', 'A category with nothing in it, or a page with no categories and no widgets, takes room and shows nothing. Delete them here; they stay in the trash for 30 days.');
            default: return t('checkup.widgetsIntro', 'A widget that failed to load, or loaded with nothing in it. It may point to a service that is gone, or need a new sign-in.');
        }
    }

    function structureRows(items) {
        return items.map((item) => {
            if (item.kind === 'category') {
                return `
                    <li class="checkup-row" data-checkup-category="${esc(item.categoryId)}" data-checkup-page="${esc(item.pageId)}">
                        <span class="checkup-row-name">${esc(t('checkup.emptyCategory', 'Category “{name}” on {page} is empty', { name: item.categoryName, page: item.pageName || item.pageId }))}</span>
                        <button type="button" class="checkup-btn" data-checkup-delete-category>${esc(t('checkup.delete', 'Delete'))}</button>
                    </li>`;
            }
            const first = Number(item.pageId) === 1;
            return `
                <li class="checkup-row" data-checkup-page-empty="${esc(item.pageId)}">
                    <span class="checkup-row-name">${esc(t('checkup.emptyPage', 'Page “{name}” has no categories and no widgets', { name: item.pageName || item.pageId }))}</span>
                    ${first ? '' : `<button type="button" class="checkup-btn" data-checkup-delete-page>${esc(t('checkup.delete', 'Delete'))}</button>`}
                </li>`;
        }).join('');
    }

    function widgetRows(widgets) {
        const pages = dash()?.pages || [];
        return widgets.map((w) => {
            const page = pages.find((p) => Number(p.id) === Number(w.pageId))?.name;
            const name = w.title || t('checkup.widgetUntitled', 'A widget');
            const title = page ? t('checkup.widgetOnPage', '{title} on {page}', { title: name, page }) : name;
            const what = w.state === 'error'
                ? t('checkup.widgetError', 'did not load: {reason}', { reason: w.reason || t('checkup.widgetNoReason', 'no answer') })
                : t('checkup.widgetEmpty', 'loaded with nothing in it');
            return `<li class="checkup-row" data-checkup-widget="${esc(w.widgetId)}"><span class="checkup-row-name">${esc(title)} — ${esc(what)}</span></li>`;
        }).join('');
    }

    function stepHtml(step, index, total) {
        const isBookmarks = Boolean(step.healthFilter);
        let body = '';
        if (isBookmarks) {
            body = `<button type="button" class="checkup-btn checkup-btn--primary" data-checkup-go="${esc(step.healthFilter)}">${esc(t('checkup.openInBookmarks', 'Open in Bookmarks'))} <span aria-hidden="true">→</span></button>`;
        } else if (step.id === 'structure') {
            body = `<ul class="checkup-rows">${structureRows(step.items)}</ul>`;
        } else {
            body = `<ul class="checkup-rows">${widgetRows(step.items)}</ul>
                <p class="checkup-note">${esc(t('checkup.widgetsNote', 'Only widgets that loaded in this session are known; a widget on a page you have not opened is not checked.'))}</p>
                <button type="button" class="checkup-btn checkup-btn--primary" data-checkup-widgets-config>${esc(t('checkup.openWidgets', 'Open widgets in Config'))} <span aria-hidden="true">→</span></button>`;
        }
        return `
            <section class="checkup-step" data-checkup-step="${esc(step.id)}">
                <div class="checkup-step-head">
                    <span class="checkup-step-count">${esc(String(step.count))}</span>
                    <h3 class="checkup-step-title">${esc(stepTitle(step.id))}</h3>
                    <span class="checkup-step-of">${esc(t('checkup.stepOf', 'Step {n} of {total}', { n: index + 1, total }))}</span>
                </div>
                <p class="checkup-step-intro">${esc(stepIntro(step.id))}</p>
                ${body}
            </section>`;
    }

    async function goToHealth(filter) {
        const d = dash();
        if (!d) return;
        history.replaceState(history.state, '', `${global.location.pathname}${global.location.search}#bookmarks?health=${encodeURIComponent(filter)}`);
        await d.config?.openLibraryView?.();
    }

    /** Ask before deleting; the answer reopens the window either way, up to date. */
    function confirmDelete(message, run) {
        return new Promise((resolve) => {
            let answered = false;
            const finish = async (yes) => {
                if (answered) return;
                answered = true;
                if (yes) await run();
                resolve();
            };
            global.AppModal.show({
                title: t('checkup.confirmTitle', 'Delete this?'),
                message,
                confirmText: t('checkup.delete', 'Delete'),
                cancelText: t('checkup.cancel', 'Cancel'),
                onConfirm: () => { void finish(true); },
                onCancel: () => { void finish(false); },
                // A button's own hide is followed by its callback: only a hide
                // with no answer (Escape, a click outside, another window) is a no.
                onHide: (info) => { if (info?.reason !== 'confirm' && info?.reason !== 'cancel') void finish(false); },
            });
        });
    }

    async function open() {
        const d = dash();
        if (!d || !global.AppModal?.show) return false;
        const data = await gather();
        const raw = data ? global.CheckupModel.buildSteps(data) : [];
        const items = { structure: data?.structure || [], widgets: data?.widgets || [] };
        const steps = raw.map((step) => ({ ...step, items: items[step.id] || [] }));
        const html = steps.length
            ? `<div class="checkup-window">
                    <p class="checkup-lead">${esc(t('checkup.lead', 'Things worth a few minutes. Nothing here changes by itself.'))}</p>
                    ${steps.map((step, i) => stepHtml(step, i, steps.length)).join('')}
               </div>`
            : `<div class="checkup-window"><p class="checkup-empty">${esc(data
                ? t('checkup.nothing', 'Nothing to tidy up.')
                : t('checkup.couldNotCheck', 'The checkup could not check: the dashboard did not answer. Try again in a moment.'))}</p></div>`;
        global.AppModal.show({
            title: t('checkup.title', 'Checkup'),
            htmlMessage: html,
            confirmText: t('checkup.close', 'Close'),
            showCancel: false,
            modalClass: 'checkup-modal',
            modalMaxWidth: 'min(52rem, calc(100vw - 2.5rem))',
        });
        const win = document.querySelector('.checkup-modal .checkup-window');
        if (!win) return true;
        win.addEventListener('click', (event) => {
            const target = event.target instanceof Element ? event.target : null;
            if (!target) return;
            const go = target.closest('[data-checkup-go]');
            if (go) {
                global.AppModal.hide?.();
                void goToHealth(go.getAttribute('data-checkup-go'));
                return;
            }
            if (target.closest('[data-checkup-widgets-config]')) {
                global.AppModal.hide?.();
                void d.config?.openConfigView?.('widgets');
                return;
            }
            const categoryRow = target.closest('[data-checkup-category]');
            if (categoryRow && target.closest('[data-checkup-delete-category]')) {
                const pageId = categoryRow.getAttribute('data-checkup-page');
                const categoryId = categoryRow.getAttribute('data-checkup-category');
                const name = categoryRow.querySelector('.checkup-row-name')?.textContent || categoryId;
                void confirmDelete(t('checkup.confirmCategory', '{name}. It goes to the trash for 30 days.', { name }), async () => {
                    // The category menu's own finish: the redraw, the error, and the Undo.
                    await d.categoryMenu?.finishCategoryDelete?.(pageId, { id: categoryId, name });
                }).then(() => open());
                return;
            }
            const pageRow = target.closest('[data-checkup-page-empty]');
            if (pageRow && target.closest('[data-checkup-delete-page]')) {
                const pageId = Number(pageRow.getAttribute('data-checkup-page-empty'));
                global.AppModal.hide?.();
                // Config's own delete asks first and has its own undo.
                void Promise.resolve(d.config?.deletePage?.(pageId)).then(() => open());
            }
        });
        return true;
    }

    global.Checkup = { open };
})(window);
