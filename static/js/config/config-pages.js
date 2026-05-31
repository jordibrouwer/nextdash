/**
 * Pages Module
 * Handles page management (create, render, remove, reorder)
 */

class ConfigPages {
    constructor(t) {
        this.t = t; // Translation function
        this.pageReorder = null;
    }

    /**
     * Render pages list
     * @param {Array} pages
     * @param {Function} generateId - Function to generate ID from name
     */
    render(pages, generateId, isArchived) {
        const container = document.getElementById('pages-list');
        if (!container) return;

        container.innerHTML = '';

        pages.forEach((page, index) => {
            const pageElement = this.createPageElement(page, index, pages, generateId, isArchived);
            container.appendChild(pageElement);
        });
    }

    /**
     * Render pages in page selector dropdown
     * @param {Array} pages
     * @param {string} currentPageId - Currently selected page ID
     */
    renderPageSelector(pages, currentPageId) {
        const selector = document.getElementById('page-selector');
        if (!selector) return;

        selector.innerHTML = '';

        const list = Array.isArray(pages) ? pages : [];
        const want = Number(currentPageId);
        let matched = false;
        list.forEach((page) => {
            const option = document.createElement('option');
            option.value = page.id;
            option.textContent = page.name;
            if (Number.isFinite(want) && Number(page.id) === want) {
                option.selected = true;
                matched = true;
            }
            selector.appendChild(option);
        });
        if (!matched && selector.options.length > 0) {
            selector.options[0].selected = true;
        }
    }

    /**
     * Create a page DOM element
     * @param {Object} page
     * @param {number} index
     * @param {Array} pages - Reference to pages array
     * @param {Function} generateId
     * @returns {HTMLElement}
     */
    createPageElement(page, index, pages, generateId, isArchived) {
        const div = document.createElement('div');
        div.className = 'page-item js-item is-idle';
        div.setAttribute('data-page-index', index);
        div.setAttribute('data-page-id', page.id); // Store the actual page ID

        // Store reference to the actual page object
        div._pageRef = page;

        const isDefaultPage = page.id === 1;
        const archived = typeof isArchived === 'function' ? isArchived(page.id) : false;
        if (archived) div.classList.add('is-archived');
        const removeButton = isDefaultPage
            ? `<button type="button" class="btn btn-danger" disabled title="${this.t('config.cannotRemoveDefaultPage')}">${this.t('config.remove')}</button>`
            : `<button type="button" class="btn btn-danger" onclick="configManager.removePage(${index})">${this.t('config.remove')}</button>`;
        const archiveButton = isDefaultPage
            ? ''
            : archived
                ? `<button type="button" class="btn btn-secondary btn-small" onclick="configManager.restoreArchivedPage(${page.id})">${this.t('config.restore')}</button>`
                : `<button type="button" class="btn btn-secondary btn-small" onclick="configManager.archivePage(${index})">${this.t('config.archive')}</button>`;
        
        div.innerHTML = `
            <span class="drag-handle js-drag-handle" title="Drag to reorder">⠿</span>
            <input type="text" id="page-name-${index}" name="page-name-${index}" value="${page.name}" placeholder="${this.t('config.pageNamePlaceholder')}" data-page-id="${page.id}" data-field="name">
            ${archived ? `<span class="page-archived-badge">${this.t('config.archived') || 'archived'}</span>` : ''}
            ${archiveButton}
            ${removeButton}
        `;

        // Add event listener for name changes
        const nameInput = div.querySelector('input[data-field="name"]');
        nameInput.addEventListener('input', (e) => {
            // Update the page object directly via stored reference
            page.name = e.target.value;
        });

        return div;
    }

    /**
     * Initialize page reordering
     * @param {Array} pages
     * @param {Function} onReorder - Callback when reorder happens
     */
    initReorder(pages, onReorder) {
        // Destroy previous instance if it exists
        if (this.pageReorder) {
            this.pageReorder.destroy();
        }
        
        // Initialize drag-and-drop reordering
        this.pageReorder = new DragReorder({
            container: '#pages-list',
            itemSelector: '.page-item',
            handleSelector: '.js-drag-handle',
            onReorder: (newOrder) => {
                // Update pages array based on new order
                // Use stored page references instead of looking up by ID
                const newPages = [];
                newOrder.forEach((item) => {
                    // Get the page object stored on the DOM element
                    const page = item.element._pageRef;
                    if (page) {
                        newPages.push(page);
                    }
                });
                
                onReorder(newPages);
            }
        });
    }

    /**
     * Add a new page
     * @param {Array} pages
     * @param {Function} generateId - Not used anymore, kept for compatibility
     * @returns {Object} - The new page
     */
    add(pages, generateId) {
        // Find the highest ID and add 1
        const maxId = pages.length > 0 ? Math.max(...pages.map(p => p.id)) : 0;
        const newPage = {
            id: maxId + 1,
            name: `${this.t('config.pagePrefix')} ${maxId + 1}`
        };
        pages.push(newPage);
        return newPage;
    }

    /**
     * Remove a page
     * @param {Array} pages
     * @param {number} index
     * @returns {boolean} - Whether removal was successful
     */
    remove(pages, index) {
        if (index >= 0 && index < pages.length) {
            // Don't allow removing the default page
            if (pages[index].id === 'default') {
                return false;
            }
            pages.splice(index, 1);
            return true;
        }
        return false;
    }

    /**
     * Destroy reorder instance
     */
    destroy() {
        if (this.pageReorder) {
            this.pageReorder.destroy();
            this.pageReorder = null;
        }
    }
}
