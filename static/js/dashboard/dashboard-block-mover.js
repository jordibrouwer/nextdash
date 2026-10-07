/**
 * Moving a category, widget or collection on the dashboard.
 *
 * The page does not move while a block is carried. DragReorder moved the
 * element through the DOM on every hover, so the grid reflowed under the
 * pointer, the block under it slid away and the target flipped back and
 * forth; in packed mode the DOM order is not even the column the reader sees.
 * Here the grid is left alone and a landing box shows where the block will be,
 * measured in an invisible copy of the grid laid out in the new order.
 */
(function (global) {
    'use strict';

    function blockId(el) {
        return String(el.getAttribute('data-widget-id') || el.getAttribute('data-category-id') || '');
    }

    /*
     * A hidden copy of the grid, laid out in `order`, with the moved block at
     * `width`. Built from the live blocks so heights, fonts and spans are the
     * real ones; packed round-robin, masonry and the plain grid are rebuilt
     * the way dashboard-render-core distributes them.
     */
    function buildClone(grid, order, id, width) {
        const dash = global.dashboardInstance;
        const rc = dash?.renderCore;
        const live = new Map();
        grid.querySelectorAll('.category[data-category-id], .dashboard-widget[data-widget-id]')
            .forEach((el) => { if (!live.has(blockId(el))) live.set(blockId(el), el); });

        const clone = grid.cloneNode(false);
        clone.removeAttribute('id');
        clone.setAttribute('aria-hidden', 'true');
        const box = grid.getBoundingClientRect();
        Object.assign(clone.style, {
            position: 'absolute', visibility: 'hidden', pointerEvents: 'none',
            left: `${box.left + global.scrollX}px`, top: `${box.top + global.scrollY}px`,
            width: `${box.width}px`, contain: 'layout style',
        });

        // In `order`, collections included: they are placed like any block.
        // A live block the order leaves out (Other, which has no id to move)
        // stays in the copy at the end, where the render keeps it: without it
        // every column after would fill one block early.
        const ordered = order.map((bid) => live.get(bid)).filter(Boolean);
        const rest = [...live.values()].filter((el) => !ordered.includes(el));
        const blocks = [...ordered, ...rest].map((el) => {
            const copy = el.cloneNode(true);
            copy.removeAttribute('id');
            copy.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
            copy.classList.remove('is-move-source');
            return copy;
        });
        const moved = blocks.find((el) => blockId(el) === id);
        if (moved) applyWidth(dash, moved, width);

        const colCount = rc?.getEffectiveColumnsPerRow?.() || 1;
        const packed = grid.classList.contains('packed-columns');
        const anyWide = blocks.some((el) => el.classList.contains('category--wide'));
        if (packed && !anyWide) {
            clone.classList.remove('packed-masonry');
            const columns = Array.from({ length: colCount }, () => {
                const col = document.createElement('div');
                col.className = 'dashboard-column';
                clone.appendChild(col);
                return col;
            });
            blocks.forEach((el, i) => columns[i % colCount].appendChild(el));
        } else {
            clone.classList.toggle('packed-masonry', packed && anyWide);
            blocks.forEach((el) => clone.appendChild(el));
        }
        document.body.appendChild(clone);
        if (packed && anyWide) global.DashboardPackedMasonry?.sync?.(clone);
        return { clone, moved };
    }

    /** One column, or wide: two for a widget or collection, spread for a category. */
    function applyWidth(dash, el, width) {
        if (width == null) return;
        const twoColumns = el.classList.contains('dashboard-widget') || el.getAttribute('data-smart-collection') === 'true';
        const Span = global.DashboardCategorySpan;
        let span = 1;
        if (width === 2) {
            span = twoColumns
                ? Math.min(2, dash?.renderCore?.getEffectiveColumnsPerRow?.() || 1)
                : (Span?.spanForCount?.(dash, Span.countFromElement(el)) || 1);
        }
        el.classList.toggle('category--wide', span > 1);
        if (span > 1) el.style.setProperty('--category-span', String(span));
        else el.style.removeProperty('--category-span');
    }

    /** Where `id` lands in `order` at `width`, relative to the grid's top-left. */
    function predictRect(grid, order, id, width) {
        if (!grid || !grid.getBoundingClientRect().width) return null;
        const { clone, moved } = buildClone(grid, order, id, width);
        try {
            if (!moved) return null;
            const g = clone.getBoundingClientRect();
            const b = moved.getBoundingClientRect();
            return { x: b.left - g.left, y: b.top - g.top, w: b.width, h: b.height };
        } finally {
            clone.remove();
        }
    }


    // ---- Carrying a block: pointer ----

    let state = null;

    function Model() { return global.BlockMoveModel; }

    function t(key, vars, fallback) {
        return global.dashboardInstance?.formatDashboardLabel?.(key, vars, fallback)
            || fallback.replace(/\{(\w+)\}/g, (_, k) => vars?.[k] ?? '');
    }

    /** Where every block sits right now, in the order the reader sees them. */
    function frozenRects(grid, order) {
        const g = grid.getBoundingClientRect();
        const rects = [];
        order.forEach((bid) => {
            const el = grid.querySelector(`.category[data-category-id="${CSS.escape(bid)}"]`);
            if (!el) return;
            const r = el.getBoundingClientRect();
            rects.push({ id: bid, x: r.left - g.left, y: r.top - g.top, w: r.width, h: r.height });
        });
        return rects;
    }

    function canWiden(id) {
        const dash = global.dashboardInstance;
        const cols = dash?.renderCore?.getEffectiveColumnsPerRow?.() || 1;
        if (cols < 2) return false;
        if (!dash?.renderCore?.isCategoryBlockId?.(id)) return true;
        return global.DashboardCategorySpan?.spreadSupported?.(dash) === true;
    }

    function placeLabel(order, id, width) {
        const rc = global.dashboardInstance?.renderCore;
        const p = Model().describePlace(order, id, (bid) => rc?.blockName?.(bid) || bid);
        const where = p.key === 'first'
            ? t('blockLandFirst', {}, 'first on the page')
            : t('blockLandAfter', { name: p.name }, 'after {name}');
        const wide = rc?.isCategoryBlockId?.(id) ? t('blockLandSpread', {}, 'spread') : t('blockLandWide', {}, '2 columns');
        return `${where} · ${width === 2 ? wide : t('blockLandOne', {}, '1 column')}`;
    }

    /** Where the column lines are, relative to the grid: the centres of the gutters between columns. */
    function seamPositions(grid) {
        const rc = global.dashboardInstance?.renderCore;
        const cols = rc?.getEffectiveColumnsPerRow?.() || 1;
        const g = grid.getBoundingClientRect();
        const gap = parseFloat(getComputedStyle(grid).columnGap) || 0;
        const colW = (g.width - gap * (cols - 1)) / cols;
        return Model().seamCentres(0, colW, gap, cols);
    }

    function drawSeams(grid) {
        if (!canWiden(state.id)) return [];
        const seams = seamPositions(grid);
        seams.forEach((x) => {
            const el = document.createElement('div');
            el.className = 'block-seam';
            el.style.left = `${x}px`;
            grid.appendChild(el);
        });
        return seams;
    }

    function announce(text) {
        let live = document.getElementById('block-move-live');
        if (!live) {
            live = document.createElement('div');
            live.id = 'block-move-live';
            live.className = 'sr-only';
            live.setAttribute('aria-live', 'polite');
            document.body.appendChild(live);
        }
        live.textContent = text;
    }

    function hideLanding() {
        state?.landing?.remove();
        if (state) state.landing = null;
    }

    // ---- First-time coach ----

    /*
     * A card that explains moving a block. It appears beside the landing box on
     * the first pick-up, stays beside the block after the drop or a cancel, and
     * goes when the reader says "Got it" or presses Escape; only then is it
     * remembered (in the server-backed list of tips already shown), so a reload
     * before that shows it again. While a block is carried it takes no pointer
     * events, so it never takes the drop.
     */
    const COACH_TIP = 'blockMoveCoach';
    const COACH_GAP = 12;
    const COACH_MARGIN = 8;
    let coach = null;

    function coachRows(s) {
        if (s.mode === 'pointer' && s.pointerType === 'touch') return [];
        const mod = global.ShortcutFormat?.modifierLabel?.() === 'Cmd' ? '⌘Z' : 'Ctrl+Z';
        const rows = [];
        if (canWiden(s.id)) rows.push([s.mode === 'keyboard' ? 'W' : 'W / Shift', t('blockCoachWidth', {}, 'one column or wide')]);
        rows.push(
            ['Esc', t('blockCoachCancel', {}, 'cancel')],
            [mod, t('blockCoachUndo', {}, 'undo the last move')],
            ['Space', t('blockCoachPickUp', {}, 'on // picks up with the keyboard')],
            ['← → ↑ ↓', t('blockCoachArrows', {}, 'move the box')],
            ['Enter', t('blockCoachDrop', {}, 'drop')],
            ['Alt + ← / →', t('blockCoachPlace', {}, 'on a title: one place')],
            ['Shift + Alt + ← / →', t('blockCoachPage', {}, 'on a title: another page')],
        );
        return rows;
    }

    /** The card's text for this pick-up: the width lines only where the block can be wider. */
    function fillCoach(card, s) {
        const wide = canWiden(s.id);
        const eyebrow = document.createElement('div');
        eyebrow.className = 'block-move-coach-eyebrow';
        eyebrow.textContent = t('sessionTipLabel', {}, 'Tip');
        const title = document.createElement('div');
        title.className = 'block-move-coach-title';
        title.textContent = t('blockCoachTitle', {}, 'Moving a block');
        const nodes = [eyebrow, title];
        const lines = [t('blockCoachLanding', {}, 'The dashed box shows where it lands.')];
        if (s.mode === 'pointer' && wide) {
            lines.push(t('blockCoachSeam', {}, 'Drop on the line between two columns to make it wide.'));
            if (s.pointerType === 'touch') {
                lines.push(t('blockCoachTouchWide', {}, 'Tap the width button on the box to make it wide.'));
            }
        }
        lines.forEach((text) => {
            const p = document.createElement('p');
            p.textContent = text;
            nodes.push(p);
        });
        const rows = coachRows(s);
        if (rows.length) {
            const legend = document.createElement('div');
            legend.className = 'block-move-coach-keys';
            rows.forEach(([key, label]) => {
                const chip = document.createElement('span');
                const kbd = document.createElement('kbd');
                kbd.textContent = key;
                chip.append(kbd, ` ${label}`);
                legend.appendChild(chip);
            });
            nodes.push(legend);
        }
        const done = document.createElement('button');
        done.type = 'button';
        done.className = 'block-move-coach-done';
        done.textContent = t('blockCoachGotIt', {}, 'Got it');
        done.addEventListener('click', () => dismissCoach());
        nodes.push(done);
        card.replaceChildren(...nodes);
    }

    /** Where the card is anchored, in viewport coordinates: the landing box while carrying, else the block. */
    function coachBox() {
        if (state && state.coachRect) {
            const g = state.grid.getBoundingClientRect();
            const r = state.coachRect;
            return { l: g.left + r.x, t: g.top + r.y, r: g.left + r.x + r.w, b: g.top + r.y + r.h };
        }
        const el = coach?.id
            ? document.querySelector(`#dashboard-layout .category[data-category-id="${CSS.escape(coach.id)}"]`)
            : null;
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { l: r.left, t: r.top, r: r.right, b: r.bottom };
    }

    /*
     * Beside the anchor, inside the viewport: to its right first, then below,
     * left and above. The first spot that fits whole and clear of it wins; an
     * anchor too big for any (a wide block across a small window) gets the spot
     * it is least covered at. With no anchor the card waits in the corner.
     */
    function placeCoach() {
        const card = coach?.el;
        if (!card) return;
        const box = coachBox();
        const vw = document.documentElement.clientWidth;
        const vh = global.innerHeight;
        const w = card.offsetWidth;
        const h = card.offsetHeight;
        const clampX = (x) => Math.max(COACH_MARGIN, Math.min(x, vw - w - COACH_MARGIN));
        const clampY = (y) => Math.max(COACH_MARGIN, Math.min(y, vh - h - COACH_MARGIN));
        let best;
        if (!box) {
            best = [clampX(vw), clampY(vh)];
        } else {
            const spots = [
                [box.r + COACH_GAP, clampY(box.t)],
                [clampX(box.l), box.b + COACH_GAP],
                [box.l - COACH_GAP - w, clampY(box.t)],
                [clampX(box.l), box.t - COACH_GAP - h],
            ];
            const overlap = ([x, y]) => Math.max(0, Math.min(x + w, box.r) - Math.max(x, box.l))
                * Math.max(0, Math.min(y + h, box.b) - Math.max(y, box.t));
            const fits = ([x, y]) => x >= COACH_MARGIN && y >= COACH_MARGIN
                && x + w <= vw - COACH_MARGIN && y + h <= vh - COACH_MARGIN;
            best = spots.find((spot) => fits(spot) && overlap(spot) === 0);
            if (!best) {
                const clamped = spots.map(([x, y]) => [clampX(x), clampY(y)]);
                best = clamped.reduce((a, c) => (overlap(c) < overlap(a) ? c : a));
            }
        }
        card.style.transform = `translate(${Math.round(best[0])}px, ${Math.round(best[1])}px)`;
    }

    /** Takes the card away without remembering it. */
    function removeCoach() {
        if (!coach) return;
        coach.el.remove();
        global.removeEventListener('scroll', coach.onMove);
        global.removeEventListener('resize', coach.onMove);
        coach = null;
    }

    /** "Got it" or Escape: gone, and not shown again on this installation. */
    function dismissCoach() {
        if (!coach) return;
        removeCoach();
        global.DiscoverabilityState?.markTipSeen?.(COACH_TIP);
    }

    /** Shown beside the landing box on the first pick-up; a second pick-up while it is up keeps the same card. */
    function showCoach(s, rect) {
        s.coachRect = rect;
        if (!coach) {
            const tips = global.DiscoverabilityState;
            if (!s.coachWanted || !tips || tips.hasSeenTip(COACH_TIP)) return;
            const el = document.createElement('div');
            el.className = 'block-move-coach';
            // A note rather than a live message: someone who picked up with the
            // keyboard already hears the keys in the blockPickedUp announcement.
            el.setAttribute('role', 'note');
            document.body.appendChild(el);
            coach = { el, id: s.id, onMove: () => placeCoach() };
            global.addEventListener('scroll', coach.onMove, { passive: true });
            global.addEventListener('resize', coach.onMove);
        }
        if (!s.coachFilled) {
            s.coachFilled = true;
            coach.id = s.id;
            fillCoach(coach.el, s);
            coach.el.classList.add('is-carried');
            coach.el.inert = true;
        }
        placeCoach();
    }

    /** The block is down (or back): the card goes beside it and takes clicks. */
    function settleCoach(s, redrawn) {
        if (!coach) return;
        coach.id = s.id;
        coach.el.classList.remove('is-carried');
        coach.el.inert = false;
        placeCoach();
        // The redraw and its slide move the block: anchor again once it has settled.
        const again = () => { if (coach && !state) placeCoach(); };
        Promise.resolve(redrawn).catch(() => {}).then(() => {
            requestAnimationFrame(again);
            setTimeout(again, 400);
        });
    }

    function showLanding() {
        if (!state) return;
        const { grid, order, id, width } = state;
        const rect = predictRect(grid, order, id, width);
        if (!rect) { hideLanding(); return; }
        if (!state.landing) {
            state.landing = document.createElement('div');
            state.landing.className = 'block-landing';
            state.landing.innerHTML = '<span class="block-landing-label"></span>';
            grid.appendChild(state.landing);
        }
        Object.assign(state.landing.style, {
            left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px`,
        });
        state.landing.dataset.width = String(width);
        showCoach(state, rect);
        const label = placeLabel(order, id, width);
        state.landing.dataset.place = label;
        state.landing.firstChild.textContent = label;
        announce(`${global.dashboardInstance?.renderCore?.blockName?.(id) || id}, ${label}`);

        if (state.mode === 'pointer' && state.pointerType === 'touch' && canWiden(id)) {
            // No keyboard on a phone: the width is a tap on the box itself.
            let toggle = state.landing.querySelector('.block-landing-width');
            if (!toggle) {
                toggle = document.createElement('button');
                toggle.type = 'button';
                toggle.className = 'block-landing-width';
                toggle.addEventListener('pointerdown', (ev) => {
                    ev.stopPropagation();
                    state.width = state.width === 2 ? 1 : 2;
                    showLanding();
                });
                state.landing.appendChild(toggle);
            }
            toggle.textContent = state.width === 2 ? '1 col' : '2 cols';
        }
    }

    function begin(grid, sourceEl, mode, pointerType, point = null) {
        const rc = global.dashboardInstance.renderCore;
        const id = blockId(sourceEl);
        const order = rc.blockOrderFromDom().filter((bid) => grid.querySelector(`.category[data-category-id="${CSS.escape(bid)}"]`));
        state = {
            grid, id, mode, pointerType: pointerType || 'mouse', sourceEl,
            startOrder: order, order, startWidth: rc.blockWidth(id), width: rc.blockWidth(id),
            seamWidth: null, rects: frozenRects(grid, order), landing: null, chip: null, seams: [], scrollTimer: null,
            madeRelative: false, coachRect: null, coachFilled: false,
            coachWanted: !global.DiscoverabilityState?.hasSeenTip?.(COACH_TIP),
        };
        if (getComputedStyle(grid).position === 'static') {
            grid.style.position = 'relative';
            state.madeRelative = true;
        }
        sourceEl.classList.add('is-move-source');
        document.body.classList.add('is-moving-block');
        state.seams = mode === 'pointer' ? drawSeams(grid) : [];
        // What the seams read where the block was picked up: the width only
        // changes when the pointer crosses into or out of a seam band from
        // there, so a block that starts wide stays wide through a jiggle.
        if (state.seams.length && point) {
            const g = grid.getBoundingClientRect();
            state.seamWidth = Model().widthFromSeam(point.clientX - g.left, state.seams);
        }
        showLanding();
    }

    function finish(commit) {
        if (!state) return;
        const s = state;
        state = null;
        clearInterval(s.scrollTimer);
        s.chip?.remove();
        s.landing?.remove();
        s.grid.querySelectorAll('.block-seam').forEach((n) => n.remove());
        if (s.madeRelative) s.grid.style.position = '';
        s.sourceEl.classList.remove('is-move-source');
        document.body.classList.remove('is-moving-block');
        const changed = s.order.join('|') !== s.startOrder.join('|') || s.width !== s.startWidth;
        if (commit && changed) {
            const redrawn = global.dashboardInstance.renderCore.commitBlockMove({
                id: s.id, order: s.order, width: s.width !== s.startWidth ? s.width : null,
            });
            settleCoach(s, redrawn);
        } else {
            announce(t('blockMoveCancelled', {}, 'Move cancelled'));
            settleCoach(s);
        }
    }

    function autoscroll(y) {
        clearInterval(state.scrollTimer);
        const edge = 60;
        const dir = y < edge ? -1 : (y > global.innerHeight - edge ? 1 : 0);
        if (!dir) return;
        state.scrollTimer = setInterval(() => {
            global.scrollBy({ top: dir * 14, behavior: 'instant' });
            if (!state) return;
            state.rects = frozenRects(state.grid, state.startOrder);
            // The page moved under a pointer that did not: the block under it is another one now.
            retarget(state.lastX, state.lastY);
        }, 16);
    }

    /** The block order and width for a pointer at (clientX, clientY); redraws the landing box when they changed. */
    function retarget(clientX, clientY) {
        const g = state.grid.getBoundingClientRect();
        const point = { x: clientX - g.left, y: clientY - g.top };
        const index = Model().targetFromPoint(state.rects, point, state.id);
        const order = Model().insertAt(state.startOrder, state.id, index);
        let width = state.width;
        const seamWidth = state.seams.length ? Model().widthFromSeam(point.x, state.seams) : null;
        if (seamWidth !== null && seamWidth !== state.seamWidth) {
            state.seamWidth = seamWidth;
            width = seamWidth;
        }
        if (order.join('|') !== state.order.join('|') || width !== state.width) {
            state.order = order;
            state.width = width;
            showLanding();
        }
    }

    function onPointerMove(e) {
        if (!state || state.mode !== 'pointer') return;
        state.chip.style.transform = `translate(${e.clientX + 12}px, ${e.clientY + 8}px)`;
        state.lastX = e.clientX;
        state.lastY = e.clientY;
        retarget(e.clientX, e.clientY);
        autoscroll(e.clientY);
    }

    function onPointerUp(e) {
        if (!state || state.mode !== 'pointer') return;
        const g = state.grid.getBoundingClientRect();
        const slack = 40;
        const inside = e.clientX >= g.left - slack && e.clientX <= g.right + slack
            && e.clientY >= g.top - slack && e.clientY <= g.bottom + slack;
        finish(inside);
    }

    /** The block is rebuilt by the redraw, so focus goes back to the handle of the new one. */
    function refocus(id) {
        requestAnimationFrame(() => requestAnimationFrame(() => {
            document.querySelector(`#dashboard-layout .category[data-category-id="${CSS.escape(id)}"] .category-reorder-handle`)
                ?.focus({ preventScroll: true });
        }));
    }

    /** Other, an unknown category, a tag filter's chunk: built per render, not placed. */
    function isFixedBlock(block) {
        return Boolean(block?.matches?.('[data-virtual-category="true"], [data-tag-filter-chunk="true"]'));
    }

    function pickUp(handle) {
        const block = handle.closest('.category[data-category-id]');
        const grid = document.getElementById('dashboard-layout');
        if (!block || !grid || state || isFixedBlock(block) || global.dashboardInstance?.settings?.lockLayout) return false;
        begin(grid, block, 'keyboard');
        announce(t('blockPickedUp', { name: global.dashboardInstance.renderCore.blockName(state.id) },
            'Picked up {name}. Arrows move, W changes width, Enter drops, Escape cancels.'));
        return true;
    }

    function onKeyDown(e) {
        if (!state) {
            // Nothing carried: Escape also puts the coach away, unless a dialog has it.
            if (e.key === 'Escape' && coach && !document.querySelector('.modal-overlay.show')) dismissCoach();
            return;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopImmediatePropagation();
            const id = state.id;
            const keyboard = state.mode === 'keyboard';
            finish(false);
            if (keyboard) refocus(id);
            return;
        }
        if (state.mode === 'keyboard') {
            const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
            if (keys.includes(e.key)) {
                e.preventDefault();
                e.stopImmediatePropagation();
                const cols = global.dashboardInstance?.renderCore?.getEffectiveColumnsPerRow?.() || 1;
                const current = state.order.indexOf(state.id);
                const next = Model().stepTarget(current, e.key, cols, state.order.length - 1);
                state.order = Model().insertAt(state.startOrder, state.id, next);
                showLanding();
                return;
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopImmediatePropagation();
                const id = state.id;
                finish(true);
                refocus(id);
                return;
            }
        }
        if (e.key === 'w' || e.key === 'W' || (state.mode === 'pointer' && e.key === 'Shift')) {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (e.repeat) return;
            if (!canWiden(state.id)) {
                announce(t('blockWidthUnavailable', {}, 'This block cannot be wider here.'));
                return;
            }
            // The seam reading stays as it was: only crossing into or out of
            // a seam band changes the width again, not the next pointer move.
            state.width = state.width === 2 ? 1 : 2;
            showLanding();
        }
    }

    function attach(grid) {
        if (!grid) return () => {};
        let pending = null;
        const cancelPending = () => {
            if (pending) clearTimeout(pending.timer);
            pending = null;
        };
        const start = (handle, e) => {
            const block = handle.closest('.category[data-category-id]');
            if (!block || state || isFixedBlock(block)) return;
            begin(grid, block, 'pointer', e.pointerType, e);
            // The one pointer that carries it: a second finger or pen lifting
            // is not this drop.
            state.pointerId = e.pointerId ?? null;
            state.chip = document.createElement('div');
            state.chip.className = 'block-drag-chip';
            state.chip.textContent = `// ${global.dashboardInstance.renderCore.blockName(state.id)}`;
            document.body.appendChild(state.chip);
            state.chip.style.transform = `translate(${e.clientX + 12}px, ${e.clientY + 8}px)`;
        };
        const onDown = (e) => {
            const handle = e.target.closest?.('.category-reorder-handle');
            if (!handle || e.button !== 0 || state || isFixedBlock(handle.closest('.category'))) return;
            if (global.dashboardInstance?.settings?.lockLayout) return;
            e.preventDefault();
            if (e.pointerType === 'touch') {
                // A touch that starts a scroll must stay a scroll: carry only after a press that holds still.
                cancelPending();
                const snapshot = { pointerType: e.pointerType, pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY };
                pending = {
                    x: e.clientX, y: e.clientY, pointerId: e.pointerId,
                    timer: setTimeout(() => { pending = null; start(handle, snapshot); }, 350),
                };
                return;
            }
            start(handle, e);
        };
        // Events of any other pointer than the one pressing or carrying.
        const other = (e) => {
            const id = state?.pointerId ?? pending?.pointerId;
            return id != null && e.pointerId != null && e.pointerId !== id;
        };
        const onPendingMove = (e) => {
            if (other(e)) return;
            if (pending && Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > 8) cancelPending();
            onPointerMove(e);
        };
        const onPendingUp = (e) => {
            if (other(e)) return;
            cancelPending();
            onPointerUp(e);
        };
        const onCancel = (e) => {
            if (other(e)) return;
            cancelPending();
            finish(false);
        };
        const onGridKey = (e) => {
            const handle = e.target.closest?.('.category-reorder-handle');
            if ((e.key === ' ' || e.key === 'Spacebar') && handle && !state && !e.repeat) {
                e.preventDefault();
                e.stopPropagation();
                const dash = global.dashboardInstance;
                if (dash?.settings?.lockLayout) {
                    // Said, the way the menu and Shift+Alt+←/→ say it, rather
                    // than a key that does nothing.
                    const text = t('blockMoveLocked', {}, 'Layout is locked — turn off Lock layout in Config → Behavior to move blocks.');
                    announce(text);
                    dash.showNotification?.(text, 'info');
                    return;
                }
                pickUp(handle);
            }
        };
        const onEscape = (e) => { if (e.key === 'Escape') cancelPending(); };
        grid.addEventListener('keydown', onGridKey, true);
        document.addEventListener('keydown', onEscape, true);
        grid.addEventListener('pointerdown', onDown);
        document.addEventListener('pointermove', onPendingMove);
        document.addEventListener('pointerup', onPendingUp);
        document.addEventListener('pointercancel', onCancel);
        document.addEventListener('keydown', onKeyDown, true);
        return () => {
            cancelPending();
            finish(false);
            grid.removeEventListener('pointerdown', onDown);
            grid.removeEventListener('keydown', onGridKey, true);
            document.removeEventListener('keydown', onEscape, true);
            document.removeEventListener('pointermove', onPendingMove);
            document.removeEventListener('pointerup', onPendingUp);
            document.removeEventListener('pointercancel', onCancel);
            document.removeEventListener('keydown', onKeyDown, true);
        };
    }

    function isMoving() { return Boolean(state); }

    global.DashboardBlockMover = {
        predictRect, attach, isMoving, begin, finish, showLanding, pickUp,
        canWiden, placeLabel, seamPositions,
        get state() { return state; },
    };
})(window);
