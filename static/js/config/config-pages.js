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

/**
 * Pages orchestration — archive, remove, reorder, templates.
 */
class ConfigPagesController {
    constructor(config) {
        this.config = config;
    }

    get c() {
        return this.config;
    }

    handlePagesReordered(newPages) {
        this.c.pagesData = newPages;
        this.c.pages.syncPageIndices?.();
        this.c.pages.renderPageSelector(this.c.getVisiblePages(), this.c.currentPageId);
        this.c.markDirty();
        clearTimeout(this.c._pageReorderPersistTimer);
        this.c._pageReorderPersistTimer = setTimeout(() => {
            void this.c.persistPagesStructureAndRefresh('page-reordered');
        }, 600);
    }

    getArchivedPageIds() {
        return Array.isArray(this.c.settingsData.archivedPageIds) ? this.c.settingsData.archivedPageIds.map(Number) : [];
    }

    isPageArchived(pageId) {
        return this.c.getArchivedPageIds().includes(Number(pageId));
    }

    getVisiblePages() {
        return this.c.pagesData.filter((page) => !this.c.isPageArchived(page.id));
    }

    async addPage(options = {}) {
        let pageName = (options.pageName || '').trim();
        let templateId = options.templateId || 'blank';
        if (!options.skipPrompt) {
            const details = await this.c.promptNewPageDetails();
            if (!details) return;
            pageName = details.pageName;
            templateId = details.templateId;
        }
        const newPage = this.c.pages.add(this.c.pagesData, this.c.generateId.bind(this.c));
        if (pageName) {
            newPage.name = pageName;
        }
        const template = this.c.getPageTemplateDefinition(templateId);
        const defaultCategories = template.categories;
        try {
            await this.c.data.saveCategoriesByPage(defaultCategories, newPage.id);
            await this.c.saveBookmarksPage(newPage.id, template.bookmarks);
        } catch (error) {
            console.error('Error creating new page:', error);
        }
        
        this.c.pages.render(this.c.pagesData, this.c.generateId.bind(this.c), this.c.isPageArchived.bind(this.c));
        this.c.pages.renderPageSelector(this.c.getVisiblePages(), newPage.id);
        this.c.pages.initReorder(this.c.pagesData, (newPages) => this.c.handlePagesReordered(newPages));
    
        const pageSelector = document.getElementById('page-selector');
        if (pageSelector) {
            pageSelector.value = String(newPage.id);
            this.c.currentPageId = newPage.id;
            this.c.loadPageBookmarks(newPage.id);
        }
    
        const categoriesSelector = document.getElementById('categories-page-selector');
        if (categoriesSelector) {
            categoriesSelector.innerHTML = '';
            this.c.getVisiblePages().forEach(page => {
                const option = document.createElement('option');
                option.value = page.id;
                option.textContent = page.name;
                if (Number(page.id) === Number(newPage.id)) option.selected = true;
                categoriesSelector.appendChild(option);
            });
            if (categoriesSelector.__customSelectInstance) {
                categoriesSelector.__customSelectInstance.refresh();
            }
            this.c.currentCategoriesPageId = newPage.id;
            this.c.loadPageCategories(newPage.id);
        }
    
        await this.c.persistPagesStructureAndRefresh('page-added');
        this.c.renderStructureWorkspace();
    }

    async removePage(index) {
        const page = this.c.pagesData[index];
        if (!page) return;
        await this.c.removePageById(page.id);
    }

