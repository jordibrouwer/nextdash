/**
 * The review panel: what the engine proposes, and one button per group.
 *
 * Rendering only. It is handed items and rules and hands back the group the
 * reader accepted; applying is the config section's job, because that is
 * where the existing bulk path with its undo already lives.
 *
 * It fills the Tag suggestions tab of Config -> Bookmarks, so the proposals
 * are laid out flat -- the tab is already the disclosure. Only the rules
 * editor folds, because it grows without bound and sits below the list it
 * would otherwise push off the screen.
 */
(function (global) {
    'use strict';

    /*
     * How many groups the panel will draw.
     *
     * A ten-thousand-bookmark collection with a hundred rules behind it
     * produced sixteen hundred rows, which is not a review -- it is a wall.
     * Twenty-five is roughly what fits a long scroll of the section without
     * turning the page into the suggestions page, and the engine already
     * orders the biggest groups first, so the ones worth a click are the ones
     * that survive the cut. The rest are not hidden: the count below the list
     * says how many are waiting, and they surface as these are accepted.
     */
    const MAX_ROWS = 25;
    /** Turned down gets a search field past this many refusals. */
    const REFUSED_SEARCH_FROM = 10;
    /** What was typed there, kept across the panel's redraws. */
    let refusedQuery = '';

    function reasonText(t, group) {
        if (group.reason.kind === 'rule') return t('config.tagSuggestionReasonRule', 'your rule');
        if (group.reason.kind === 'app') {
            return t('config.tagSuggestionReasonApp', 'recognised as {app}')
                .replace('{app}', String(group.reason.app || ''));
        }
        if (group.reason.kind === 'home') return t('config.tagSuggestionReasonHome', 'on your home network');
        if (group.reason.kind === 'catalogue') {
            // The subject is named as well as the source, because the tag on
            // the row may be the reader's own word for it rather than the
            // catalogue's -- and a row you cannot account for is one you
            // cannot judge.
            return t('config.tagSuggestionReasonCatalogue', 'the catalogue ({subject})')
                .replace('{subject}', String(group.reason.subject || ''));
        }
        if (group.reason.kind === 'online') {
            // What Wikidata calls the site, when it says: "Dutch weather
            // website" explains #weather better than the source alone.
            return group.reason.about
                ? t('config.tagSuggestionReasonOnlineAbout', 'Wikidata: {about}')
                    .replace('{about}', String(group.reason.about))
                : t('config.tagSuggestionReasonOnline', 'Wikidata ({subject})')
                    .replace('{subject}', String(group.reason.subject || ''));
        }
        if (group.reason.kind === 'text') {
            return t('config.tagSuggestionReasonText', 'the page text ({words})')
                .replace('{words}', (group.reason.words || []).join(', '));
        }
        return t('config.tagSuggestionReasonDerived', 'your own tags ({have} of {of})')
            .replace('{have}', String(group.reason.have))
            .replace('{of}', String(group.reason.of));
    }

    function labelledInput(labelText, attr, placeholder) {
        const field = document.createElement('label');
        field.className = 'config-suggestion-field';
        const caption = document.createElement('span');
        caption.className = 'config-suggestion-field-label';
        caption.textContent = labelText;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'config-text';
        input.setAttribute(attr, '');
        input.placeholder = placeholder;
        field.append(caption, input);
        return field;
    }

    /*
     * The rules editor, on a tab of its own.
     *
     * The form sits above the list rather than under it: writing a rule is why
     * a reader opens this, and a reader with forty rules would otherwise have
     * to scroll past all forty to write the forty-first. The list below is a
     * record, and a record belongs under the thing that adds to it.
     */
    function renderRules(container, ctx) {
        const t = ctx.t;
        const rules = ctx.rules || [];
        container.replaceChildren();
        container.hidden = false;

        const head = document.createElement('div');
        head.className = 'config-suggestions-head';
        const intro = document.createElement('p');
        intro.className = 'config-widget-field-hint';
        intro.textContent = t('config.tagRulesIntro',
            'A rule you write always beats what nextDash worked out on its own, and it proposes from the moment you add it.');
        const info = document.createElement('button');
        info.type = 'button';
        info.className = 'config-info-btn';
        info.setAttribute('data-tag-rules-info', '');
        info.setAttribute('aria-label', t('config.settingInfoAria', 'More info'));
        info.title = t('config.settingInfoAria', 'More info');
        info.textContent = 'ℹ';
        head.append(intro, info);
        container.appendChild(head);

        const form = document.createElement('div');
        form.className = 'config-suggestion-row config-suggestion-row--form';
        form.append(
            labelledInput(
                t('config.tagRulePatternLabel', 'Site, or site and section'),
                'data-tag-rule-pattern',
                t('config.tagRulePatternPlaceholder', 'github.com'),
            ),
            labelledInput(
                t('config.tagRuleTagLabel', 'Tag to propose'),
                'data-tag-rule-tag',
                t('config.tagRuleTagPlaceholder', 'code'),
            ),
        );
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'config-btn config-btn--small';
        add.setAttribute('data-tag-rule-add', '');
        add.textContent = t('config.tagRuleAdd', 'Add rule');
        form.appendChild(add);
        container.appendChild(form);

        // Written into by addTagRule when the server would have dropped the
        // rule. Kept in the DOM so nothing jumps when it fills.
        const error = document.createElement('p');
        error.className = 'config-suggestion-error';
        error.setAttribute('data-tag-rule-error', '');
        error.setAttribute('role', 'status');
        error.hidden = true;
        container.appendChild(error);

        const hint = document.createElement('p');
        hint.className = 'config-widget-field-hint';
        hint.textContent = t('config.tagRulesHint',
            'github.com → #code tags every GitHub bookmark. One path segment at most: github.com/trending, not github.com/trending/go.');
        container.appendChild(hint);

        if (!rules.length) {
            const empty = document.createElement('p');
            empty.className = 'config-widget-field-hint';
            empty.setAttribute('data-tag-rules-empty', '');
            empty.textContent = t('config.tagRulesEmpty',
                'No rules yet. Everything on the Tag suggestions tab is worked out from your own tags and the catalogue.');
            container.appendChild(empty);
            return;
        }

        // Health-style rows (config-view.css, .config-crud-list--table): one
        // touching line each, the rule's text reading as a name, Remove out
        // of sight until the row is hovered or focused -- the same table
        // Structure's Categories and Pages already use.
        const list = document.createElement('div');
        list.className = 'config-crud-list config-crud-list--table config-suggestions-list config-suggestion-rules-list';
        rules.forEach((rule, index) => {
            const row = document.createElement('div');
            row.className = 'config-crud-row config-suggestion-row config-suggestion-row--rule';
            row.setAttribute('data-tag-rule', String(index));
            const text = document.createElement('span');
            text.className = 'config-suggestion-rule-text';
            text.textContent = `${rule.pattern} → #${rule.tag}`;
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'config-btn config-btn--small config-btn--danger';
            remove.setAttribute('data-tag-rule-remove', String(index));
            remove.textContent = t('config.tagRuleRemove', 'Remove');
            const actions = document.createElement('div');
            actions.className = 'config-crud-row-actions';
            actions.appendChild(remove);
            row.append(text, actions);
            list.appendChild(row);
        });
        container.appendChild(list);
    }

    /*
     * The engine's groups, one row per tag.
     *
     * The engine groups by site and tag, which is the unit a refusal and a
     * rule are stored under -- and which drew #news five times for five news
     * sites. The reader decides per tag, so the rows are per tag; the groups
     * stay underneath, and Apply, refuse and the member ticks still act on
     * each of them, so a refusal is still remembered per site.
     */
    function mergeByTag(groups) {
        const rows = [];
        const byTag = new Map();
        (groups || []).forEach((group, index) => {
            let row = byTag.get(group.tag);
            if (!row) {
                row = { tag: group.tag, groups: [], keys: 0 };
                byTag.set(group.tag, row);
                rows.push(row);
            }
            row.groups.push({ group, index });
            row.keys += (group.keys || []).length;
        });
        return rows;
    }

    /** Where a row's proposal comes from, once for all its sites. */
    function rowReason(t, row) {
        const reasons = [...new Set(row.groups.map(({ group }) => reasonText(t, group)))];
        return reasons.length === 1
            ? reasons[0]
            : t('config.tagSuggestionReasonSeveral', 'several sources');
    }

    function renderList(t, rows, ctx) {
        // One line per tag: the tag, the sites with where it came from under
        // them, the number of bookmarks, and Apply/refuse -- always shown, in
        // the same four columns on every row (the subgrid in config-view.css).
        const list = document.createElement('ul');
        list.className = 'config-crud-list config-crud-list--table config-suggestions-list config-suggestions-list--proposals';
        rows.slice(0, MAX_ROWS).forEach((row, index) => {
            const line = document.createElement('li');
            line.className = 'config-crud-row config-suggestion-row config-suggestion-row--proposal';
            line.setAttribute('data-tag-suggestion', String(index));

            const tag = document.createElement('span');
            tag.className = 'config-suggestion-tag';
            tag.textContent = `#${row.tag}`;

            const where = document.createElement('span');
            where.className = 'config-suggestion-where';
            const sites = document.createElement('span');
            sites.className = 'config-suggestion-pattern';
            const names = row.groups.map(({ group }) => {
                if (group.pattern === 'page-text') return t('config.tagSuggestionAcrossSites', 'across sites');
                if (group.pattern.startsWith('app:')) return group.reason.app || group.pattern.slice(4);
                return group.pattern;
            });
            sites.textContent = names.length > 3
                ? `${names.slice(0, 3).join(', ')} ${t('config.tagSuggestionMoreSites', '+{n} more').replace('{n}', String(names.length - 3))}`
                : names.join(', ');
            sites.title = names.join(', ');
            const why = document.createElement('span');
            why.className = 'config-suggestion-reason';
            why.textContent = rowReason(t, row);
            where.append(sites, why);

            /*
             * The number of bookmarks, in a chip that opens the list of them.
             * The full phrase is the accessible name, because a bare "3" read
             * aloud is not a count of anything.
             */
            const id = `tag:${row.tag}`;
            const open = ctx.expanded?.has?.(id);
            const count = document.createElement('span');
            count.className = 'config-suggestion-count';
            count.textContent = String(row.keys);
            count.setAttribute('aria-label', row.keys === 1
                ? t('config.tagSuggestionCountOne', '1 bookmark')
                : t('config.tagSuggestionCount', '{n} bookmarks').replace('{n}', String(row.keys)));
            count.setAttribute('data-tag-suggestion-toggle', String(index));
            count.setAttribute('aria-expanded', open ? 'true' : 'false');
            count.setAttribute('role', 'button');
            count.tabIndex = 0;
            count.title = t('config.tagSuggestionMembersAria', 'Show which bookmarks this covers');

            const apply = document.createElement('button');
            apply.type = 'button';
            apply.className = 'config-btn config-btn--small config-btn--primary';
            apply.setAttribute('data-tag-suggestion-apply', String(index));
            apply.textContent = t('config.tagSuggestionApply', 'Apply');

            const dismiss = document.createElement('button');
            dismiss.type = 'button';
            dismiss.className = 'config-btn config-btn--small config-btn--ghost';
            dismiss.setAttribute('data-tag-suggestion-dismiss', String(index));
            dismiss.setAttribute('aria-label', t('config.tagSuggestionDismiss', 'No thanks'));
            dismiss.title = t('config.tagSuggestionDismiss', 'No thanks');
            dismiss.textContent = '✕';

            const actions = document.createElement('span');
            actions.className = 'config-suggestion-actions';
            actions.append(apply, dismiss);

            line.append(tag, where, count, actions);
            list.appendChild(line);
            if (!open) return;

            /*
             * What the row is offering, on request, each with a tick: what
             * stays ticked is what Apply writes. Ticks are kept per site
             * group, as they always were.
             */
            const byKey = new Map((ctx.items || []).map((item) => [item.key, item]));
            const members = document.createElement('li');
            members.className = 'config-suggestion-members';
            members.setAttribute('data-tag-suggestion-members', String(index));
            row.groups.forEach(({ group }) => {
                const groupId = `${group.pattern}|${group.tag}`;
                group.keys.forEach((key) => {
                    const item = byKey.get(key);
                    const member = document.createElement('label');
                    member.className = 'config-suggestion-member';
                    const box = document.createElement('input');
                    box.type = 'checkbox';
                    box.checked = !ctx.excluded?.has?.(`${groupId}|${key}`);
                    box.setAttribute('data-tag-suggestion-member', `${groupId}|${key}`);
                    const name = document.createElement('span');
                    name.className = 'config-suggestion-member-name';
                    name.textContent = item?.name || item?.url || key;
                    const url = document.createElement('span');
                    url.className = 'config-suggestion-member-url';
                    url.textContent = item?.url || '';
                    member.append(box, name, url);
                    members.appendChild(member);
                });
            });
            list.appendChild(members);
        });
        return list;
    }

    /*
     * A small menu: a button that opens a list of actions under it.
     *
     * A <details> rather than a popover of its own, so it opens and closes
     * from the keyboard with no script; the config listener closes it when a
     * choice is made or the reader clicks elsewhere.
     */
    function menu(label, className, attr) {
        const wrap = document.createElement('details');
        wrap.className = `config-tag-menu ${className || ''}`.trim();
        if (attr) wrap.setAttribute(attr, '');
        const summary = document.createElement('summary');
        summary.className = 'config-btn config-btn--small';
        summary.textContent = label;
        const panel = document.createElement('div');
        panel.className = 'config-tag-menu-panel';
        panel.setAttribute('role', 'menu');
        wrap.append(summary, panel);
        return { wrap, panel };
    }

    function menuButton(text, attr, value, extraClass) {
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('role', 'menuitem');
        button.className = `config-tag-menu-item ${extraClass || ''}`.trim();
        button.setAttribute(attr, value || '');
        button.textContent = text;
        return button;
    }

    function menuCheck(text, attr, checked) {
        const label = document.createElement('label');
        label.className = 'config-tag-menu-item config-tag-menu-check';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.setAttribute(attr, '');
        box.checked = !!checked;
        const span = document.createElement('span');
        span.textContent = text;
        label.append(box, span);
        return label;
    }

    function menuRule() {
        const hr = document.createElement('hr');
        hr.className = 'config-tag-menu-rule';
        return hr;
    }

    /*
     * The one line above the list: how many are waiting, and the two menus.
     *
     * "Find tags" holds what a reader starts -- a search for the untagged or
     * for everything, whether it adds straight away, and reading the pages.
     * "⋯" holds what is set once and left: looking up online, and forgetting
     * the words a page round stored.
     */
    function renderToolbar(t, rows, ctx) {
        const bar = document.createElement('div');
        bar.className = 'config-tag-toolbar';
        bar.setAttribute('data-tag-search-card', '');

        const counts = ctx.counts || {};
        const summary = document.createElement('p');
        summary.className = 'config-suggestions-title';
        summary.setAttribute('data-tag-suggestions-count', '');
        const waiting = document.createElement('strong');
        waiting.textContent = rows.length
            ? t('config.tagSuggestionsSummaryCount', '{n} to review').replace('{n}', String(rows.length))
            : t('config.tagSuggestionsNoneWaiting', 'Nothing to review');
        const untagged = document.createElement('span');
        untagged.className = 'config-tag-toolbar-note';
        untagged.textContent = t('config.tagSearchUntaggedNote', '{n} bookmarks without tags')
            .replace('{n}', String(counts.untagged || 0));
        summary.append(waiting, untagged);
        bar.appendChild(summary);

        const actions = document.createElement('div');
        actions.className = 'config-tag-toolbar-actions';

        const find = menu(`⌕ ${t('config.tagSearchMenu', 'Find tags')}`, 'config-tag-menu--find', 'data-tag-find-menu');
        find.wrap.querySelector('summary').classList.add('config-btn--primary');
        const total = (counts.tagged || 0) + (counts.untagged || 0);
        const noTags = menuButton(t('config.tagSearchUntagged', 'Bookmarks without tags ({n})').replace('{n}', String(counts.untagged || 0)),
            'data-tag-search', 'untagged');
        noTags.disabled = !counts.untagged;
        const unsorted = menuButton(t('config.tagSearchUnsorted', 'Unsorted ({n})').replace('{n}', String(counts.unsorted || 0)),
            'data-tag-search', 'unsorted');
        unsorted.disabled = !counts.unsorted;
        const inbox = menuButton(t('config.tagSearchInbox', 'Inbox ({n})').replace('{n}', String(counts.inbox || 0)),
            'data-tag-search', 'inbox');
        inbox.disabled = !counts.inbox;
        find.panel.append(
            noTags,
            menuButton(t('config.tagSearchAll', 'All bookmarks ({n})').replace('{n}', String(total)), 'data-tag-search', 'all'),
            unsorted,
            inbox,
            menuCheck(t('config.tagSearchApplyNowShort', 'Add what it finds straight away'), 'data-tag-search-apply', ctx.applyNow !== false),
            menuRule(),
        );
        // Reading the pages: a different cost (each page is fetched), so a
        // different item, under the rule.
        if (ctx.scan && ctx.scan.pending > 0) {
            const read = menuButton(t('config.tagScanStartN', 'Read their pages ({n} not read yet)')
                .replace('{n}', String(ctx.scan.pending)), 'data-tag-scan-start');
            read.disabled = !!ctx.scan.running;
            find.panel.appendChild(read);
        } else if (ctx.scan) {
            find.panel.appendChild(menuButton(t('config.tagScanAgain', 'Read them again'), 'data-tag-scan-again'));
        }
        const hint = document.createElement('p');
        hint.className = 'config-tag-menu-hint';
        hint.textContent = ctx.lookupOnline
            ? t('config.tagSearchHintOnline', 'The catalogue first, then Wikidata for sites it does not know. Only the site name leaves your server.')
            : t('config.tagSearchHintOffline', 'The catalogue only: looking up online is off (⋯).');
        find.panel.appendChild(hint);

        const more = menu('⋯', 'config-tag-menu--more', 'data-tag-more-menu');
        more.wrap.querySelector('summary').setAttribute('aria-label', t('config.tagSuggestionsMore', 'More'));
        more.panel.append(
            menuCheck(t('config.tagLookupOnlineLabel', 'Look up unknown sites on Wikidata'), 'data-tag-lookup-online', ctx.lookupOnline),
        );
        if (ctx.scan && ctx.scan.pending === 0) {
            more.panel.append(menuRule(), menuButton(t('config.tagScanForget', 'Forget the keywords'), 'data-tag-keywords-clear', '', 'is-danger'));
        }

        const info = document.createElement('button');
        info.type = 'button';
        info.className = 'config-info-btn';
        info.setAttribute('data-tag-suggestions-info', '');
        info.setAttribute('aria-label', t('config.settingInfoAria', 'More info'));
        info.title = t('config.settingInfoAria', 'More info');
        info.textContent = 'ℹ';

        actions.append(find.wrap, more.wrap, info);
        bar.appendChild(actions);
        return bar;
    }

    /*
     * Where things stand, in words: the collection, the catalogue against it,
     * and the rest of what feeds the list. Three short lines under the
     * toolbar, quiet so the list stays the thing to look at.
     */
    function renderFacts(t, ctx) {
        const facts = document.createElement('div');
        facts.className = 'config-tag-facts';
        facts.setAttribute('data-tag-suggestions-facts', '');
        const line = (text) => {
            const p = document.createElement('p');
            p.textContent = text;
            facts.appendChild(p);
        };
        const fmt = (n) => Number(n || 0).toLocaleString();

        const counts = ctx.counts || {};
        const total = (counts.tagged || 0) + (counts.untagged || 0);
        let collection = t('config.tagFactsCollection', '{total} bookmarks: {tagged} with tags, {untagged} without.')
            .replace('{total}', fmt(total))
            .replace('{tagged}', fmt(counts.tagged))
            .replace('{untagged}', fmt(counts.untagged));
        if (counts.unsorted || counts.inbox) {
            collection += ' ' + t('config.tagFactsWaiting', 'Waiting to be filed: {unsorted} in Unsorted, {inbox} in the inbox.')
                .replace('{unsorted}', fmt(counts.unsorted))
                .replace('{inbox}', fmt(counts.inbox));
        }
        line(collection);

        let stats = ctx.catalogueStats;
        if (stats && stats.sites) {
            // Counted over the same bookmarks as the line above, so the two
            // lines agree; the server's own count also takes in the inbox
            // and Unsorted.
            const hosts = new Set();
            (ctx.items || []).forEach((item) => {
                const host = (global.TagSuggestions?.patternsFor?.(item.url) || [])[0];
                if (host) hosts.add(host);
            });
            const unknownSet = new Set(ctx.unknownHosts || []);
            const yours = hosts.size;
            const unknownHere = [...hosts].filter((host) => unknownSet.has(host)).length;
            const known = yours - unknownHere;
            stats = { ...stats, yours, unknown: unknownHere };
            let text = t('config.tagFactsCatalogue', 'The catalogue names {sites} sites in {subjects} subjects, and knows {known} of your {yours} sites.')
                .replace('{sites}', fmt(stats.sites))
                .replace('{subjects}', fmt(stats.subjects))
                .replace('{known}', fmt(known))
                .replace('{yours}', fmt(stats.yours));
            if (stats.unknown) {
                text += ' ' + (ctx.lookupOnline
                    ? t('config.tagFactsUnknownOnline', 'Find tags looks the other {n} up on Wikidata, by site name only.')
                    : t('config.tagFactsUnknownOffline', 'The other {n} are not looked up: looking up online is off (⋯).'))
                    .replace('{n}', fmt(stats.unknown));
            }
            line(text);
        }

        const extra = [];
        if (ctx.scan && ctx.scan.pending > 0) {
            extra.push(t('config.tagFactsUnread', '{n} pages not read for keywords yet').replace('{n}', fmt(ctx.scan.pending)));
        }
        const refused = (ctx.dismissed || []).length;
        if (!extra.length && !refused) return facts;
        const p = document.createElement('p');
        p.textContent = extra.join(' · ');
        // The way down to Turned down, which sits folded at the foot of a long
        // tab: a link that opens it and brings it into view.
        if (refused) {
            if (extra.length) p.append(' · ');
            const link = document.createElement('button');
            link.type = 'button';
            link.className = 'config-link-button';
            link.setAttribute('data-tag-suggestions-refused-jump', '');
            link.textContent = t('config.tagFactsRefused', '{n} turned down, never offered again').replace('{n}', fmt(refused));
            link.addEventListener('click', () => {
                const block = link.closest('#config-bm-suggestions')?.querySelector('[data-tag-suggestions-dismissed]')
                    || document.querySelector('[data-tag-suggestions-dismissed]');
                if (!block) return;
                block.open = true;
                block.scrollIntoView({ block: 'start' });
                block.querySelector('summary')?.focus?.({ preventScroll: true });
            });
            p.append(link);
        }
        p.append('.');
        facts.appendChild(p);
        return facts;
    }

    function render(container, ctx) {
        if (!container) return [];
        const t = ctx.t;
        const groups = global.TagSuggestions.suggest(ctx.items, {
            rules: ctx.rules,
            catalogue: ctx.catalogue,
            dismissed: ctx.dismissed,
            keywords: ctx.keywords,
        });
        const rows = mergeByTag(groups);
        container.replaceChildren();
        container.hidden = false;

        container.appendChild(renderToolbar(t, rows, ctx));
        container.appendChild(renderFacts(t, ctx));

        if (rows.length) {
            container.appendChild(renderList(t, rows, ctx));
            const foot = document.createElement('div');
            foot.className = 'config-tag-foot';
            if (rows.length > MAX_ROWS) {
                const more = document.createElement('p');
                more.className = 'config-widget-field-hint';
                more.setAttribute('data-tag-suggestions-capped', '');
                more.textContent = t('config.tagSuggestionsCapped',
                    'Showing the {shown} biggest suggestions of {total}. Accept some and the rest move up.')
                    .replace('{shown}', String(MAX_ROWS))
                    .replace('{total}', String(rows.length));
                foot.appendChild(more);
            }
            const all = document.createElement('button');
            all.type = 'button';
            all.className = 'config-btn config-btn--small';
            all.setAttribute('data-tag-suggestions-apply-all', '');
            all.textContent = t('config.tagSuggestionsApplyAll', 'Apply all {n}')
                .replace('{n}', String(Math.min(rows.length, MAX_ROWS)));
            foot.appendChild(all);
            container.appendChild(foot);
        } else {
            const empty = document.createElement('p');
            empty.className = 'config-widget-field-hint';
            empty.textContent = t('config.tagSuggestionsEmptySearch',
                'Nothing to review. Find tags looks them up for your bookmarks; three bookmarks from one site with the same tag also offer it to the rest of that site.');
            container.appendChild(empty);
        }

        /*
         * What was turned down, one line each.
         *
         * It used to be a count and a single "offer them again": a reader who
         * refused #video on youtube.com last week and now wants it back had to
         * take back every refusal to get it. Each is named and each has its own
         * way back; the all-at-once button stays for the reader who wants a
         * clean slate.
         */
        const refused = ctx.dismissed || [];
        if (refused.length) {
            const wrap = document.createElement('details');
            wrap.className = 'config-suggestion-rules';
            wrap.setAttribute('data-tag-suggestions-dismissed', '');
            // Drawn open if the reader left it open: the panel is replaced whole
            // after every write, and "Offer again" on one of three refusals
            // used to fold the list shut under the next one.
            wrap.open = !!ctx.refusedOpen;

            const head = document.createElement('summary');
            head.className = 'config-suggestions-summary';
            const headName = document.createElement('span');
            headName.className = 'config-suggestions-summary-title';
            headName.textContent = t('config.tagSuggestionsDismissedTitle', 'Turned down');
            const headNote = document.createElement('span');
            headNote.className = 'config-suggestions-summary-note';
            headNote.textContent = t('config.tagSuggestionsDismissedCount', '{n} turned down.')
                .replace('{n}', String(refused.length));
            head.append(headName, headNote);
            wrap.appendChild(head);

            const list = document.createElement('div');
            list.className = 'config-crud-list config-crud-list--table config-suggestions-list config-suggestion-rules-list';
            refused.forEach((entry) => {
                const [pattern, tag] = String(entry).split('|');
                const row = document.createElement('div');
                row.className = 'config-crud-row config-suggestion-row config-suggestion-row--rule';
                row.setAttribute('data-tag-suggestion-refused', String(entry));
                const text = document.createElement('span');
                text.className = 'config-suggestion-rule-text';
                let where = pattern;
                if (pattern === 'page-text') where = t('config.tagSuggestionAcrossSites', 'across sites');
                else if (pattern.startsWith('app:')) where = pattern.slice(4);
                text.textContent = `${where} → #${tag}`;
                const back = document.createElement('button');
                back.type = 'button';
                back.className = 'config-btn config-btn--small';
                back.setAttribute('data-tag-suggestion-restore-one', String(entry));
                back.textContent = t('config.tagSuggestionRestoreOne', 'Offer again');
                const actions = document.createElement('div');
                actions.className = 'config-crud-row-actions';
                actions.appendChild(back);
                row.append(text, actions);
                list.appendChild(row);
            });
            // Past a screenful, a field to find one by site or tag. The panel is
            // drawn again after every write, so what was typed is kept here and
            // put back, and the list narrowed again with it.
            if (refused.length > REFUSED_SEARCH_FROM) {
                const field = document.createElement('input');
                field.type = 'search';
                field.className = 'config-text config-suggestions-refused-search';
                field.setAttribute('data-tag-suggestions-refused-search', '');
                field.placeholder = t('config.tagSuggestionsRefusedSearch', 'Find a site or tag…');
                field.setAttribute('aria-label', field.placeholder);
                field.value = refusedQuery;
                const narrow = () => {
                    refusedQuery = field.value;
                    const q = refusedQuery.trim().toLowerCase().replace(/^#/, '');
                    list.querySelectorAll('[data-tag-suggestion-refused]').forEach((row) => {
                        row.hidden = Boolean(q) && !row.textContent.toLowerCase().includes(q);
                    });
                };
                field.addEventListener('input', narrow);
                wrap.appendChild(field);
                narrow();
            }
            wrap.appendChild(list);

            const all = document.createElement('p');
            all.className = 'config-widget-field-hint';
            const restore = document.createElement('button');
            restore.type = 'button';
            restore.className = 'config-link-button';
            restore.setAttribute('data-tag-suggestions-restore', '');
            restore.textContent = t('config.tagSuggestionsRestore', 'Offer them again');
            all.appendChild(restore);
            wrap.appendChild(all);
            container.appendChild(wrap);
        }

        return rows;
    }

    global.ConfigTagSuggestions = { render, renderRules, mergeByTag, MAX_ROWS };
})(window);
