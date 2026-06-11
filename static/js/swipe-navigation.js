// Swipe Navigation for Page Switching
class SwipeNavigation {
    constructor(dashboard) {
        this.dashboard = dashboard;
        this.touchStartX = 0;
        this.touchEndX = 0;
        this.touchStartY = 0;
        this.touchEndY = 0;
        this.touchMoveX = 0;
        this.touchMoveY = 0;
        this.minSwipeDistance = 40; // Reduced minimum distance for easier detection
        this.swipeVelocityThreshold = 0.3; // Velocity threshold for quick swipes
        this.isSwiping = false;
        this.swipeStartTime = 0;
        this.navigationLockUntil = 0;
        this._pointerDownHandler = null;
        this._pointerMoveHandler = null;
        this._pointerUpHandler = null;
        this._touchStartHandler = null;
        this._touchMoveHandler = null;
        this._touchEndHandler = null;
        this._usesPointerEvents = false;

        this.init();
    }

    init() {
        // Pointer events cover touch on modern browsers; registering both touch and pointer
        // would fire handleSwipe twice for the same gesture.
        if (window.PointerEvent) {
            this._usesPointerEvents = true;
            this._pointerDownHandler = (e) => {
                if (e.pointerType !== 'touch') return;
                this.handleTouchStart({ changedTouches: [{ clientX: e.clientX, clientY: e.clientY }] });
            };
            this._pointerMoveHandler = (e) => {
                if (e.pointerType !== 'touch') return;
                this.handleTouchMove({ changedTouches: [{ clientX: e.clientX, clientY: e.clientY }] });
            };
            this._pointerUpHandler = (e) => {
                if (e.pointerType !== 'touch') return;
                this.handleTouchEnd({ changedTouches: [{ clientX: e.clientX, clientY: e.clientY }] });
            };
            document.body.addEventListener('pointerdown', this._pointerDownHandler, { passive: true });
            document.body.addEventListener('pointermove', this._pointerMoveHandler, { passive: true });
            document.body.addEventListener('pointerup', this._pointerUpHandler, { passive: true });
        } else {
            this._touchStartHandler = (e) => this.handleTouchStart(e);
            this._touchMoveHandler = (e) => this.handleTouchMove(e);
            this._touchEndHandler = (e) => this.handleTouchEnd(e);
            document.body.addEventListener('touchstart', this._touchStartHandler, { passive: true });
            document.body.addEventListener('touchmove', this._touchMoveHandler, { passive: true });
            document.body.addEventListener('touchend', this._touchEndHandler, { passive: true });
        }

        // Intentionally do NOT add mouse event listeners so swipe navigation won't work with the cursor.
    }

    cleanup() {
        if (this._usesPointerEvents) {
            if (this._pointerDownHandler) {
                document.body.removeEventListener('pointerdown', this._pointerDownHandler);
            }
            if (this._pointerMoveHandler) {
                document.body.removeEventListener('pointermove', this._pointerMoveHandler);
            }
            if (this._pointerUpHandler) {
                document.body.removeEventListener('pointerup', this._pointerUpHandler);
            }
        } else {
            if (this._touchStartHandler) {
                document.body.removeEventListener('touchstart', this._touchStartHandler);
            }
            if (this._touchMoveHandler) {
                document.body.removeEventListener('touchmove', this._touchMoveHandler);
            }
            if (this._touchEndHandler) {
                document.body.removeEventListener('touchend', this._touchEndHandler);
            }
        }
        this._pointerDownHandler = null;
        this._pointerMoveHandler = null;
        this._pointerUpHandler = null;
        this._touchStartHandler = null;
        this._touchMoveHandler = null;
        this._touchEndHandler = null;
    }

    handleTouchStart(e) {
        this.touchStartX = e.changedTouches[0].clientX;
        this.touchStartY = e.changedTouches[0].clientY;
        this.touchMoveX = this.touchStartX;
        this.touchMoveY = this.touchStartY;
        this.isSwiping = null; // null = not determined, true = horizontal, false = vertical
        this.swipeStartTime = Date.now();
    }

    handleTouchMove(e) {
        if (this.isSwiping === false) return; // Already determined to be vertical scroll

        this.touchMoveX = e.changedTouches[0].clientX;
        this.touchMoveY = e.changedTouches[0].clientY;

        const diffX = Math.abs(this.touchMoveX - this.touchStartX);
        const diffY = Math.abs(this.touchMoveY - this.touchStartY);

        // Determine swipe direction on first significant movement
        if (this.isSwiping === null && (diffX > 10 || diffY > 10)) {
            // If horizontal movement is greater, it's a swipe
            // If vertical movement is greater, it's a scroll
            this.isSwiping = diffX > diffY;
        }
    }