    async removePageById(pageId) {
        const targetId = Number(pageId);
        const page = this.c.pagesData.find((p) => Number(p.id) === targetId);
        if (!page) return;
    
        if (Number(page.id) === 1) {
            this.c.ui.showNotification(this.c.language.t('config.cannotRemoveMainPage'), 'error');
            return;
        }
    
        let pageBookmarks = [], pageCategories = [];
        try {
            [pageBookmarks, pageCategories] = await Promise.all([
                this.c.data.loadBookmarksByPage(page.id),
                this.c.data.loadCategoriesByPage(page.id),
            ]);
        } catch (e) { /* ignore — show modal with 0 counts */ }
        pageBookmarks = Array.isArray(pageBookmarks) ? pageBookmarks : [];
        pageCategories = Array.isArray(pageCategories) ? pageCategories : [];
        const confirmed = await window.AppModal.danger({
            title: this.c.language.t('config.removePageTitle'),
            message: `${this.c.language.t('config.removePageMessage').replace('{pageName}', page.name)}\n\nImpact: ${pageCategories.length} categories, ${pageBookmarks.length} bookmarks.`,
            confirmText: this.c.language.t('config.remove'),
            cancelText: this.c.language.t('config.cancel')
        });
    
        if (!confirmed) return;
    
        const index = this.c.pagesData.findIndex((p) => Number(p.id) === targetId);
        if (index < 0) return;
    
        try {
            await this.c.data.deletePage(page.id);
    
            this.c.pagesData.splice(index, 1);
    
            const origIndex = this.c.originalPagesData.findIndex((p) => Number(p.id) === targetId);
            if (origIndex !== -1) {
                this.c.originalPagesData.splice(origIndex, 1);
            }
    
            this.c.pages.render(this.c.pagesData, this.c.generateId.bind(this.c), this.c.isPageArchived.bind(this.c));
            this.c.pages.renderPageSelector(this.c.getVisiblePages(), 1);
            this.c.pages.initReorder(this.c.pagesData, (newPages) => this.c.handlePagesReordered(newPages));
            
            this.c.currentPageId = 1;
            this.c.currentCategoriesPageId = 1;
            await this.c.loadPageBookmarks(1);
            await this.c.loadPageCategories(1);
            
            const pageSelector = document.getElementById('page-selector');
            if (pageSelector) pageSelector.value = '1';
            
            const categoriesSelector = document.getElementById('categories-page-selector');
            if (categoriesSelector) {
                categoriesSelector.innerHTML = '';
                this.c.getVisiblePages().forEach(p => {
                    const option = document.createElement('option');
                    option.value = p.id;
                    option.textContent = p.name;
                    if (Number(p.id) === 1) option.selected = true;
                    categoriesSelector.appendChild(option);
                });
                if (categoriesSelector.__customSelectInstance) {
                    categoriesSelector.__customSelectInstance.refresh();
                }
            }
            await this.c.persistPagesStructureAndRefresh('page-removed');
            this.c.renderStructureWorkspace();
            this.c.ui.showNotification(this.c.language.t('config.pageDeleted'), 'success');
        } catch (error) {
            console.error('Error deleting page:', error);
            this.c.ui.showNotification(this.c.language.t('config.errorDeletingPage'), 'error');
        }
    }

    async archivePage(index) {
        const page = this.c.pagesData[index];
        if (!page) return;
        await this.c.archivePageById(page.id);
    }

    async archivePageById(pageId) {
        const page = this.c.pagesData.find((p) => Number(p.id) === Number(pageId));
        if (!page || Number(page.id) === 1) {
            return;
        }
        if (this.c.isPageArchived(page.id)) {
            this.c.ui.showNotification(this.c.language.t('config.pageAlreadyArchived') || 'Already archived.', 'info');
            return;
        }
        const archived = this.c.getArchivedPageIds();
        archived.push(Number(page.id));
        this.c.settingsData.archivedPageIds = Array.from(new Set(archived));
        await this.c.settings.saveSettingsToServer(this.c.settingsData);
        if (Number(this.c.currentPageId) === Number(page.id)) {
            const fallback = this.c.getVisiblePages()[0];
            if (fallback) {
                this.c.currentPageId = Number(fallback.id);
                this.c.currentCategoriesPageId = Number(fallback.id);
                await this.c.loadPageBookmarks(this.c.currentPageId);
                await this.c.loadPageCategories(this.c.currentCategoriesPageId);
            }
        }
        this.c.renderConfig();
        this.c.ui.showNotification(this.c.language.t('config.pageArchived') || 'Page archived.', 'success');
    }

