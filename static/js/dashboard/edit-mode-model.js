/**
 * What the keys mean in and around edit mode.
 *
 * Pure, so the rule that matters most -- Shift + M still moves a selected
 * bookmark, and only without one does it switch the mode -- is a function that
 * can be tested without a browser.
 */
(function (global) {
    'use strict';

    /** 'row-action' (as before), 'enter' the mode, or 'leave' it. */
    function editKey({ active = false, rowSelected = false } = {}) {
        if (active) return 'leave';
        return rowSelected ? 'row-action' : 'enter';
    }

    /**
     * Escape goes from the inside out: a dialog closes first, then a field in
     * the panel gives the focus back to the grid, then an unsaved widget draft
     * is asked about, and only then does the mode end.
     */
    function esc({ dialogOpen = false, panelFieldFocused = false, dirtyWidgetDraft = false } = {}) {
        if (dialogOpen) return 'let-dialog-close';
        if (panelFieldFocused) return 'focus-grid';
        if (dirtyWidgetDraft) return 'confirm-discard';
        return 'leave';
    }

    global.EditModeModel = { editKey, esc };
})(typeof window !== 'undefined' ? window : globalThis);
