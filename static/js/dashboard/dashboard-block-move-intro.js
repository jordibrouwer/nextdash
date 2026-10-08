/**
 * A one-time animation that shows blocks can be moved.
 *
 * A see-through copy of the first movable category lifts, glides to the next
 * place with the real landing box (DashboardBlockMover.predictRect, so the box
 * is exactly where the block would land), widens on the column line when the
 * block can be wide, and glides home. Then a card stays under its "//" until
 * "Got it", "Try it" or Escape. Nothing on the page moves and nothing is saved.
 *
 * It waits its turn the way the other once-only tips do: not over the dashboard
 * tour, What's new, a quick start or notice card, a toast or a modal, and not
 * inside the tips cooldown. Closing the card is what remembers it (the tip id
 * below, server-side, so "Replay tours and tips" brings it back); a key or a
 * pointer press during the animation, a page change or a redraw stops it
 * without remembering, and it may come back on the next visit.
 */
(function (global) {
    'use strict';

    const TIP_ID = 'blockMoveIntro';
    // The first-move coach: seen means the reader has already moved a block.
    const COACH_TIP = 'blockMoveCoach';
    const TOUR_TIP = 'dashboardTutorialV3';
    // The gap dashboard-keyboard-tip.js keeps between tips.
    const TIP_GAP_MS = 3 * 24 * 60 * 60 * 1000;

    const FIRST_CHECK_MS = 1500;
    const RETRY_MS = 1000;
    const MAX_CHECKS = 150;
    // A redraw or a page change stops a run; it may start again this many times.
    const MAX_STARTS = 3;
    const CARD_GAP = 12;
    const CARD_MARGIN = 8;

    // When each step starts, in ms from the first frame.
    const AT = { glow: 800, lift: 1600, land: 2000, wide: 2900, back: 3700, settle: 4100, card: 4300 };

    let checks = 0;
    let starts = 0;
    let pollTimer = null;
    let lastSignature = '';
    // The run in progress, animation or card.
    let run = null;
    let finished = false;

    function dash() { return global.dashboardInstance || null; }
    function mover() { return global.DashboardBlockMover || null; }
    function tips() { return global.DiscoverabilityState || null; }

    function t(key, vars, fallback) {
        return dash()?.formatDashboardLabel?.(key, vars, fallback)
            || fallback.replace(/\{(\w+)\}/g, (_, k) => vars?.[k] ?? '');
    }

    function isTouch() {
        return typeof global.matchMedia === 'function' && global.matchMedia('(hover: none) and (pointer: coarse)').matches;
    }

    function reducedMotion() {
        return typeof global.matchMedia === 'function' && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    // ---- When ----

    /** The blocks as DashboardBlockMover sees them when it picks one up, in the order the reader sees them. */
    function gridOrder(grid) {
        const rc = dash()?.renderCore;
        if (!rc || !grid) return [];
        return rc.blockOrderFromDom().filter((bid) => grid.querySelector(`.category[data-category-id="${CSS.escape(bid)}"]`));
    }

    /** The first category on the page that has a handle to pick up, and can be seen. */
    function firstMovable(grid, order) {
        const rc = dash().renderCore;
        const vh = global.innerHeight;
        for (const bid of order) {
            if (!rc.isCategoryBlockId(bid)) continue;
            const block = grid.querySelector(`.category[data-category-id="${CSS.escape(bid)}"]`);
            const handle = block?.querySelector('button.category-reorder-handle');
            if (!block || !handle || block.matches('[data-virtual-category="true"], [data-tag-filter-chunk="true"]')) continue;
            // The first one in the visual order is the one shown; if the reader
            // has scrolled past it, the intro waits rather than pointing off screen.
            const r = handle.getBoundingClientRect();
            if (!handle.getClientRects().length || r.top < 0 || r.bottom > vh) return null;
            return { id: bid, block, handle };
        }
        return null;
    }

    /** Whether something else has the screen, or the reader does not want a tip. Not about this block. */
    function busy() {
        const d = dash();
        if (!d?.settings) return true;
        if (d.activeView && d.activeView !== 'bookmarks') return true;
        if (typeof d.promos?.canShowUnpromptedUi === 'function' && !d.promos.canShowUnpromptedUi()) return true;
        if (d.searchComponent?.isActive?.()) return true;
        // The dashboard tour comes first; its turn is not over until it is seen.
        if (!tips().hasSeenTip(TOUR_TIP)) return true;
        if (document.querySelector('.quickstart-card, .notice-card, .whats-new-modal')) return true;
        // A toast (another tip, an answer to something the reader did) is up.
        if (global.AppNotification?._busy) return true;
        return Boolean(mover()?.isMoving?.()) || Boolean(run);
    }

    /** True when the intro will not run in this page load at all. */
    function neverThisLoad() {
        const d = dash();
        const s = tips();
        if (!s || !mover() || !global.BlockMoveModel) return true;
        if (s.hasSeenTip(TIP_ID) || s.hasSeenTip(COACH_TIP)) return true;
        if (d?.settings?.enableSessionTips === false) return true;
        if (global.DemoLock?.on) return true;
        const notBefore = Number(s.getTipsNotBefore?.() || 0);
        return Boolean(notBefore && Date.now() < notBefore);
    }

    function signature(grid, order) {
        return `${order.join('|')}@${Math.round(grid.getBoundingClientRect().height)}`;
    }

    function poll() {
        pollTimer = null;
        if (finished || run) return;
        checks += 1;
        if (checks > MAX_CHECKS || starts >= MAX_STARTS || neverThisLoad()) return;
        const again = () => { pollTimer = setTimeout(poll, RETRY_MS); };
        const d = dash();
        const grid = document.getElementById('dashboard-layout');
        if (!d || !grid || busy() || d.settings.lockLayout) { lastSignature = ''; again(); return; }

        const order = gridOrder(grid);
        // Two blocks to choose between, or there is nothing to show.
        if (order.length < 2) { lastSignature = ''; again(); return; }
        // The first render has settled: the same blocks at the same height as a moment ago.
        const sig = signature(grid, order);
        const settled = sig === lastSignature;
        lastSignature = sig;
        const pick = settled ? firstMovable(grid, order) : null;
        if (!pick) { again(); return; }
        start(grid, order, pick);
    }

    function schedule(delay) {
        clearTimeout(pollTimer);
        pollTimer = setTimeout(poll, delay);
    }

    // ---- The run ----

    function el(tag, className, parent) {
        const node = document.createElement(tag);
        node.className = className;
        parent?.appendChild(node);
        return node;
    }

    function listen(r, target, type, fn, opts) {
        target.addEventListener(type, fn, opts);
        r.listeners.push([target, type, fn, opts]);
    }

    function place(node, r) {
        Object.assign(node.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    }

    /** Where `id` is now, relative to the grid's top-left (the frame the landing box lives in). */
    function liveRect(grid, block) {
        const g = grid.getBoundingClientRect();
        const b = block.getBoundingClientRect();
        return { x: b.left - g.left, y: b.top - g.top, w: b.width, h: b.height };
    }

    function start(grid, order, pick) {
        const d = dash();
        const rc = d.renderCore;
        const Model = global.BlockMoveModel;
        const { id, block, handle } = pick;
        const at = order.indexOf(id);
        // After the next block; the last block goes one place up instead.
        const target = at + 1 <= order.length - 1 ? at + 1 : at - 1;
        const nextOrder = Model.insertAt(order, id, target);
        const narrow = mover().predictRect(grid, nextOrder, id, 1);
        if (!narrow) { schedule(RETRY_MS); return; }
        starts += 1;

        const r = {
            grid, id, block, handle, pageId: d.currentPageId, timers: [], listeners: [],
            madeRelative: false, card: null, ghost: null, box: null, seams: [], watch: null,
            reduced: reducedMotion(), touch: isTouch(), phase: 'animating',
        };
        run = r;
        document.body.classList.add('is-block-move-intro');
        if (getComputedStyle(grid).position === 'static') {
            grid.style.position = 'relative';
            r.madeRelative = true;
        }

        // Any press or key from the reader ends the animation; the card is theirs to close.
        const onInput = () => { if (run === r && r.phase === 'animating') stop('input'); };
        ['pointerdown', 'keydown'].forEach((type) => {
            listen(r, document, type, onInput, true);
        });
        r.watch = setInterval(() => watchTick(r), 150);

        if (r.reduced) {
            handle.classList.add('is-intro-ring');
            showCard(r);
            return;
        }

        const later = (ms, fn) => {
            r.timers.push(setTimeout(() => { if (run === r) fn(); }, ms));
        };
        const startRect = () => liveRect(grid, block);

        later(AT.glow, () => handle.classList.add('is-intro-glow'));

        later(AT.lift, () => {
            const s = startRect();
            r.ghost = el('div', 'block-intro-ghost', grid);
            r.ghost.textContent = `// ${rc.blockName(id)}`;
            place(r.ghost, s);
            r.ghost.getBoundingClientRect();
            r.ghost.classList.add('is-up');
            block.classList.add('is-move-source');
        });

        later(AT.land, () => {
            // Measured now, not at the start: widgets may have loaded in since.
            const to = mover().predictRect(grid, nextOrder, id, 1);
            if (!to) { stop('layout'); return; }
            const s = startRect();
            r.ghost.style.left = `${to.x}px`;
            r.ghost.style.top = `${to.y}px`;
            r.ghost.style.width = `${to.w}px`;
            r.ghost.style.height = `${s.h}px`;
            r.box = el('div', 'block-landing block-intro-box', grid);
            r.box.innerHTML = '<span class="block-landing-label"></span>';
            r.box.firstChild.textContent = mover().placeLabel(nextOrder, id, 1);
            place(r.box, to);
            r.landed = to;
        });

        later(AT.wide, () => {
            if (!mover().canWiden(id)) return;
            const wide = mover().predictRect(grid, nextOrder, id, 2);
            if (!wide || !r.box) return;
            mover().seamPositions(grid).forEach((x) => {
                const seam = el('div', 'block-seam block-intro-seam', grid);
                seam.style.left = `${x}px`;
                r.seams.push(seam);
            });
            place(r.box, wide);
            r.box.firstChild.textContent = mover().placeLabel(nextOrder, id, 2);
            // The copy follows the pointer onto the line: centred on the wide box.
            r.ghost.style.left = `${wide.x + wide.w / 2 - r.ghost.offsetWidth / 2}px`;
        });

        later(AT.back, () => {
            const s = startRect();
            r.seams.forEach((n) => n.remove());
            r.seams = [];
            r.box?.remove();
            r.box = null;
            place(r.ghost, s);
        });

        later(AT.settle, () => {
            r.ghost.classList.remove('is-up');
            block.classList.remove('is-move-source');
            handle.classList.remove('is-intro-glow');
            handle.classList.add('is-intro-ring');
        });

        later(AT.card, () => showCard(r));
    }

    /** Takes the animation away (not the card) and puts the page back as it was. */
    function clearStage(r) {
        r.timers.forEach(clearTimeout);
        r.timers = [];
        r.ghost?.remove();
        r.box?.remove();
        r.seams.forEach((n) => n.remove());
        r.ghost = null;
        r.box = null;
        r.seams = [];
        r.block?.classList.remove('is-move-source');
        r.handle?.classList.remove('is-intro-glow');
        if (r.madeRelative && r.grid.isConnected) r.grid.style.position = '';
        r.madeRelative = false;
    }

    function teardown(r) {
        clearStage(r);
        clearInterval(r.watch);
        r.listeners.forEach(([target, type, fn, opts]) => target.removeEventListener(type, fn, opts));
        r.listeners = [];
        r.handle?.classList.remove('is-intro-ring');
        r.card?.remove();
        r.card = null;
        document.body.classList.remove('is-block-move-intro');
        if (run === r) run = null;
    }

    /** Ends the run without remembering it: it may show again next visit. */
    function stop(reason) {
        const r = run;
        if (!r) return;
        teardown(r);
        // A redraw or page change can be tried again; the reader's own input cannot.
        if (reason !== 'input') schedule(RETRY_MS * 2);
    }

    // How the card ended, as the demo reports it: the block was moved, the
    // visitor chose Try it or Got it, or dismissed the card.
    const DEMO_INTRO_OUTCOME = { moved: 'completed', 'try-it': 'try-it', 'got-it': 'got-it', escape: 'skipped' };

    /** The card was answered: remembered, and gone. */
    function close(outcome) {
        const r = run;
        if (!r) return null;
        const { handle, id } = r;
        teardown(r);
        finished = true;
        tips()?.markTipSeen?.(TIP_ID);
        // A tip like the others: the next one waits out the usual gap.
        tips()?.setTipsNotBefore?.(Date.now() + TIP_GAP_MS);
        global.nextdashTrack?.('block-move-intro:closed', { outcome });
        // The demo counts how its intro ended in the demo's own words.
        if (global.DemoLock?.on) {
            global.nextdashTrack?.('demo:intro', { outcome: DEMO_INTRO_OUTCOME[outcome] || outcome });
        }
        return { handle, id };
    }

    function currentHandle(r) {
        if (r.handle?.isConnected) return r.handle;
        // The grid was redrawn (a refresh, a widget loading): the same block, new element.
        const fresh = r.grid.isConnected
            ? r.grid.querySelector(`.category[data-category-id="${CSS.escape(r.id)}"] button.category-reorder-handle`)
            : null;
        if (fresh) {
            r.handle = fresh;
            r.block = fresh.closest('.category');
            if (r.phase === 'card') fresh.classList.add('is-intro-ring');
        }
        return fresh;
    }

    function watchTick(r) {
        if (run !== r) return;
        const d = dash();
        const away = d?.activeView !== 'bookmarks' || d.currentPageId !== r.pageId
            || (typeof d.isModalOpen === 'function' && d.isModalOpen());
        if (away) { stop('away'); return; }
        if (r.phase === 'animating') {
            // A redraw replaces the blocks the animation is drawn over.
            if (!r.block.isConnected || !r.grid.isConnected) stop('redraw');
            return;
        }
        if (mover()?.isMoving?.()) {
            // The reader picked a block up themselves: they have found it.
            close('moved');
            return;
        }
        if (!currentHandle(r)) { stop('gone'); return; }
        placeCard(r);
    }

    // ---- The card ----

    function showCard(r) {
        r.phase = 'card';
        clearStage(r);
        r.timers = [];
        const card = el('div', 'block-move-coach block-intro-card', document.body);
        card.setAttribute('role', 'dialog');
        card.setAttribute('aria-label', t('blockIntroTitle', {}, 'Move categories and widgets'));
        const eyebrow = el('div', 'block-move-coach-eyebrow', card);
        eyebrow.textContent = t('sessionTipLabel', {}, 'Tip');
        const title = el('div', 'block-move-coach-title', card);
        title.textContent = t('blockIntroTitle', {}, 'Move categories and widgets');
        const body = el('p', '', card);
        // Our own translated strings, with <code> and <kbd>: never user input.
        body.innerHTML = r.touch
            ? t('blockIntroBodyTouch', {}, 'Press and hold <code>//</code> before a title, then drag. A box shows where it lands.')
            : t('blockIntroBody', {}, 'Drag <code>//</code> before a title. A box shows where it lands; drop on the line between columns to make it wide. With the keyboard: <kbd>Tab</kbd> to <code>//</code>, then <kbd>Space</kbd>.');
        const actions = el('div', 'block-intro-actions', card);
        const got = el('button', 'block-intro-btn', actions);
        got.type = 'button';
        got.textContent = t('blockCoachGotIt', {}, 'Got it');
        got.addEventListener('click', () => close('got-it'));
        if (!r.touch) {
            const tryIt = el('button', 'block-move-coach-done', actions);
            tryIt.type = 'button';
            tryIt.textContent = t('blockIntroTryIt', {}, 'Try it');
            tryIt.addEventListener('click', () => tryMoving());
            r.tryButton = tryIt;
        }
        r.card = card;
        r.onMove = () => placeCard(r);
        listen(r, global, 'scroll', r.onMove, { passive: true });
        listen(r, global, 'resize', r.onMove);
        const onKey = (e) => {
            if (e.key !== 'Escape' || run !== r || r.phase !== 'card') return;
            if (mover()?.isMoving?.() || document.querySelector('.modal-overlay.show')) return;
            e.preventDefault();
            close('escape');
        };
        listen(r, document, 'keydown', onKey, true);
        placeCard(r);
    }

    /** Under the "//", its arrow pointing up at it; above it when there is no room below. */
    function placeCard(r) {
        const card = r.card;
        const handle = r.handle;
        if (!card || !handle?.isConnected) return;
        const h = handle.getBoundingClientRect();
        const vw = document.documentElement.clientWidth;
        const vh = global.innerHeight;
        const w = card.offsetWidth;
        const ch = card.offsetHeight;
        const centre = h.left + h.width / 2;
        // The arrow sits 25px from the card's left edge (see the CSS).
        const x = Math.max(CARD_MARGIN, Math.min(centre - 25, vw - w - CARD_MARGIN));
        const below = h.bottom + CARD_GAP;
        const above = h.top - CARD_GAP - ch;
        const flip = below + ch > vh - CARD_MARGIN && above >= CARD_MARGIN;
        const y = flip ? above : below;
        card.classList.toggle('is-above', flip);
        card.style.setProperty('--intro-arrow-x', `${Math.max(10, Math.min(w - 24, centre - x - 7))}px`);
        card.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    }

    /** "Try it": the same pick-up as Space on the handle, so the first-move coach shows. */
    function tryMoving() {
        const r = run;
        if (!r) return;
        const handle = currentHandle(r);
        close('try-it');
        if (!handle) return;
        handle.focus({ preventScroll: true });
        mover()?.pickUp?.(handle);
    }

    function autoStart() {
        schedule(FIRST_CHECK_MS);
    }

    global.DashboardBlockMoveIntro = { TIP_ID, autoStart, isRunning: () => Boolean(run) };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autoStart, { once: true });
    } else {
        autoStart();
    }
})(window);
