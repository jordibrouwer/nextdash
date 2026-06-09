/**
 * Categories Module
 * Handles category management (create, render, remove, reorder)
 */

class ConfigCategories {
    constructor(t) {
        this.t = t; // Translation function
        this.categoryReorder = null;
    }

    /**
     * Render categories list
     * @param {Array} categories
     * @param {Function} generateId - Function to generate ID from name
     */
    render(categories, generateId) {
        const container = document.getElementById('categories-list');
        if (!container) return;

        container.innerHTML = '';

        // Ensure categories is an array
        if (!Array.isArray(categories)) {
            categories = [];
        }

        categories.forEach((category, index) => {
            const categoryElement = this.createCategoryElement(category, index, categories, generateId);
            container.appendChild(categoryElement);
        });
    }

    /**
     * Create a category DOM element
     * @param {Object} category
     * @param {number} index
     * @param {Array} categories - Reference to categories array
     * @param {Function} generateId
     * @returns {HTMLElement}
     */
    createCategoryElement(category, index, categories, generateId) {
        const div = document.createElement('div');
        div.className = 'category-item js-item is-idle';
        div.setAttribute('data-category-index', index);
        div.setAttribute('data-category-id', category.id); // Store the actual category ID
        
        // Store the original ID if not already set (for tracking renames)
        if (!category.originalId) {
            category.originalId = category.id;
        }
        
        div._categoryRef = category;

        const dragLabel = this.t('config.dragToReorder') || 'Drag to reorder';
        const dragHandle = document.createElement('span');
        dragHandle.className = 'drag-handle js-drag-handle';
        dragHandle.title = dragLabel;
        dragHandle.setAttribute('aria-label', dragLabel);
        dragHandle.textContent = '⠿';

        const iconInput = document.createElement('input');
        iconInput.type = 'text';
        iconInput.id = `category-icon-${index}`;
        iconInput.name = `category-icon-${index}`;
        iconInput.value = category.icon || '';
        iconInput.placeholder = 'emoticon';
        iconInput.maxLength = 2;
        iconInput.dataset.categoryId = category.id;
        iconInput.dataset.field = 'icon';
        iconInput.setAttribute('aria-label', 'Category emoticon');

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.id = `category-name-${index}`;
        nameInput.name = `category-name-${index}`;
        nameInput.value = category.name || '';
        nameInput.placeholder = this.t('config.categoryNamePlaceholder') || '';
        nameInput.dataset.categoryId = category.id;
        nameInput.dataset.field = 'name';

        const mergeBtn = document.createElement('button');
        mergeBtn.type = 'button';
        mergeBtn.className = 'btn btn-secondary btn-small';
        mergeBtn.textContent = this.t('config.merge') || 'Merge';
        mergeBtn.addEventListener('click', () => {
            window.configManager?.mergeCategory?.(index);
        });

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'btn btn-danger';
        removeBtn.textContent = this.t('config.remove') || 'Remove';
        removeBtn.addEventListener('click', () => {
            window.configManager?.removeCategory?.(index);
        });

        div.appendChild(dragHandle);
        div.appendChild(iconInput);
        div.appendChild(nameInput);
        div.appendChild(mergeBtn);
        div.appendChild(removeBtn);

        nameInput.addEventListener('input', (e) => {
            category.name = e.target.value;
        });

        iconInput.addEventListener('input', (e) => {
            category.icon = (e.target.value || '').trim();
        });

        return div;
    }

    /**
     * Initialize category reordering
     * @param {Array} categories
     * @param {Function} onReorder - Callback when reorder happens
     */
    initReorder(categories, onReorder) {
        // Destroy previous instance if it exists
        if (this.categoryReorder) {
            this.categoryReorder.destroy();
        }
        
        // Initialize drag-and-drop reordering
        this.categoryReorder = new DragReorder({
            container: '#categories-list',
            itemSelector: '.category-item',
            handleSelector: '.js-drag-handle',
            onReorder: (newOrder) => {
                // Update categories array based on new order
                // Use stored category references instead of looking up by ID
                const newCategories = [];
                newOrder.forEach((item) => {
                    // Get the category object stored on the DOM element
                    const category = item.element._categoryRef;
                    if (category) {
                        newCategories.push(category);
                    }
                });
                
                onReorder(newCategories);
            }
        });
    }

    /**
     * Add a new category
     * @param {Array} categories
     * @param {Function} generateId
     * @returns {Object} - The new category
     */
    add(categories, generateId) {
        // Ensure categories is an array
        if (!categories || !Array.isArray(categories)) {
            console.error('Categories must be an array');
            return null;
        }
        const newCategory = {
            id: generateId(`category-${categories.length + 1}`),
            name: `${this.t('config.newCategoryPrefix')} ${categories.length + 1}`,
            icon: ''
        };
        categories.push(newCategory);
        return newCategory;
    }

    /**
     * Remove a category (with confirmation)
     * @param {Array} categories
     * @param {number} index
     * @returns {Promise<boolean>} - Whether the category was removed
     */
    async remove(categories, index, options = {}) {
        const confirmed = await window.AppModal.danger({
            title: this.t('config.removeCategoryTitle'),
            message: options.message || this.t('config.removeCategoryMessage'),
            confirmText: this.t('config.remove'),
            cancelText: this.t('config.cancel')
        });
        
        if (!confirmed) {
            return false;
        }
        
        categories.splice(index, 1);
        return true;
    }
}

// Export for use in other modules
window.ConfigCategories = ConfigCategories;