    handleTouchEnd(e) {
        // Only process if this was determined to be a horizontal swipe
        if (this.isSwiping !== true) {
            return;
        }

        this.touchEndX = e.changedTouches[0].clientX;
        this.touchEndY = e.changedTouches[0].clientY;
        this.handleSwipe();
    }

    handleMouseDown(e) {
        // Only track mouse events if not clicking on buttons or links
        if (e.target.tagName === 'A' || e.target.tagName === 'BUTTON' || e.target.closest('a') || e.target.closest('button')) {
            return;
        }

        this.touchStartX = e.clientX;
        this.touchStartY = e.clientY;
        this.touchMoveX = this.touchStartX;
        this.touchMoveY = this.touchStartY;
        this.isSwiping = null;
        this.isMouseDown = true;
        this.swipeStartTime = Date.now();
    }

    handleMouseMove(e) {
        if (!this.isMouseDown) return;
        if (this.isSwiping === false) return;

        this.touchMoveX = e.clientX;
        this.touchMoveY = e.clientY;

        const diffX = Math.abs(this.touchMoveX - this.touchStartX);
        const diffY = Math.abs(this.touchMoveY - this.touchStartY);

        // Determine swipe direction on first significant movement
        if (this.isSwiping === null && (diffX > 10 || diffY > 10)) {
            this.isSwiping = diffX > diffY;
        }
    }

    handleMouseUp(e) {
        if (!this.isMouseDown) return;

        this.isMouseDown = false;

        // Only process if this was determined to be a horizontal swipe
        if (this.isSwiping !== true) {
            return;
        }

        this.touchEndX = e.clientX;
        this.touchEndY = e.clientY;
        this.handleSwipe();
    }

    shouldBlockSwipeNavigation() {
        const dashboard = this.dashboard;
        if (!dashboard) {
            return true;
        }
        if (document.body.classList.contains('bookmark-inline-edit-active')) {
            return true;
        }
        if (typeof dashboard.isInlineEditActive === 'function' && dashboard.isInlineEditActive()) {
            return true;
        }
        if (document.querySelector('.modal-overlay.show')) {
            return true;
        }
        if (window.DashboardTagCloud?.modalOpen) {
            return true;
        }
        if (dashboard.searchComponent?.isActive?.()) {
            return true;
        }
        return false;
    }

    handleSwipe() {
        if (Date.now() < this.navigationLockUntil) {
            return;
        }

        if (this.shouldBlockSwipeNavigation()) {
            return;
        }

        const horizontalDistance = this.touchEndX - this.touchStartX;
        const swipeTime = Date.now() - this.swipeStartTime;
        const velocity = Math.abs(horizontalDistance) / swipeTime; // pixels per millisecond

        // Accept swipe if:
        // 1. Distance is greater than minimum, OR
        // 2. Velocity is high enough (quick swipe)
        const distanceOk = Math.abs(horizontalDistance) >= this.minSwipeDistance;
        const velocityOk = velocity >= this.swipeVelocityThreshold;

        if (!distanceOk && !velocityOk) {
            return;
        }

        this.navigationLockUntil = Date.now() + 400;

        // Determine swipe direction and navigate
        if (horizontalDistance > 0) {
            void this.navigateToPreviousPage();
        } else {
            void this.navigateToNextPage();
        }
    }

    async navigateToNextPage() {
        const pages = this.dashboard.pages;
        const currentIndex = pages.findIndex(p => p.id === this.dashboard.currentPageId);

        if (currentIndex === -1 || currentIndex === pages.length - 1) {
            // Already at last page, wrap to first
            if (pages.length > 0) {
                await this.switchToPage(pages[0]);
            }
        } else {
            await this.switchToPage(pages[currentIndex + 1]);
        }
    }

    async navigateToPreviousPage() {
        const pages = this.dashboard.pages;
        const currentIndex = pages.findIndex(p => p.id === this.dashboard.currentPageId);

        if (currentIndex === -1 || currentIndex === 0) {
            // Already at first page, wrap to last
            if (pages.length > 0) {
                await this.switchToPage(pages[pages.length - 1]);
            }
        } else {
            await this.switchToPage(pages[currentIndex - 1]);
        }
    }

    async switchToPage(page) {
        if (!page) return;

        const switched = await this.dashboard.requestPageNavigation(page.id);
        if (!switched) {
            return;
        }

        window.scrollTo(0, 0);

        if (typeof this.dashboard.setActivePageNavButton === 'function') {
            this.dashboard.setActivePageNavButton(page.id);
        }
    }
}

// Export for use in dashboard.js
window.SwipeNavigation = SwipeNavigation;
