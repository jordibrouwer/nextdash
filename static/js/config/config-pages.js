/**
 * Pages Module — create, render, remove, reorder (drag + keyboard).
 */

class ConfigPages {
    constructor(t) {
        this.t = t;
        this.pageReorder = null;
        this._keyboardMoveHandler = null;
    }

    render(pages, generateId, isArchived) {
        const container = document.getElementById('pages-list');
        if (!container) return;

        container.innerHTML = '';

        const list = Array.isArray(pages) ? pages : [];
        if (list.length === 0) {
            const hint = document.createElement('li');
            hint.className = 'pages-list-empty-hint';
            hint.setAttribute('role', 'listitem');
            const defaultName = 'main';
            const tpl = this.t('config.pagesListDefaultHint');
            hint.textContent = tpl.includes('{name}')
                ? tpl.replace('{count}', '1').replace('{name}', defaultName)
                : `You have 1 page: ${defaultName}.`;
            container.appendChild(hint);
            return;
        }

        list.forEach((page, index) => {
            container.appendChild(this.createPageElement(page, index, list, generateId, isArchived));
        });
    }

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

    createPageElement(page, index, pages, generateId, isArchived) {
        const li = document.createElement('li');
        li.className = 'page-item js-item is-idle';
        li.setAttribute('role', 'listitem');
        li.setAttribute('data-page-index', String(index));
        li.setAttribute('data-page-id', String(page.id));
        li.tabIndex = 0;
        li._pageRef = page;

        const isDefaultPage = Number(page.id) === 1;
        const archived = typeof isArchived === 'function' ? isArchived(page.id) : false;
        if (archived) li.classList.add('is-archived');

        const labelId = `page-name-label-${page.id}`;
        const inputId = `page-name-${page.id}`;

        li.innerHTML = `
            <span class="drag-handle js-drag-handle" title="${this.t('config.dragToReorder') || 'Drag to reorder'}" aria-label="${this.t('config.dragToReorder') || 'Drag to reorder'}">⠿</span>
            <label class="visually-hidden" id="${labelId}" for="${inputId}">${this.t('config.pageNameLabelShort') || 'Page name'}</label>
            <input type="text" id="${inputId}" name="${inputId}" value="${this.escapePageName(page.name)}" placeholder="${this.t('config.pageNamePlaceholder')}" data-page-id="${page.id}" data-field="name" aria-labelledby="${labelId}">
            ${archived ? `<span class="page-archived-badge">${this.t('config.archived') || 'archived'}</span>` : ''}
            <span class="page-item-actions"></span>
        `;

        const actions = li.querySelector('.page-item-actions');

        if (!isDefaultPage) {
            const archiveBtn = document.createElement('button');
            archiveBtn.type = 'button';
            archiveBtn.className = 'btn btn-secondary btn-small';
            archiveBtn.textContent = archived
                ? (this.t('config.restore') || 'Restore')
                : (this.t('config.archive') || 'Archive');
            archiveBtn.addEventListener('click', () => {
                if (archived) {
                    window.configManager?.restoreArchivedPage?.(page.id);
                } else {
                    window.configManager?.archivePageById?.(page.id);
                }
            });
            actions.appendChild(archiveBtn);
        }

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'btn btn-danger';
        removeBtn.textContent = this.t('config.remove');
        if (isDefaultPage) {
            removeBtn.disabled = true;
            removeBtn.title = this.t('config.cannotRemoveDefaultPage');
        } else {
            removeBtn.addEventListener('click', () => {
                window.configManager?.removePageById?.(page.id);
            });
        }
        actions.appendChild(removeBtn);

        const nameInput = li.querySelector('input[data-field="name"]');
        nameInput.addEventListener('input', (e) => {
            page.name = e.target.value;
        });

        li.addEventListener('keydown', (e) => {
            if (e.target !== li && e.target !== li.querySelector('.drag-handle')) return;
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
                window.configManager?.movePageById?.(
                    page.id,
                    e.key === 'ArrowUp' ? 'up' : 'down'
                );
            }
        });

        return li;
    }

    escapePageName(name) {
        return String(name || '')
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;');
    }

    syncPageIndices() {
        const container = document.getElementById('pages-list');
        if (!container) return;
        container.querySelectorAll('.page-item[data-page-id]').forEach((el, index) => {
            el.setAttribute('data-page-index', String(index));
        });
    }

    initReorder(pages, onReorder) {
        if (this.pageReorder) {
            this.pageReorder.destroy();
        }

        this.pageReorder = new DragReorder({
            container: '#pages-list',
            itemSelector: '.page-item',
            handleSelector: '.js-drag-handle',
            onReorder: (newOrder) => {
                const newPages = [];
                newOrder.forEach((item) => {
                    const page = item.element._pageRef;
                    if (page) newPages.push(page);
                });
                this.syncPageIndices();
                onReorder(newPages);
            }
        });
    }

    add(pages, generateId) {
        const maxId = pages.length > 0 ? Math.max(...pages.map((p) => p.id)) : 0;
        const newPage = {
            id: maxId + 1,
            name: `${this.t('config.pagePrefix')} ${maxId + 1}`
        };
        pages.push(newPage);
        return newPage;
    }

    removeById(pages, pageId) {
        const targetId = Number(pageId);
        const index = pages.findIndex((p) => Number(p.id) === targetId);
        if (index < 0) return false;
        if (Number(pages[index].id) === 1) return false;
        pages.splice(index, 1);
        return true;
    }

    destroy() {
        if (this.pageReorder) {
            this.pageReorder.destroy();
            this.pageReorder = null;
        }
    }
}

window.ConfigPages = ConfigPages;
