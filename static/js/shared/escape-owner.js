/**
 * Who owns the Escape key.
 *
 * Every view binds a document-level Escape handler in the capture phase when it
 * opens -- before any menu inside it exists -- so the view always sees the key
 * first. Each one then has to decide whether the key was really meant for
 * something layered on top, and each did that with its own hand-written list:
 * '#bookmark-context-menu, .move-popover' in the inbox, '.health-view-menu' in
 * health, an if-chain in config. A menu added later is on nobody's list, so the
 * view eats the key that belonged to it. That has been four bugs: the setting
 * promo, the row context menu, the config view, and the snooze picker.
 *
 * This inverts it. Anything that can be on top says so once, here, and a view
 * asks a single question instead of naming what the answer might be.
 *
 * Two roles, because the views already distinguish them and the distinction is
 * real:
 *
 *   owner    Opened deliberately, so Escape means "close this". It handles the
 *            key and the view never sees it. A context menu, a picker.
 *   ambient  Appeared on its own, so Escape was never aimed at it. It is
 *            dismissed by the press but does not keep it -- the same press goes
 *            on to do what the reader meant. A promo.
 *
 * Owners are asked in registration order, so register the innermost thing
 * first if two can be open at once.
 *
 * Deliberately asked rather than left to the event: which capture listener runs
 * first depends on which module bound its handler first, and that is the kind
 * of ordering that breaks the next time someone adds one. config-bookmarks
 * already made this argument in a comment; this is that argument as code.
 */
(function initEscapeOwner(global) {
    'use strict';

    /** @type {Array<{ name: string, isOpen: () => boolean, handleEscape?: () => void }>} */
    const owners = [];
    /** @type {Array<{ name: string, isOpen?: () => boolean, dismiss: () => void }>} */
    const ambient = [];

    function safe(fn, fallback) {
        try {
            return fn();
        } catch {
            // A layer that throws while being asked must not take the key with
            // it: the view still has to be closable.
            return fallback;
        }
    }

    /**
     * @param {string} name
     * @param {{ isOpen: () => boolean, handleEscape?: () => void }} spec
     */
    function registerOwner(name, spec) {
        if (!name || typeof spec?.isOpen !== 'function') return;
        const idx = owners.findIndex((o) => o.name === name);
        const entry = { name, isOpen: spec.isOpen, handleEscape: spec.handleEscape };
        if (idx >= 0) owners[idx] = entry;
        else owners.push(entry);
    }

    /**
     * @param {string} name
     * @param {{ dismiss: () => void, isOpen?: () => boolean }} spec
     */
    function registerAmbient(name, spec) {
        if (!name || typeof spec?.dismiss !== 'function') return;
        const idx = ambient.findIndex((a) => a.name === name);
        const entry = { name, dismiss: spec.dismiss, isOpen: spec.isOpen };
        if (idx >= 0) ambient[idx] = entry;
        else ambient.push(entry);
    }

    /** The first registered owner that is currently on screen, or null. */
    function current() {
        return owners.find((o) => safe(() => Boolean(o.isOpen()), false)) || null;
    }

    /**
     * Let whatever is layered on top take this Escape.
     *
     * @param {KeyboardEvent} [event] Consumed when an owner takes the key.
     * @returns {boolean} true when the caller should stop here.
     */
    function handle(event) {
        const owner = current();
        if (!owner) return false;
        if (event) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
        if (owner.handleEscape) safe(owner.handleEscape, undefined);
        return true;
    }

    /** Clear anything ambient. Never consumes the key. */
    function dismissAmbient() {
        ambient.forEach((a) => {
            if (a.isOpen && !safe(() => Boolean(a.isOpen()), false)) return;
            safe(a.dismiss, undefined);
        });
    }

    global.EscapeOwner = {
        registerOwner,
        registerAmbient,
        current,
        handle,
        dismissAmbient,
        /** @internal tests */
        _owners: owners,
        _ambient: ambient,
    };
}(typeof window !== 'undefined' ? window : globalThis));
