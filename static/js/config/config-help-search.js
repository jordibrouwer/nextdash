/**
 * Config → Help: type-to-filter sections (same pattern as dashboard cheat sheet),
 * plus sticky quick-links nav with scrollspy and single-open accordion sections
 * (same pattern as config-general-layers.js / config-stats.js).
 */
(function () {
    'use strict';

    const DEFAULT_OPEN_BLOCK_ID = 'help-getting-started';

    let scrollspyObs = null;

    function t(language, key, fallback) {
        if (!language?.t) return fallback;
        const fullKey = `config.${key}`;
        const value = language.t(fullKey);
        return value !== fullKey ? value : fallback;
    }

    function applyFilter(filterInput, emptyEl, clearBtn) {
        const q = (filterInput?.value || '').toLowerCase().trim();
        const blocks = document.querySelectorAll('.help-content .help-block');
        const navItems = document.querySelectorAll('.help-index ul li');
        const mobileLinks = document.querySelectorAll('#help-chip-nav a');
        let visibleCount = 0;

        blocks.forEach((block) => {
            const match = !q || block.textContent.toLowerCase().includes(q);
            block.hidden = !match;
            if (match) visibleCount += 1;
        });

        navItems.forEach((li) => {
            const href = li.querySelector('a')?.getAttribute('href') || '';
            const targetId = href.startsWith('#') ? href.slice(1) : '';
            const block = targetId ? document.getElementById(targetId) : null;
            li.hidden = Boolean(q && block?.hidden);
        });

        mobileLinks.forEach((link) => {
            const href = link.getAttribute('href') || '';
            const targetId = href.startsWith('#') ? href.slice(1) : '';
            const block = targetId ? document.getElementById(targetId) : null;
            link.hidden = Boolean(q && block?.hidden);
        });

        if (emptyEl) {
            emptyEl.hidden = !q || visibleCount > 0;
        }
        if (clearBtn) {
            clearBtn.hidden = !filterInput?.value;
        }
    }

    // ── Collapsible blocks (accordion — same pattern as General/Stats) ──────

    function setupBlockCollapsible() {
        document.querySelectorAll('.help-content .help-block[id]').forEach((block) => {
            const title = block.querySelector('.section-title');
            if (!title || title.dataset.collapseWired === '1') return;
            title.dataset.collapseWired = '1';
            block.classList.add('is-collapsible');
            title.setAttribute('role', 'button');
            title.setAttribute('tabindex', '0');
            const startOpen = block.id === DEFAULT_OPEN_BLOCK_ID;
            if (!startOpen) block.classList.add('is-collapsed');
            title.setAttribute('aria-expanded', startOpen ? 'true' : 'false');
            const toggle = () => toggleBlock(block.id);
            title.addEventListener('click', toggle);
            title.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggle();
                }
            });
        });
    }

    function toggleBlock(blockId) {
        const block = document.getElementById(blockId);
        if (!block) return;
        block.classList.toggle('is-collapsed');
        const expanded = !block.classList.contains('is-collapsed');
        const title = block.querySelector('.section-title');
        if (title) title.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        if (expanded) {
            collapseOtherBlocks(blockId);
        }
        syncActiveNavFromOpenBlock();
    }

    /** Opening a block via title click or quick link collapses whichever other block was open. */
    function collapseOtherBlocks(exceptBlockId) {
        document.querySelectorAll('.help-content .help-block[id]').forEach((block) => {
            if (block.id === exceptBlockId || block.classList.contains('is-collapsed')) return;
            block.classList.add('is-collapsed');
            const title = block.querySelector('.section-title');
            if (title) title.setAttribute('aria-expanded', 'false');
        });
    }

    function setActiveNavSection(sectionId) {
        document.querySelectorAll('.help-index-list a, #help-chip-nav a').forEach((a) => {
            a.classList.toggle('is-active', a.getAttribute('href') === `#${sectionId}`);
        });
        window.configManager?.ui?.refreshTabBreadcrumb?.('help');
    }

    /**
     * Highlight the nav link for whichever block is currently open (accordion guarantees at most
     * one). Called right after any accordion state change instead of relying solely on the
     * scrollspy IntersectionObserver, which may not re-fire when the open block was already
     * inside its trigger zone before the change (e.g. no real scroll distance to cross).
     */
    function syncActiveNavFromOpenBlock() {
        const open = document.querySelector('.help-content .help-block[id]:not(.is-collapsed)');
        setActiveNavSection(open ? open.id : null);
    }

    /** Same trigger as the quick-link click handling in config-general-layers.js / config-stats.js. */
    function isBlockInViewport(block) {
        const rect = block.getBoundingClientRect();
        const vh = window.innerHeight || document.documentElement.clientHeight;
        return rect.top > -40 && rect.top < vh * 0.6;
    }

    function scrollToBlock(blockId) {
        const block = document.getElementById(blockId);
        if (!block) return;
        block.classList.remove('is-collapsed');
        const title = block.querySelector('.section-title');
        if (title) title.setAttribute('aria-expanded', 'true');
        syncActiveNavFromOpenBlock();
        block.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function setupNavClicks() {
        const indexEl = document.querySelector('.help-index');
        const chipEl = document.getElementById('help-chip-nav');
        const handler = (e) => {
            const a = e.target.closest('.help-index-list a, #help-chip-nav a');
            if (!a) return;
            const id = (a.getAttribute('href') || '').replace(/^#/, '');
            const block = id ? document.getElementById(id) : null;
            if (!block) return;
            e.preventDefault();
            const isOpen = !block.classList.contains('is-collapsed');
            if (isOpen && isBlockInViewport(block)) {
                toggleBlock(id);
                return;
            }
            collapseOtherBlocks(id);
            scrollToBlock(id);
        };
        if (indexEl && indexEl.dataset.navClicksBound !== '1') {
            indexEl.dataset.navClicksBound = '1';
            indexEl.addEventListener('click', handler);
        }
        if (chipEl && chipEl.dataset.navClicksBound !== '1') {
            chipEl.dataset.navClicksBound = '1';
            chipEl.addEventListener('click', handler);
        }
    }

    function initScrollspy() {
        if (scrollspyObs) {
            scrollspyObs.disconnect();
            scrollspyObs = null;
        }

        const sections = document.querySelectorAll('.help-content .help-block[id]');
        const links = document.querySelectorAll('.help-index-list a, #help-chip-nav a');
        if (!sections.length || !links.length || !('IntersectionObserver' in window)) return;

        const obs = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    setActiveNavSection(entry.target.id);
                }
            });
        }, { rootMargin: '-10% 0px -70% 0px', threshold: 0 });

        sections.forEach((s) => obs.observe(s));
        scrollspyObs = obs;
    }

    window.ConfigHelpSearch = {
        init(language) {
            const filterInput = document.getElementById('help-search-filter');
            const emptyEl = document.getElementById('help-search-empty');
            const clearBtn = document.getElementById('help-search-clear');
            const mobileNav = document.getElementById('help-chip-nav');
            if (!filterInput) return;

            const placeholder = t(language, 'helpFilterPlaceholder', 'Filter help sections…');
            filterInput.placeholder = placeholder;
            filterInput.setAttribute('aria-label', placeholder);

            if (emptyEl) {
                emptyEl.textContent = t(language, 'helpFilterNoResults', 'No sections match your search.');
            }

            if (mobileNav) {
                const navLinks = [...document.querySelectorAll('.help-index ul a')];
                mobileNav.replaceChildren(...navLinks.map((link) => {
                    const clone = link.cloneNode(true);
                    clone.classList.add('help-chip');
                    return clone;
                }));
            }

            const runFilter = () => applyFilter(filterInput, emptyEl, clearBtn);

            filterInput.addEventListener('input', runFilter);

            filterInput.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    filterInput.value = '';
                    runFilter();
                    filterInput.blur();
                }
            });

            if (clearBtn) {
                clearBtn.addEventListener('click', () => {
                    filterInput.value = '';
                    runFilter();
                    filterInput.focus();
                });
            }

            setupBlockCollapsible();
            setupNavClicks();
            initScrollspy();
            syncActiveNavFromOpenBlock();
        },
    };
})();
