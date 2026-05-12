/**
 * DragReorder - A simple drag-and-drop reordering system using native HTML5 API
 * 
 * Usage:
 * const reorder = new DragReorder({
 *   container: '#my-list',           // Container selector
 *   itemSelector: '.my-item',        // Item selector (optional, defaults to children)
 *   handleSelector: '.drag-handle',  // Drag handle selector (optional, makes entire item draggable if not provided)
 *   onReorder: (newOrder) => {       // Callback when order changes
 *     console.log('New order:', newOrder);
 *   }
 * });
 */

class DragReorder {
    constructor(options = {}) {
        this.container = typeof options.container === 'string' 
            ? document.querySelector(options.container) 
            : options.container;
        
        if (!this.container) {
            console.error('DragReorder: Container not found');
            return;
        }

        this.itemSelector = options.itemSelector || null;
        this.handleSelector = options.handleSelector || null;
        this.delegateItemDragOver = Boolean(options.delegateItemDragOver);
        this.onReorder = options.onReorder || null;
        this.longPressMs = Number.isFinite(Number(options.longPressMs)) ? Math.max(0, Number(options.longPressMs)) : 0;
        this.itemClass = 'reorder-item';
        this.selected = null;
        this.dragStartMeta = null;
        /* 'ontouchstart' in window is true on many desktop Chromes → wrong branch, no HTML5 drag. */
        this.useCoarsePointerDrag = (() => {
            try {
                return typeof navigator !== 'undefined'
                    && Number(navigator.maxTouchPoints) > 0
                    && typeof window.matchMedia === 'function'
                    && window.matchMedia('(pointer: coarse)').matches;
            } catch {
                return false;
            }
        })();
        this.placeholder = null;
        this.mouseDownAt = new WeakMap();
        this.touchPressTimer = null;
        this.touchDragActive = false;
        this.touchStartPoint = null;
        this.touchSourceElement = null;
        
        // Bind handlers
        this.touchStartHandler = (e) => this.touchStart(e);
        this.touchMoveHandler = (e) => this.touchMove(e);
        this.touchEndHandler = (e) => this.touchEnd(e);
        this.touchCancelHandler = () => this.cancelTouchPress();
        this.mouseDownHandler = (e) => this.mouseDown(e);
        this.mouseUpHandler = (e) => this.mouseUp(e);
        this.preventDrop = (e) => e.preventDefault();
        this.containerDragOverHandler = (e) => this.dragOverContainer(e);
        
        this.init();
    }

    init() {
        // Add reorder-container class to container
        this.container.classList.add('reorder-container');
        if (!window.__dragReorderState) {
            window.__dragReorderState = { selected: null };
        }
        if (!window.__dragReorderState.placeholder) {
            window.__dragReorderState.placeholder = null;
        }
        
        // Initialize items
        this.refreshItems();
    }

    refreshItems() {
        // Add item class and idle class, make handles draggable or add touch listeners
        this.getAllItems().forEach(item => {
            if (!item.classList.contains(this.itemClass)) {
                item.classList.add(this.itemClass);
            }
            if (!item.classList.contains('is-idle')) {
                item.classList.add('is-idle');
            }
            const element = this.handleSelector ? item.querySelector(this.handleSelector) : item;
            if (element) {
                if (this.useCoarsePointerDrag) {
                    element.addEventListener('touchstart', this.touchStartHandler, { passive: false });
                    element.addEventListener('touchmove', this.touchMoveHandler, { passive: false });
                    element.addEventListener('touchend', this.touchEndHandler);
                    element.addEventListener('touchcancel', this.touchCancelHandler);
                }
                if (!this.useCoarsePointerDrag) {
                    element.draggable = true;
                    element.ondragstart = (e) => this.dragStart(e);
                    element.ondragend = (e) => this.dragEnd(e);
                    element.addEventListener('mousedown', this.mouseDownHandler);
                    element.addEventListener('mouseup', this.mouseUpHandler);
                    element.addEventListener('mouseleave', this.mouseUpHandler);
                }
            }
            // Add dragover on each item for mouse drag (skipped when dashboard uses document relay for cross-column)
            if (!this.useCoarsePointerDrag && !this.delegateItemDragOver) {
                item.ondragover = (e) => this.dragOver(e);
            }
        });

        if (!this.useCoarsePointerDrag) {
            this.container.ondragover = this.containerDragOverHandler;
        }
    }