    movePageById(pageId, direction) {
        const targetId = Number(pageId);
        const index = this.c.pagesData.findIndex((p) => Number(p.id) === targetId);
        if (index < 0) return;
        const swap = direction === 'up' ? index - 1 : index + 1;
        if (swap < 0 || swap >= this.c.pagesData.length) return;
        const order = [...this.c.pagesData];
        [order[index], order[swap]] = [order[swap], order[index]];
        this.c.pagesData = order;
        this.c.pages.render(this.c.pagesData, this.c.generateId.bind(this.c), this.c.isPageArchived.bind(this.c));
        this.c.pages.initReorder(this.c.pagesData, (newPages) => this.c.handlePagesReordered(newPages));
        const focusEl = document.querySelector(`.page-item[data-page-id="${targetId}"]`);
        focusEl?.focus?.();
    }

    async restoreArchivedPage(pageId) {
        const targetId = Number(pageId);
        this.c.settingsData.archivedPageIds = this.c.getArchivedPageIds().filter((id) => id !== targetId);
        await this.c.settings.saveSettingsToServer(this.c.settingsData);
        if (Number(this.c.currentPageId) === targetId || Number(this.c.currentCategoriesPageId) === targetId) {
            await this.c.loadPageBookmarks(targetId);
            await this.c.loadPageCategories(targetId);
        }
        this.c.renderConfig();
        this.c.ui.showNotification(this.c.language.t('config.pageRestored') || 'Page restored.', 'success');
    }

    getPageTemplateDefinition(templateId) {
        if (templateId === 'work') {
            return {
                categories: [
                    { id: 'planning', name: this.c.language.t('config.pageTemplateWorkPlanning') },
                    { id: 'build', name: this.c.language.t('config.pageTemplateWorkBuild') },
                    { id: 'docs', name: this.c.language.t('config.pageTemplateWorkDocs') }
                ],
                bookmarks: []
            };
        }
        if (templateId === 'personal') {
            return {
                categories: [
                    { id: 'daily', name: this.c.language.t('config.pageTemplatePersonalDaily') },
                    { id: 'finance', name: this.c.language.t('config.pageTemplatePersonalFinance') },
                    { id: 'media', name: this.c.language.t('config.pageTemplatePersonalMedia') }
                ],
                bookmarks: []
            };
        }
        if (templateId === 'learn') {
            return {
                categories: [
                    { id: 'courses', name: this.c.language.t('config.pageTemplateLearnCourses') },
                    { id: 'references', name: this.c.language.t('config.pageTemplateLearnReferences') },
                    { id: 'practice', name: this.c.language.t('config.pageTemplateLearnPractice') }
                ],
                bookmarks: []
            };
        }
        return {
            categories: [{ id: 'others', name: this.c.language.t('dashboard.others') }],
            bookmarks: []
        };
    }

    async promptNewPageDetails() {
        const html = `
            <label class="structure-inline-label" for="new-page-name-input">${this.c.language.t('config.pageNameLabelShort') || 'Page name'}</label>
            <input id="new-page-name-input" type="text" class="page-selector" style="max-width:100%;" placeholder="${this.c.language.t('config.newPagePlaceholder') || 'New page'}">
            <label class="structure-inline-label" for="new-page-template-select">${this.c.language.t('config.template') || 'Template'}</label>
            <select id="new-page-template-select" class="page-selector" style="max-width:100%;">
                <option value="blank">${this.c.language.t('config.templateBlank') || 'Blank'}</option>
                <option value="work">${this.c.language.t('config.templateWork') || 'Work'}</option>
                <option value="personal">${this.c.language.t('config.templatePersonal') || 'Personal'}</option>
                <option value="learn">${this.c.language.t('config.templateLearn') || 'Learn'}</option>
            </select>
        `;
        const confirmed = await window.AppModal.confirm({
            title: this.c.language.t('config.createPageTitle') || 'Create page',
            htmlMessage: html,
            confirmText: this.c.language.t('config.create') || 'Create',
            cancelText: this.c.language.t('config.cancel')
        });
        if (!confirmed) return null;
        const nameInput = document.getElementById('new-page-name-input');
        const templateSelect = document.getElementById('new-page-template-select');
        return {
            pageName: nameInput ? nameInput.value.trim() : '',
            templateId: templateSelect ? templateSelect.value : 'blank'
        };
    }

