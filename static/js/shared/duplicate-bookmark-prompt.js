/**
 * The answer to "you already have this link" — shared by everything that saves
 * a bookmark.
 *
 * The server refuses a second copy on the same page and asks about a copy on
 * another page (see AddBookmark: same-page duplicates are always a mistake,
 * cross-page ones are sometimes deliberate). Three surfaces have to act on that
 * answer — the new-bookmark modal, quick add, and the inline create form — so
 * the reading of the 409 and the dialog it turns into live here rather than in
 * each of them.
 */
(function (global) {
    'use strict';

    function translate(key, fallback) {
        const language = global.dashboardInstance?.language;
        if (!language || typeof language.t !== 'function') return fallback;
        const value = language.t(key);
        return value && value !== key ? value : fallback;
    }

    const escapeHtml = window.NextDashHtml.escapeHtml;

    /**
     * The duplicate-URL 409, or null for any other body — a shortcut clash, a
     * plain-text error, or a response that is not a 409 at all.
     */
    function parse(raw) {
        if (!raw) return null;
        let body = null;
        try {
            body = JSON.parse(raw);
        } catch {
            return null;
        }
        if (body?.error !== 'duplicate_url') return null;
        return { samePage: body.samePage === true, bookmark: body.conflict || {} };
    }

    /** "Work · Docs", the page alone, or "" when neither is known. */
    function describe(bookmark) {
        const pageName = String(bookmark?.pageName || '').trim();
        // categoryName rather than category: the stored value is an id, which
        // would be meaningless on screen.
        const categoryName = String(bookmark?.categoryName || '').trim();
        if (pageName && categoryName) return `${pageName} · ${categoryName}`;
        return pageName || categoryName || '';
    }

    /** "You already saved this on Work · Docs.", or the placeless version. */
    function locationMessage(bookmark) {
        const where = describe(bookmark);
        if (!where) {
            return translate('config.duplicateElsewhere', 'You already saved this link somewhere else.');
        }
        return translate('config.duplicateElsewhereWhere', 'You already saved this on {where}.')
            .replace('{where}', where);
    }

    function displayName(bookmark) {
        const name = String(bookmark?.name || '').trim();
        if (name) return name;
        const url = String(bookmark?.url || '').trim();
        try {
            return new URL(url).hostname;
        } catch {
            return url;
        }
    }

    /**
     * Ask whether to save a second copy. The existing bookmark is a link in the
     * dialog, because knowing where it is only helps if you can go there.
     * Resolves false when the modal is unavailable and window.confirm is
     * declined — nothing is saved on a false.
     */
    async function confirmSecondCopy(bookmark) {
        const message = locationMessage(bookmark);
        if (typeof global.AppModal?.confirm !== 'function') {
            return Boolean(global.confirm(message));
        }
        const openLabel = translate('config.duplicateOpenExisting', 'Open the one you have');
        const htmlMessage = `<p>${escapeHtml(message)}</p>`
            + '<p class="duplicate-existing">'
            + `<a href="${escapeHtml(bookmark?.url || '')}" target="_blank" rel="noopener noreferrer">${escapeHtml(displayName(bookmark))}</a>`
            + ` <span class="duplicate-existing-hint">${escapeHtml(openLabel)}</span></p>`;
        return Boolean(await global.AppModal.confirm({
            title: translate('config.duplicateTitle', 'Already saved'),
            htmlMessage,
            confirmText: translate('config.duplicateSaveAnyway', 'Save anyway'),
            cancelText: translate('config.cancel', 'Cancel'),
        }));
    }

    global.DuplicateBookmarkPrompt = {
        parse,
        describe,
        locationMessage,
        displayName,
        confirmSecondCopy,
    };
}(window));