    dragStart(e) {
        if (this.longPressMs > 0) {
            const sourceEl = e.currentTarget || e.target;
            const pressStartedAt = this.mouseDownAt.get(sourceEl) || 0;
            if (!pressStartedAt || (Date.now() - pressStartedAt) < this.longPressMs) {
                e.preventDefault();
                return;
            }
        }
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', '');
        const fromHandle = e.currentTarget && e.currentTarget.closest
            ? e.currentTarget.closest(`.${this.itemClass}`)
            : null;
        this.selected = fromHandle || (e.target && e.target.closest ? e.target.closest(`.${this.itemClass}`) : null);
        if (!this.selected) {
            e.preventDefault();
            return;
        }
        this.dragStartMeta = this.getItemMeta(this.selected);
        window.__dragReorderState.selected = this.selected;
        this.removeAllPlaceholders();
        this.selected.classList.remove('is-idle');
        this.selected.classList.add('is-draggable');
        
        // Prevent scrolling on touch devices
        this.disablePageScroll();
        
        // Prevent dropping anywhere else
        document.addEventListener('dragover', this.preventDrop, { passive: false });
    }

    dragOver(e) {
        e.preventDefault();
        const activeSelected = this.getSelectedItem();
        if (!activeSelected) return;

        const targetItem = e.target.closest(`.${this.itemClass}`);
        if (!targetItem || targetItem === activeSelected) return;

        this.ensurePlaceholder();
        targetItem.parentNode.insertBefore(this.placeholder, targetItem);

        if (this.isBefore(activeSelected, targetItem)) {
            targetItem.parentNode.insertBefore(activeSelected, targetItem);
        } else {
            targetItem.parentNode.insertBefore(activeSelected, targetItem.nextSibling);
        }
    }

    dragOverContainer(e) {
        const activeSelected = this.getSelectedItem();
        if (!activeSelected) return;

        const targetItem = e.target.closest(`.${this.itemClass}`);
        if (targetItem) {
            return;
        }

        e.preventDefault();
        if (activeSelected.parentNode !== this.container) {
            this.container.appendChild(activeSelected);
        }
        this.ensurePlaceholder();
        this.container.appendChild(this.placeholder);
    }

    dragEnd() {
        const activeSelected = this.getSelectedItem();
        if (!activeSelected) {
            return;
        }

        activeSelected.classList.remove('is-draggable');
        activeSelected.classList.add('is-idle');
        activeSelected.classList.add('bookmark-move-in');
        requestAnimationFrame(() => {
            setTimeout(() => activeSelected.classList.remove('bookmark-move-in'), 180);
        });
        this.removeAllPlaceholders();
        this.enablePageScroll();
        document.removeEventListener('dragover', this.preventDrop);
        const reorderDetails = {
            from: this.dragStartMeta || this.getItemMeta(activeSelected),
            to: this.getItemMeta(activeSelected)
        };
        this.selected = null;
        window.__dragReorderState.selected = null;
        this.dragStartMeta = null;
        // Call the onReorder callback with the new order
        if (this.onReorder && typeof this.onReorder === 'function') {
            this.onReorder(this.getNewOrder(), reorderDetails);
        }
    }

    mouseDown(e) {
        const sourceEl = e.currentTarget || e.target;
        if (sourceEl) {
            this.mouseDownAt.set(sourceEl, Date.now());
        }
    }

    mouseUp(e) {
        const sourceEl = e.currentTarget || e.target;
        if (sourceEl && this.mouseDownAt.has(sourceEl)) {
            this.mouseDownAt.delete(sourceEl);
        }
    }