    normalizePagesData(pages) {
        const raw = Array.isArray(pages) ? pages : [];
        const list = raw
            .filter((page) => page && Number.isFinite(Number(page.id)) && Number(page.id) >= 1)
            .map((page) => ({
                ...page,
                id: Number(page.id),
                name: String(page.name || '').trim(),
            }));
        let repaired = false;
    
        if (!list.some((page) => page.id === 1)) {
            list.unshift({ id: 1, name: 'main' });
            repaired = true;
        }
        if (list.length === 0) {
            return { pages: [{ id: 1, name: 'main' }], repaired: true };
        }
    
        list.forEach((page) => {
            if (!page.name) {
                page.name = page.id === 1 ? 'main' : `Page ${page.id}`;
                repaired = true;
            }
        });
    
        if (raw.length === 0 || raw.length !== list.length) {
            repaired = true;
        }
        return { pages: list, repaired };
    }

    applyPagesNormalization(pages, options = {}) {
        const { pages: normalized, repaired } = this.c.normalizePagesData(pages);
        if (options.trackRepair && repaired) {
            this.c._pagesRepairedOnLoad = true;
        }
        return normalized;
    }

    renderPagesTab() {
        this.c.pagesData = this.c.applyPagesNormalization(this.c.pagesData);
        this.c.pages.render(this.c.pagesData, this.c.generateId.bind(this.c), this.c.isPageArchived.bind(this.c));
        this.c.pages.initReorder(this.c.pagesData, (newPages) => this.c.handlePagesReordered(newPages));
    }

    async reloadPagesFromServerIfNeeded() {
        if (!this.c._pagesRepairedOnLoad) {
            return;
        }
        try {
            const response = await fetch('/api/pages');
            if (!response.ok) {
                return;
            }
            const pages = await response.json();
            this.c.pagesData = this.c.applyPagesNormalization(pages);
            this.c.originalPagesData = JSON.parse(JSON.stringify(this.c.pagesData));
            this.c._pagesRepairedOnLoad = false;
        } catch (error) {
            console.warn('Failed to reload pages after repair:', error);
        }
    }

    resolvePageId(rawPageId, pages) {
        const candidates = Array.isArray(pages) ? pages : [];
        const parsed = Number(rawPageId);
        if (
            Number.isFinite(parsed) &&
            parsed >= 1 &&
            candidates.some((page) => Number(page.id) === parsed)
        ) {
            return parsed;
        }
        if (candidates.length > 0) {
            return Number(candidates[0].id);
        }
        return 1;
    }

    async refreshStructureDependentUI() {
        const previousPageId = Number(this.c.currentPageId) || 1;
        const previousCategoriesPageId = Number(this.c.currentCategoriesPageId) || this.c.getDefaultCategoriesPageId();
        const selectedPageExists = this.c.pagesData.some((page) => Number(page.id) === previousPageId);
        const selectedCategoriesPageExists = this.c.pagesData.some((page) => Number(page.id) === previousCategoriesPageId);
    
        this.c.currentPageId = selectedPageExists ? previousPageId : (this.c.pagesData[0]?.id || 1);
        this.c.currentCategoriesPageId = selectedCategoriesPageExists
            ? previousCategoriesPageId
            : this.c.getDefaultCategoriesPageId();
    
        await this.c.loadPageBookmarks(this.c.currentPageId);
        await this.c.loadPageCategories(this.c.currentCategoriesPageId);
        this.c.syncCategoriesPageSelectorUI(this.c.currentCategoriesPageId);
        this.c.renderConfig();
        this.c.initReordering();
    }

    installPublicMethods() {
        const c = this.config;
        for (const name of ['handlePagesReordered', 'getArchivedPageIds', 'isPageArchived', 'getVisiblePages', 'addPage', 'removePage', 'removePageById', 'archivePage', 'archivePageById', 'movePageById', 'restoreArchivedPage', 'getPageTemplateDefinition', 'promptNewPageDetails', 'normalizePagesData', 'applyPagesNormalization', 'renderPagesTab', 'reloadPagesFromServerIfNeeded', 'resolvePageId', 'refreshStructureDependentUI']) {
            c[name] = (...args) => this[name](...args);
        }
    }
}

window.ConfigPagesController = ConfigPagesController;
