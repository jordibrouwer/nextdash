/*
 * The pane of every view is filled like a column of the dashboard.
 *
 * A column's fill is decided by the theme: the Surface setting, the material,
 * and for the newer families a rule of their own. A view's pane (Bookmarks,
 * Inbox, Containers, Glances, Tags, Config) is a different element that those
 * rules never reach, so each theme had to be taught the view as well and most
 * of them were not: the pane came out thinner or thicker than the column next
 * to it.
 *
 * Rather than copy the rules, ask the page. A hidden column is put in the
 * layout, its computed background-color is read, and that colour is written to
 * --view-pane-fill on <body>; theme-group-views.css paints the panes with it.
 * Whatever a theme gives a column, the pane gets, with the same opacity.
 *
 * It runs again whenever something that can change a column's fill changes: an
 * attribute of <html> or <body> (theme, surface, material, effects, the
 * weather of Skywatch) or the layout being drawn.
 */
(function () {
    'use strict';

    const VAR = '--view-pane-fill';
    let pending = 0;
    let last = null;

    function read() {
        const layout = document.getElementById('dashboard-layout');
        if (!layout || !document.body) return null;
        const grid = document.createElement('div');
        grid.className = 'dashboard-grid layout-default';
        grid.hidden = true;
        grid.setAttribute('aria-hidden', 'true');
        const category = document.createElement('div');
        category.className = 'category';
        grid.appendChild(category);
        layout.appendChild(grid);
        let colour = null;
        try {
            colour = getComputedStyle(category).backgroundColor;
        } finally {
            grid.remove();
        }
        return colour;
    }

    function apply() {
        pending = 0;
        const colour = read();
        if (colour === null || colour === last) return;
        last = colour;
        document.body.style.setProperty(VAR, colour);
    }

    function schedule() {
        if (pending) return;
        pending = requestAnimationFrame(apply);
    }

    function start() {
        const watch = { attributes: true };
        new MutationObserver(schedule).observe(document.documentElement, watch);
        new MutationObserver(schedule).observe(document.body, watch);
        // Our own write is an attribute change of <body> (style); apply() ends
        // there because the colour is the one it already holds.
        window.addEventListener('hashchange', schedule);
        window.addEventListener('load', schedule);
        schedule();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();

    window.ViewPaneFill = { refresh: apply };
})();
