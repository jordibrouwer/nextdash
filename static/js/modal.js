class Modal {
    constructor(language = null) {
        this.language = language;
        this._mouseDownTarget = null;
        this.focusTrapHandler = null;
        this.previouslyFocusedElement = null;
        this.activeModalClasses = [];
        this.previousModalStyles = null;
        this.createModalHTML();
        this.setupEventListeners();
    }

    createModalHTML() {
        if (document.getElementById('app-modal')) {
            return; // Modal already exists
        }

        const modalHTML = `
            <div id="app-modal" class="modal-overlay" role="presentation">
                <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
                    <div class="modal-header">
                        <span class="modal-title" id="modal-title"></span>
                    </div>
                    <div class="modal-body">
                        <div class="modal-text" id="modal-text"></div>
                    </div>
                    <div class="modal-actions" id="modal-actions">
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);
        this.modal = document.getElementById('app-modal');
        this.modalPanel = this.modal.querySelector('.modal');
        this.modal.setAttribute('aria-hidden', 'true');
    }

    setupEventListeners() {
        // Close modal when clicking outside
        this.modal.addEventListener('mousedown', (e) => {
            this._mouseDownTarget = e.target;
        });

        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal && this._mouseDownTarget === this.modal) {
                this.hide();
            }
        });

        // Close modal with Escape key and implement focus trap
        this.focusTrapHandler = (e) => {
            if (this.modal && this.modal.classList.contains('show')) {
                if (e.key === 'Escape') {
                    this.hide();
                    return;
                }
                if (e.key === 'Enter' && e.target && e.target.tagName === 'INPUT') {
                    e.preventDefault();
                    const confirmBtn = this.modal.querySelector('.modal-button.danger, .modal-button:first-child');
                    if (confirmBtn && confirmBtn !== e.target) confirmBtn.click();
                    return;
                }
                if (e.key === 'Tab') {
                    this.handleTabKey(e);
                }
            }
        };
        
        document.addEventListener('keydown', this.focusTrapHandler);
    }

    handleTabKey(e) {
        const focusableElements = this.modal.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        
        if (focusableElements.length === 0) return;
        
        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];
        const activeElement = document.activeElement;
        
        if (e.shiftKey) {
            // Shift+Tab
            if (activeElement === firstElement) {
                e.preventDefault();
                lastElement.focus();
            }
        } else {
            // Tab
            if (activeElement === lastElement) {
                e.preventDefault();
                firstElement.focus();
            }
        }
    }

    _t(key, fallback) {
        if (!this.language) return fallback;
        const val = this.language.t(key);
        return val !== key ? val : fallback;
    }

    show(options) {
        const {
            title = this._t('dashboard.confirmTitle', 'Confirm'),
            message = this._t('dashboard.confirmMessage', 'Are you sure?'),
            htmlMessage = null,
            confirmText = this._t('dashboard.confirmTitle', 'Confirm'),
            cancelText = this._t('dashboard.cancel', 'Cancel'),
            confirmClass = '',
            onConfirm = () => {},
            onCancel = () => {},
            showCancel = true,
            modalClass = '',
            modalMaxWidth = '',
            modalWidth = '',
            initialFocusSelector = null
        } = options;

        // Set content
        document.getElementById('modal-title').textContent = title;
        if (htmlMessage !== null) {
            document.getElementById('modal-text').innerHTML = htmlMessage;
        } else {
            document.getElementById('modal-text').textContent = message;
        }

        // Clear and set actions
        const actionsContainer = document.getElementById('modal-actions');
        actionsContainer.innerHTML = '';

        // Confirm button (styled like search matches)
        const confirmButton = document.createElement('button');
        confirmButton.className = `modal-button ${confirmClass}`;
        confirmButton.innerHTML = `
            <span class="modal-button-name">${confirmText}</span>
        `;
        confirmButton.onclick = () => {
            this.hide();
            onConfirm();
        };
        actionsContainer.appendChild(confirmButton);

        // Cancel button
        if (showCancel) {
            const cancelButton = document.createElement('button');
            cancelButton.className = 'modal-button';
            cancelButton.innerHTML = `
                <span class="modal-button-name">${cancelText}</span>
            `;
            cancelButton.onclick = () => {
                this.hide();
                onCancel();
            };
            actionsContainer.appendChild(cancelButton);
        }

        // Show modal
        if (this.activeModalClasses.length > 0) {
            this.modalPanel.classList.remove(...this.activeModalClasses);
        }
        this.activeModalClasses = modalClass ? modalClass.split(/\s+/).filter(Boolean) : [];
        if (this.activeModalClasses.length > 0) {
            this.modalPanel.classList.add(...this.activeModalClasses);
        }
        if (window.MobileExperience?.isMobileLayout?.()) {
            this.modalPanel.classList.add('modal--mobile-sheet');
        } else {
            this.modalPanel.classList.remove('modal--mobile-sheet');
        }

        this.previousModalStyles = {
            maxWidth: this.modalPanel.style.maxWidth,
            width: this.modalPanel.style.width
        };
        if (modalMaxWidth) {
            this.modalPanel.style.maxWidth = modalMaxWidth;
        }
        if (modalWidth) {
            this.modalPanel.style.width = modalWidth;
        }

        this.modal.classList.add('show');
        this.modal.setAttribute('aria-hidden', 'false');
        
        // Store the element that triggered the modal so we can return focus
        this.previouslyFocusedElement = document.activeElement;
        
        // Prevent body scroll
        this.previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        
        // Prevent scroll events
        this.preventScrollHandler = (e) => {
            if (e.target.closest('.modal')) return;
            e.preventDefault();
        };
        document.body.addEventListener('touchmove', this.preventScrollHandler, { passive: false });
        document.body.addEventListener('wheel', this.preventScrollHandler, { passive: false });
        
        // Focus initial element or confirm button for keyboard navigation
        setTimeout(() => {
            if (initialFocusSelector) {
                const initialEl = this.modal.querySelector(initialFocusSelector);
                if (initialEl && typeof initialEl.focus === 'function') {
                    initialEl.focus();
                    if (typeof initialEl.setSelectionRange === 'function' && typeof initialEl.value === 'string') {
                        const len = initialEl.value.length;
                        initialEl.setSelectionRange(len, len);
                    }
                    return;
                }
            }
            confirmButton.focus();
        }, 100);
    }

    hide() {
        if (this.modal) {
            this.modal.classList.remove('show');
            this.modal.setAttribute('aria-hidden', 'true');
            if (this.activeModalClasses.length > 0) {
                this.modalPanel.classList.remove(...this.activeModalClasses);
            }
            this.activeModalClasses = [];
            this.modalPanel.classList.remove('modal--mobile-sheet');

            if (this.previousModalStyles) {
                this.modalPanel.style.maxWidth = this.previousModalStyles.maxWidth;
                this.modalPanel.style.width = this.previousModalStyles.width;
                this.previousModalStyles = null;
            }
        }
        // Restore body scroll
        document.body.style.overflow = this.previousOverflow || '';
        
        // Remove scroll prevention
        if (this.preventScrollHandler) {
            document.body.removeEventListener('touchmove', this.preventScrollHandler);
            document.body.removeEventListener('wheel', this.preventScrollHandler);
        }
        
        // Return focus to the element that triggered the modal
        if (this.previouslyFocusedElement && typeof this.previouslyFocusedElement.focus === 'function') {
            setTimeout(() => {
                this.previouslyFocusedElement.focus();
            }, 0);
        }
    }

    // Convenience methods for common modal types
    confirm(options) {
        return new Promise((resolve) => {
            this.show({
                ...options,
                onConfirm: () => resolve(true),
                onCancel: () => resolve(false)
            });
        });
    }

    alert(options) {
        return new Promise((resolve) => {
            this.show({
                ...options,
                showCancel: false,
                confirmText: options.confirmText || this._t('dashboard.ok', 'OK'),
                onConfirm: () => resolve(true)
            });
        });
    }

    danger(options) {
        return this.confirm({
            ...options,
            confirmClass: 'danger'
        });
    }

    // Method to update language after initialization
    setLanguage(language) {
        this.language = language;
    }
}

// Create global modal instance
window.AppModal = new Modal();