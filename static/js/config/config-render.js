/**
 * Config UI render orchestration — full tab refresh and custom selects.
 */
class ConfigRenderController {
    constructor(config) {
        this.config = config;
    }

    get c() {
        return this.config;
    }

    renderConfig() {
        this.c.pagesData = this.c.applyPagesNormalization(this.c.pagesData);
        this.c.rebuildPageBookmarkCounts?.();
        this.c.pages.render(
            this.c.pagesData,
            this.c.generateId.bind(this.c),
            this.c.isPageArchived.bind(this.c),
            (id) => this.c.getPageBookmarkCount?.(id) ?? 0
        );
        if (this.c.settings && typeof this.c.settings.populateSmartPageSelectors === 'function') {
            this.c.settings.populateSmartPageSelectors(this.c.pagesData, this.c.settingsData);
        }

        const visiblePages = this.c.getVisiblePages();
        if (visiblePages.length > 0 && this.c.isPageArchived(this.c.currentPageId)) {
            this.c.currentPageId = Number(visiblePages[0].id);
        }
        this.c.pages.renderPageSelector(this.c.getVisiblePages(), this.c.currentPageId);

        const categoriesSelector = document.getElementById('categories-page-selector');
        if (categoriesSelector) {
            if (visiblePages.length > 0 && this.c.isPageArchived(this.c.currentCategoriesPageId)) {
                this.c.currentCategoriesPageId = Number(visiblePages[0].id);
            }

            categoriesSelector.innerHTML = '';
            const wantCatPage = Number(this.c.currentCategoriesPageId);
            let catMatched = false;
            this.c.getVisiblePages().forEach(page => {
                const option = document.createElement('option');
                option.value = page.id;
                option.textContent = page.name;
                if (Number.isFinite(wantCatPage) && Number(page.id) === wantCatPage) {
                    option.selected = true;
                    catMatched = true;
                }
                categoriesSelector.appendChild(option);
            });
            if (catMatched) {
                categoriesSelector.value = String(wantCatPage);
            } else if (categoriesSelector.options.length > 0) {
                categoriesSelector.value = categoriesSelector.options[0].value;
                this.c.currentCategoriesPageId = Number(categoriesSelector.value);
            }
            categoriesSelector.__customSelectInstance?.refresh?.();
        }

        this.c.refreshBookmarksFilterOptions();
        this.c.refreshBookmarksList();
        this.c.renderStructureWorkspace();
        this.c.finders.refresh(this.c);
        this.refreshCustomSelects();
        this.c.refreshPageDropdowns();
        if (this.c.collections) this.c.collections.refresh(this.c);

        const interleaveModeCheckbox = document.getElementById('interleave-mode-checkbox');
        if (interleaveModeCheckbox) interleaveModeCheckbox.checked = this.c.settingsData.interleaveMode;
        this.c.updateThemePreviewBadge();
    }

    refreshCustomSelects() {
        const selects = document.querySelectorAll('select[data-custom-select-init="true"]');

        selects.forEach(select => {
            const wrapper = select.closest('.custom-select-wrapper');
            if (!wrapper) return;

            const optionsContainer = wrapper.querySelector('.custom-select-options');
            const trigger = wrapper.querySelector('.custom-select-trigger .custom-select-text');

            if (optionsContainer && trigger) {
                optionsContainer.innerHTML = '';

                Array.from(select.options).forEach((option, index) => {
                    const optionDiv = document.createElement('div');
                    optionDiv.className = 'custom-select-option';
                    optionDiv.textContent = option.textContent;
                    optionDiv.dataset.value = option.value;
                    optionDiv.dataset.index = index;

                    if (option.selected) optionDiv.classList.add('selected');

                    optionDiv.addEventListener('click', (e) => {
                        e.stopPropagation();
                        select.selectedIndex = index;
                        select.dispatchEvent(new Event('change', { bubbles: true }));
                        trigger.textContent = option.textContent;
                        optionsContainer.querySelectorAll('.custom-select-option').forEach(opt => {
                            opt.classList.remove('selected');
                        });
                        optionDiv.classList.add('selected');
                        wrapper.querySelector('.custom-select').classList.remove('open');
                    });

                    optionsContainer.appendChild(optionDiv);
                });

                const selectedOption = select.options[select.selectedIndex];
                if (selectedOption) trigger.textContent = selectedOption.textContent;
            }
        });
    }

    initReordering() {
        this.c.pages.initReorder(this.c.pagesData, (newPages) => this.c.handlePagesReordered(newPages));

        this.c.categories.initReorder(
            this.c.categoriesData,
            (newCategories) => this.c.handleCategoriesReordered(newCategories)
        );

        this.c.refreshBookmarksList();
    }

    installPublicMethods() {
        const c = this.config;
        for (const name of ['renderConfig', 'refreshCustomSelects', 'initReordering']) {
            c[name] = (...args) => this[name](...args);
        }
    }
}

window.ConfigRenderController = ConfigRenderController;