    startTouchDrag() {
        this.selected = this.touchSourceElement ? this.touchSourceElement.closest(`.${this.itemClass}`) : null;
        if (!this.selected) {
            this.touchDragActive = false;
            return;
        }
        this.dragStartMeta = this.getItemMeta(this.selected);
        window.__dragReorderState.selected = this.selected;
        this.removeAllPlaceholders();
        this.selected.classList.remove('is-idle');
        this.selected.classList.add('is-draggable');
        this.disablePageScroll();
        this.touchDragActive = true;
    }

    cancelTouchPress() {
        if (this.touchPressTimer) {
            clearTimeout(this.touchPressTimer);
            this.touchPressTimer = null;
        }
        this.touchSourceElement = null;
        this.touchStartPoint = null;
    }

    touchStart(e) {
        const touch = e.touches && e.touches[0] ? e.touches[0] : null;
        this.touchSourceElement = e.currentTarget || e.target;
        this.touchStartPoint = touch ? { x: touch.clientX, y: touch.clientY } : null;
        this.touchDragActive = false;
        this.cancelTouchPress();
        this.touchSourceElement = e.currentTarget || e.target;
        this.touchStartPoint = touch ? { x: touch.clientX, y: touch.clientY } : null;
        if (this.longPressMs > 0) {
            this.touchPressTimer = setTimeout(() => {
                this.touchPressTimer = null;
                this.startTouchDrag();
            }, this.longPressMs);
            return;
        }
        this.startTouchDrag();
    }
    touchMove(e) {
        if (!this.touchDragActive) {
            const touch = e.touches && e.touches[0] ? e.touches[0] : null;
            if (touch && this.touchStartPoint) {
                const dx = Math.abs(touch.clientX - this.touchStartPoint.x);
                const dy = Math.abs(touch.clientY - this.touchStartPoint.y);
                if (dx > 8 || dy > 8) {
                    this.cancelTouchPress();
                }
            }
            return;
        }
        e.preventDefault();
        const activeSelected = this.getSelectedItem();
        if (!activeSelected) return;
        const touch = e.touches[0];
        const pointElement = document.elementFromPoint(touch.clientX, touch.clientY);
        const targetItem = pointElement ? pointElement.closest(`.${this.itemClass}`) : null;
        const targetContainer = pointElement ? pointElement.closest('.bookmarks-list[data-category-id]') : null;

        if (targetItem && targetItem !== activeSelected) {
            this.ensurePlaceholder();
            targetItem.parentNode.insertBefore(this.placeholder, targetItem);
            if (this.isBefore(activeSelected, targetItem)) {
                targetItem.parentNode.insertBefore(activeSelected, targetItem);
            } else {
                targetItem.parentNode.insertBefore(activeSelected, targetItem.nextSibling);
            }
        } else if (targetContainer) {
            if (targetContainer !== activeSelected.parentNode) {
                targetContainer.appendChild(activeSelected);
            }
            this.ensurePlaceholder();
            targetContainer.appendChild(this.placeholder);
        }
    }

    touchEnd(e) {
        if (!this.touchDragActive) {
            this.cancelTouchPress();
            return;
        }
        const activeSelected = this.getSelectedItem();
        if (!activeSelected) {
            this.cancelTouchPress();
            return;
        }

        activeSelected.classList.remove('is-draggable');
        activeSelected.classList.add('is-idle');
        activeSelected.classList.add('bookmark-move-in');
        requestAnimationFrame(() => {
            setTimeout(() => activeSelected.classList.remove('bookmark-move-in'), 180);
        });
        this.removeAllPlaceholders();
        this.enablePageScroll();
        const reorderDetails = {
            from: this.dragStartMeta || this.getItemMeta(activeSelected),
            to: this.getItemMeta(activeSelected)
        };
        this.selected = null;
        window.__dragReorderState.selected = null;
        this.dragStartMeta = null;
        this.touchDragActive = false;
        this.cancelTouchPress();
        // Call the onReorder callback with the new order
        if (this.onReorder && typeof this.onReorder === 'function') {
            this.onReorder(this.getNewOrder(), reorderDetails);
        }
    }

