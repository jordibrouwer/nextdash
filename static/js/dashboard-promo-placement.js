/**
 * Shared left/right promo placement beside an anchor rect.
 */
(function initDashboardPromoPlacement(global) {
    const VIEWPORT_PAD = 12;

    function positionBesideAnchor(anchorRect, initialWidth, height, options = {}) {
        const gap = options.gap ?? 12;
        const minWidth = options.minWidth ?? 160;
        const rightLimit = global.innerWidth - VIEWPORT_PAD;
        let width = initialWidth;
        let placeRight = true;
        let left = anchorRect.right + gap;

        const availableRight = rightLimit - left;
        if (availableRight < minWidth) {
            placeRight = false;
            width = Math.min(initialWidth, Math.max(minWidth, anchorRect.left - VIEWPORT_PAD - gap));
            left = anchorRect.left - gap - width;
            if (left < VIEWPORT_PAD) {
                left = VIEWPORT_PAD;
                width = Math.min(initialWidth, Math.max(minWidth, anchorRect.left - VIEWPORT_PAD - gap));
            }
        } else {
            width = Math.min(initialWidth, availableRight);
        }

        let top = anchorRect.top + (anchorRect.height / 2) - (height / 2);
        top = Math.max(VIEWPORT_PAD, Math.min(top, global.innerHeight - height - VIEWPORT_PAD));

        return { left, top, width, placeRight };
    }

    global.DashboardPromoPlacement = {
        VIEWPORT_PAD,
        positionBesideAnchor,
    };
}(window));
