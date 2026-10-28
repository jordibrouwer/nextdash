/**
 * The checkup's steps.
 *
 * Pure: the Health report's issues, the empty places and the widgets that are
 * not fine go in, an ordered list of steps comes out, and a step with nothing
 * in it is left out. The four bookmark steps are the Health view's own
 * filters, by their own names; the structure and widget steps have no view
 * of theirs and the checkup lists them itself.
 */
(function (global) {
    'use strict';

    const BOOKMARK_STEPS = ['broken', 'duplicate', 'unused', 'stale'];

    function buildSteps({ issues = [], structure = [], widgets = [] } = {}) {
        const steps = BOOKMARK_STEPS.map((id) => ({
            id,
            count: (issues || []).filter((issue) => Array.isArray(issue?.flags) && issue.flags.includes(id)).length,
            healthFilter: id,
        }));
        steps.push({ id: 'structure', count: (structure || []).length });
        steps.push({ id: 'widgets', count: (widgets || []).filter((w) => w && w.state !== 'ok').length });
        return steps.filter((step) => step.count > 0);
    }

    global.CheckupModel = { buildSteps };
})(typeof window !== 'undefined' ? window : globalThis);