    isBefore(el1, el2) {
        let cur;
        if (el2.parentNode === el1.parentNode) {
            for (cur = el1.previousSibling; cur; cur = cur.previousSibling) {
                if (cur === el2) return true;
            }
        }
        return false;
    }

    disablePageScroll() {
        document.body.style.overflow = 'hidden';
        document.body.style.touchAction = 'none';
        document.body.style.userSelect = 'none';
    }

    enablePageScroll() {
        document.body.style.overflow = '';
        document.body.style.touchAction = '';
        document.body.style.userSelect = '';
    }

    getAllItems() {
        if (this.itemSelector) {
            return Array.from(this.container.querySelectorAll(this.itemSelector));
        }
        return Array.from(this.container.children);
    }

    getSelectedItem() {
        if (this.selected) {
            return this.selected;
        }
        if (window.__dragReorderState && window.__dragReorderState.selected) {
            return window.__dragReorderState.selected;
        }
        return null;
    }

    getItemMeta(item) {
        if (!item) {
            return { categoryId: '', index: -1 };
        }
        const parent = item.closest('.bookmarks-list[data-category-id]');
        const categoryId = parent ? (parent.getAttribute('data-category-id') || '') : '';
        const siblings = parent ? Array.from(parent.querySelectorAll(`.${this.itemClass}`)) : [];
        return {
            categoryId,
            index: siblings.indexOf(item)
        };
    }

    getNewOrder() {
        const items = this.getAllItems();
        return items.map((item, index) => ({
            element: item,
            index: index,
            dataIndex: item.getAttribute('data-index') || index
        }));
    }

    ensurePlaceholder() {
        if (!window.__dragReorderState.placeholder) {
            const placeholder = document.createElement('div');
            placeholder.className = 'bookmark-drop-placeholder';
            placeholder.setAttribute('aria-hidden', 'true');
            window.__dragReorderState.placeholder = placeholder;
        }
        this.placeholder = window.__dragReorderState.placeholder;
    }

    removePlaceholder() {
        const placeholder = window.__dragReorderState ? window.__dragReorderState.placeholder : null;
        if (placeholder && placeholder.parentNode) {
            placeholder.parentNode.removeChild(placeholder);
        }
    }

    removeAllPlaceholders() {
        document.querySelectorAll('.bookmark-drop-placeholder').forEach((node) => {
            if (node && node.parentNode) {
                node.parentNode.removeChild(node);
            }
        });
    }

    // Public method to destroy the instance
    destroy() {
        this.enablePageScroll();
        this.removeAllPlaceholders();
        this.container.classList.remove('reorder-container');
        
        // Remove classes and listeners from items
        this.getAllItems().forEach(item => {
            item.classList.remove(this.itemClass, 'is-idle', 'is-draggable');
            const element = this.handleSelector ? item.querySelector(this.handleSelector) : item;
            if (element) {
                if (this.useCoarsePointerDrag) {
                    element.removeEventListener('touchstart', this.touchStartHandler);
                    element.removeEventListener('touchmove', this.touchMoveHandler);
                    element.removeEventListener('touchend', this.touchEndHandler);
                    element.removeEventListener('touchcancel', this.touchCancelHandler);
                }
                if (!this.useCoarsePointerDrag) {
                    element.draggable = false;
                    element.ondragstart = null;
                    element.ondragend = null;
                    element.removeEventListener('mousedown', this.mouseDownHandler);
                    element.removeEventListener('mouseup', this.mouseUpHandler);
                    element.removeEventListener('mouseleave', this.mouseUpHandler);
                }
            }
            if (!this.useCoarsePointerDrag && !this.delegateItemDragOver) {
                item.ondragover = null;
            }
        });

        if (!this.useCoarsePointerDrag) {
            this.container.ondragover = null;
        }
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DragReorder;
}
