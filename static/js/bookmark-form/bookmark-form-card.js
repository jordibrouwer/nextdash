/**
 * What the page says about itself, in the bookmark form.
 *
 * A quiet card rather than a panel of controls: the icon with one pencil for
 * everything you can do to it, the site, the page's own line and its image.
 * Empty until the page answers, and never a spinner -- the form stays still
 * while it waits.
 */
(function (global) {
    'use strict';

    function hostOf(url) {
        try { return new URL(url).host; } catch { return ''; }
    }

    function mount(host, options = {}) {
        const t = typeof options.t === 'function' ? options.t : (_k, fallback) => fallback;
        host.classList.add('bookmark-form-card');
        host.replaceChildren();

        const iconBox = document.createElement('div');
        iconBox.className = 'bookmark-form-card-icon';
        const iconImg = document.createElement('img');
        iconImg.alt = '';
        iconImg.hidden = true;
        // No icon yet, or none at all: the letter the dashboard row would
        // draw in its place, rather than an empty square.
        const letter = document.createElement('span');
        letter.className = 'bookmark-icon-letter bookmark-form-card-letter';
        // Before there is an address there is no letter to draw either: a
        // plain link mark says what will appear here.
        const blank = document.createElement('span');
        blank.className = 'bookmark-form-card-blank';
        blank.setAttribute('aria-hidden', 'true');
        blank.innerHTML = '<svg viewBox="0 0 24 24" focusable="false"><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/></svg>';
        iconBox.append(iconImg, letter, blank);
        let currentHost = '';
        let currentIcon = '';
        // A stored icon that no longer loads is no icon at all.
        iconImg.addEventListener('error', () => {
            currentIcon = '';
            iconImg.hidden = true;
            syncLetter();
        });
        const syncLetter = () => {
            const bare = currentHost.replace(/^www\./, '');
            letter.hidden = Boolean(currentIcon) || !bare;
            blank.hidden = Boolean(currentIcon) || Boolean(bare);
            letter.textContent = bare.charAt(0).toUpperCase();
            // Nothing to change on a card with no address yet.
            pencil.hidden = !bare && !currentIcon;
        };

        const pencil = document.createElement('button');
        pencil.type = 'button';
        pencil.className = 'bookmark-form-card-pencil';
        pencil.setAttribute('aria-haspopup', 'menu');
        pencil.setAttribute('aria-label', t('config.bookmarkIconMenu', 'Change icon'));
        pencil.textContent = '✎';
        iconBox.appendChild(pencil);

        const menu = document.createElement('div');
        menu.className = 'bookmark-form-card-menu';
        menu.setAttribute('role', 'menu');
        menu.hidden = true;
        const item = (label, fn) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.setAttribute('role', 'menuitem');
            b.textContent = label;
            b.addEventListener('click', (e) => {
                e.preventDefault();
                menu.hidden = true;
                fn?.();
            });
            menu.appendChild(b);
        };
        item(t('config.detailUploadIconBtn', 'Upload…'), options.onUpload);
        item(t('config.bookmarkIconFetchAgain', 'Fetch again'), options.onFetchAgain);
        item(t('config.detailClearIconBtn', 'Clear'), options.onClear);
        iconBox.appendChild(menu);
        // The form closes on Escape in the capture phase; an open menu is
        // the innermost thing, so the form hands the key to this first.
        menu.__close = () => {
            menu.hidden = true;
            pencil.focus();
        };
        pencil.addEventListener('click', (e) => {
            e.preventDefault();
            menu.hidden = !menu.hidden;
        });
        host.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !menu.hidden) {
                e.stopPropagation();
                menu.hidden = true;
                pencil.focus();
            }
        });

        const text = document.createElement('div');
        text.className = 'bookmark-form-card-text';
        const hostLine = document.createElement('div');
        hostLine.className = 'bookmark-form-card-host';
        const desc = document.createElement('p');
        desc.className = 'bookmark-form-card-desc';
        // A read that gave nothing can be asked for again: sites that keep the
        // server waiting sometimes answer the second time.
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'bookmark-form-card-retry';
        retry.textContent = t('config.bookmarkPreviewRetry', 'Try again');
        retry.hidden = true;
        retry.addEventListener('click', (e) => {
            e.preventDefault();
            options.onRetry?.();
        });
        text.append(hostLine, desc, retry);

        const image = document.createElement('img');
        image.className = 'bookmark-form-card-image';
        image.alt = '';
        image.hidden = true;

        host.append(iconBox, text, image);

        return {
            setIcon(filename) {
                const name = String(filename || '').trim();
                currentIcon = name;
                iconImg.hidden = !name;
                iconImg.src = name ? `/data/icons/${encodeURIComponent(name)}` : '';
                syncLetter();
            },
            setIdle() {
                retry.hidden = true;
                host.classList.add('is-idle');
                host.classList.remove('is-loading', 'is-empty');
                hostLine.textContent = '';
                currentHost = '';
                desc.textContent = t('config.bookmarkPreviewIdle',
                    'The page’s own name, line and picture appear here once there is an address.');
                image.hidden = true;
                syncLetter();
            },
            setLoading(url) {
                retry.hidden = true;
                host.classList.remove('is-idle', 'is-empty');
                hostLine.textContent = hostOf(url);
                currentHost = hostLine.textContent;
                // Some sites keep the server waiting for seconds; the card says
                // it is reading rather than showing the last page's line.
                desc.textContent = t('config.bookmarkPreviewReading', 'Reading the page…');
                host.classList.add('is-loading');
                image.hidden = true;
                syncLetter();
            },
            setPreview(preview) {
                host.classList.remove('is-loading', 'is-idle');
                const url = String(preview?.url || '');
                // A read that failed, or a page with nothing to say: the last
                // page's preview is gone, and the card says why it is empty.
                const said = ['title', 'description', 'image'].some((k) => String(preview?.[k] || '').trim());
                host.classList.toggle('is-empty', !said);
                retry.hidden = said || !url;
                hostLine.textContent = hostOf(url) || hostLine.textContent;
                currentHost = hostLine.textContent;
                syncLetter();
                desc.textContent = said
                    ? String(preview?.description || '').trim()
                    : t('config.bookmarkPreviewNone',
                        'No preview — this page could not be read, or says nothing about itself. The bookmark saves fine without one.');
                const src = String(preview?.image || '').trim();
                image.hidden = !src;
                if (src) image.src = src;
            },
        };
    }

    global.BookmarkFormCard = { mount };
}(window));
