/**
 * A bookmark as a QR code, to open it on a phone.
 *
 * Every entry -- the right-click menu, Shift+J on a row, the Bookmarks view's
 * side panel and Health's row menu -- calls BookmarkQR.show(), so the window is
 * the same wherever it was asked for.
 *
 * The code is drawn in the browser: the address never goes to the server or
 * anywhere else. qrcode-generator (MIT, static/vendor/qrcode-generator) is
 * fetched the first time a code is drawn.
 *
 * The code is always black on white with a quiet zone of four modules, whatever
 * the theme: a phone camera reads a light-on-dark or tinted code badly or not at
 * all, and the white margin is part of the symbol, not decoration.
 */
(function (global) {
    'use strict';

    const LIBRARY = 'vendor/qrcode-generator/1.4.4/qrcode.js';
    // Four modules of white around the symbol is what the standard asks for.
    const QUIET_ZONE = 4;
    let loading = null;

    function t(key, fallback, vars) {
        const lang = global.dashboardInstance?.language;
        let text = fallback;
        if (lang?.t) {
            const value = lang.t(key);
            if (value && value !== key) text = value;
        }
        if (vars) {
            Object.keys(vars).forEach((name) => {
                text = text.replace(`{${name}}`, vars[name]);
            });
        }
        return text;
    }

    function load() {
        if (typeof global.qrcode === 'function') return Promise.resolve(global.qrcode);
        if (!loading) {
            loading = global.LazyScript.loadScriptOnce(LIBRARY, 'bookmarkQrLibrary', () => typeof global.qrcode === 'function')
                .then(() => global.qrcode)
                .catch((error) => {
                    loading = null;
                    throw error;
                });
        }
        return loading;
    }

    /**
     * The symbol as an SVG string: one path of unit squares on a white field.
     *
     * One path rather than a rect per module keeps a long address at a few
     * kilobytes, and crispEdges stops the browser from blurring the module
     * edges at fractional sizes.
     *
     * Throws when the address does not fit in a QR code at all.
     */
    function svgFor(qrcode, url) {
        // Byte mode as UTF-8: an address with an accented path or an
        // internationalised host must come out the same on the phone.
        qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
        // Type 0 picks the smallest version the address fits; level M survives
        // a screen's glare and moiré without making the symbol much denser.
        const qr = qrcode(0, 'M');
        qr.addData(url, 'Byte');
        qr.make();

        const count = qr.getModuleCount();
        const size = count + QUIET_ZONE * 2;
        let path = '';
        for (let row = 0; row < count; row++) {
            for (let col = 0; col < count; col++) {
                if (qr.isDark(row, col)) {
                    path += `M${col + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`;
                }
            }
        }
        return `<svg class="bookmark-qr-code" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" `
            + `shape-rendering="crispEdges" role="img" aria-label="${global.NextDashHtml.escapeHtml(t('dashboard.qrCodeImageLabel', 'QR code for {url}', { url }))}">`
            + `<rect width="${size}" height="${size}" fill="#fff"/>`
            + `<path d="${path}" fill="#000"/></svg>`;
    }

    function notify(message, type) {
        global.dashboardInstance?.showNotification?.(message, type, { duration: 3000 });
    }

    function copy(url) {
        const commands = global.dashboardInstance?.searchComponent?.commandsComponent;
        if (commands?._copyUrlToClipboard) {
            commands._copyUrlToClipboard(url, null);
            return;
        }
        navigator.clipboard?.writeText?.(url).then(
            () => notify(t('dashboard.urlCopied', 'URL copied'), 'success'),
            () => {}
        );
    }

    /**
     * Open the QR window for a bookmark.
     *
     * @param {{name?: string, url?: string}} bookmark
     * @returns {Promise<'shown'|'none'|'failed'|'too-long'>} what happened
     */
    async function show(bookmark) {
        const url = String(bookmark?.url || '').trim();
        if (!url) return 'none';
        const name = String(bookmark?.name || '').trim();

        let qrcode;
        try {
            qrcode = await load();
        } catch {
            notify(t('dashboard.qrCodeLoadFailed', 'The QR code could not be drawn'), 'error');
            return 'failed';
        }

        let svg;
        try {
            svg = svgFor(qrcode, url);
        } catch {
            notify(t('dashboard.qrCodeTooLong', 'This address is too long for a QR code'), 'error');
            return 'too-long';
        }

        // The same panel chrome as the cheat sheet and Recent: a lowercase
        // name, the key that opens it and Esc x in the header; the bookmark as
        // a section title, the way a widget names what it shows; the one action
        // and the way out in the foot instead of a row of full-width buttons.
        const escape = global.NextDashHtml.escapeHtml;
        global.AppModal.show({
            title: t('dashboard.qrCodeTitle', 'QR code'),
            htmlMessage: `<div class="bookmark-qr" data-bookmark-qr>`
                + `<div class="bookmark-qr-name" data-bookmark-qr-name>${escape(name || url)}</div>`
                + `<div class="bookmark-qr-frame">${svg}</div>`
                + `<div class="bookmark-qr-url" data-bookmark-qr-url>${escape(url)}</div>`
                + `<div class="bookmark-qr-foot">`
                + `<button type="button" class="modal-button bookmark-qr-copy" data-bookmark-qr-copy>`
                + `<span class="modal-button-name">${escape(t('dashboard.contextMenuCopyUrl', 'Copy URL'))}</span></button>`
                + `<span><span class="bookmark-qr-foot-key">Esc</span> ${escape(t('dashboard.cheatsheetFootClose', 'to close'))}</span>`
                + `</div>`
                + `</div>`,
            showCancel: false,
            modalClass: 'bookmark-qr-modal',
            initialFocusSelector: '[data-bookmark-qr-copy]'
        });

        const header = document.querySelector('.bookmark-qr-modal .modal-header');
        if (header && !header.querySelector('.bookmark-qr-modal-close')) {
            const chip = document.createElement('span');
            chip.className = 'bookmark-qr-modal-key';
            chip.dataset.modalHeaderExtra = 'true';
            chip.setAttribute('aria-hidden', 'true');
            chip.textContent = 'Shift + J';
            document.getElementById('modal-title')?.after(chip);

            const close = document.createElement('button');
            close.type = 'button';
            close.className = 'bookmark-qr-modal-close';
            close.dataset.modalHeaderExtra = 'true';
            close.setAttribute('aria-label', t('dashboard.close', 'Close'));
            close.innerHTML = '<span aria-hidden="true">Esc</span> \u00D7';
            close.addEventListener('click', () => global.AppModal.hide());
            header.appendChild(close);
        }
        document.querySelector('[data-bookmark-qr-copy]')?.addEventListener('click', () => {
            copy(url);
            global.AppModal.hide();
        });
        return 'shown';
    }

    global.BookmarkQR = { show };
})(window);
