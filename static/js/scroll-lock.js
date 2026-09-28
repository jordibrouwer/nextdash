/**
 * Refcounted page scroll lock.
 *
 * Five components used to each write `document.body.style.overflow` directly —
 * modal.js, search.js, reorder.js, search-commands-new.js — with no shared
 * bookkeeping. Two of them saved the previous value to restore it, and two
 * simply cleared it. Every overlap between any two broke:
 *
 *   show A: previous = ''       -> body hidden
 *   show B: previous = 'hidden' <- captures the LOCK as the "original" value
 *   hide B: restores 'hidden'   -> body stays locked until a reload
 *
 * That is not hypothetical: opening a config info modal while another AppModal
 * was up left the page unscrollable with the modal already closed, which is the
 * bug this file exists to kill.
 *
 * A count fixes it because the invariant is about nesting, not about values:
 * the first acquire snapshots the real inline style, every further acquire only
 * increments, and the style is restored once the last holder releases. Nobody
 * has to know whether someone else is also holding a lock.
 *
 * Locks are keyed by an owner token so a component that releases twice (or
 * releases something it never acquired) cannot drag the count below the number
 * of real holders — a stray release is the other way to strand the page.
 */
class ScrollLock {
    constructor() {
        this.holders = new Set();
        this.previousOverflow = null;
        this.previousTouchAction = null;
        this.previousUserSelect = null;
        this._seq = 0;
    }

    /**
     * Take a lock. Returns an opaque token to hand back to release().
     *
     * `options.freezeInteraction` also pins touch-action/user-select, which the
     * drag-reorder path needs so a touch drag does not scroll or select text.
     * It is deliberately part of the same refcount: reorder and a modal can be
     * active together, and the interaction styles have to survive until both
     * are done for the same reason the overflow does.
     */
    acquire(owner, options = {}) {
        const token = owner || `scroll-lock-${++this._seq}`;
        if (this.holders.has(token)) {
            return token;
        }

        if (this.holders.size === 0) {
            const style = document.body.style;
            this.previousOverflow = style.overflow;
            this.previousTouchAction = style.touchAction;
            this.previousUserSelect = style.userSelect;
        }

        this.holders.add(token);
        document.body.style.overflow = 'hidden';
        if (options.freezeInteraction) {
            document.body.style.touchAction = 'none';
            document.body.style.userSelect = 'none';
        }
        return token;
    }

    /** Drop a lock. Restores the original styles once the last holder is gone. */
    release(token) {
        if (!token || !this.holders.has(token)) {
            return;
        }
        this.holders.delete(token);
        if (this.holders.size > 0) {
            return;
        }

        const style = document.body.style;
        style.overflow = this.previousOverflow || '';
        style.touchAction = this.previousTouchAction || '';
        style.userSelect = this.previousUserSelect || '';
        this.previousOverflow = null;
        this.previousTouchAction = null;
        this.previousUserSelect = null;
    }

    /** True while any component holds a lock. */
    isLocked() {
        return this.holders.size > 0;
    }

    /**
     * Escape hatch for a page that is already stranded — drops every holder and
     * restores the styles. Only for teardown/tests; normal code releases its own
     * token so it does not yank the lock out from under another component.
     */
    releaseAll() {
        this.holders.clear();
        const style = document.body.style;
        style.overflow = this.previousOverflow || '';
        style.touchAction = this.previousTouchAction || '';
        style.userSelect = this.previousUserSelect || '';
        this.previousOverflow = null;
        this.previousTouchAction = null;
        this.previousUserSelect = null;
    }
}

window.ScrollLock = new ScrollLock();

/*
 * Any open modal holds the lock, whether or not its own code asks for it.
 *
 * Half the modals took a lock and half did not: Pages & categories, the
 * checking modal, the confirm dialog, triage and the rest built their own
 * overlay and left the page under it scrollable by its scrollbar, so the list
 * moved behind a dialog that was meant to have the reader's attention. One
 * watcher here covers every one of them, and any modal added later, instead of
 * a call at each open and close that the next modal would forget.
 *
 * What counts as open: a visible element marked aria-modal="true", a native
 * <dialog> opened with showModal(), or a blocking overlay that marks itself
 * data-scroll-lock. Visible means laid out and not visibility:hidden -- the
 * shared #app-modal host stays in the DOM, hidden, between uses.
 *
 * It holds one token of its own, so the components that already acquire and
 * release keep working unchanged: the page unlocks when both are done.
 */
(function watchOpenModals() {
    const SELECTOR = '[aria-modal="true"], dialog[open], [data-scroll-lock]';
    const TOKEN = 'open-modal';
    let held = false;
    let queued = false;

    const isOpen = (el) => {
        if (el.matches('dialog') && !el.matches(':modal')) return false;
        if (!el.getClientRects().length) return false;
        return getComputedStyle(el).visibility !== 'hidden';
    };

    const sync = () => {
        queued = false;
        const open = [...document.querySelectorAll(SELECTOR)].some(isOpen);
        if (open && !held) {
            window.ScrollLock.acquire(TOKEN);
            held = true;
        } else if (!open && held) {
            window.ScrollLock.release(TOKEN);
            held = false;
        }
    };

    // Once per batch of mutations: a render can touch hundreds of nodes, and
    // the answer only matters once they have settled. A timer rather than
    // requestAnimationFrame, which does not run in a background tab -- a modal
    // opened there would have left the page unlocked until it was looked at.
    const schedule = () => {
        if (queued) return;
        queued = true;
        setTimeout(sync, 0);
    };

    const start = () => {
        new MutationObserver(schedule).observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'hidden', 'open', 'style', 'aria-hidden', 'aria-modal'],
        });
        // Transitions change visibility without a mutation at their end.
        document.addEventListener('transitionend', schedule, true);
        schedule();
    };

    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
}());
