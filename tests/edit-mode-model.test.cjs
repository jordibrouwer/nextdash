'use strict';

/**
 * What the keys mean in and around edit mode, without a browser.
 *
 * Run with: node tests/edit-mode-model.test.cjs
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

global.window = {};
new Function(fs.readFileSync(path.join(__dirname, '..', 'static', 'js', 'dashboard', 'edit-mode-model.js'), 'utf8'))();
const { editKey, esc } = window.EditModeModel;

// Shift + M: a selected row keeps editing the bookmark; no row enters the mode; inside the mode it leaves.
assert.strictEqual(editKey({ active: false, rowSelected: true }), 'row-action');
assert.strictEqual(editKey({ active: false, rowSelected: false }), 'enter');
assert.strictEqual(editKey({ active: true, rowSelected: false }), 'leave');
assert.strictEqual(editKey({ active: true, rowSelected: true }), 'leave', 'a stale row selection does not keep the mode on');

// Escape goes from the inside out.
assert.strictEqual(esc({ dialogOpen: true, panelFieldFocused: true, dirtyWidgetDraft: true }), 'let-dialog-close');
assert.strictEqual(esc({ dialogOpen: false, panelFieldFocused: true, dirtyWidgetDraft: true }), 'focus-grid');
assert.strictEqual(esc({ dialogOpen: false, panelFieldFocused: false, dirtyWidgetDraft: true }), 'confirm-discard');
assert.strictEqual(esc({ dialogOpen: false, panelFieldFocused: false, dirtyWidgetDraft: false }), 'leave');

// Missing fields read as false.
assert.strictEqual(esc({}), 'leave');
assert.strictEqual(editKey({}), 'enter');

console.log('edit-mode-model: ok');
