/**
 * Removes skeleton placeholders and the body.loading state after page data is ready.
 */
(function (global) {
    function finish() {
        if (document.body) {
            document.body.classList.remove('loading');
        }
        document.querySelectorAll('[data-skeleton-root]').forEach((el) => el.remove());
        const layout = document.getElementById('dashboard-layout');
        if (layout) {
            layout.removeAttribute('aria-busy');
        }
        const configMain = document.getElementById('config-main');
        if (configMain) {
            configMain.removeAttribute('aria-busy');
        }
    }

    global.SkeletonLoading = { finish };
})(typeof window !== 'undefined' ? window : globalThis);
