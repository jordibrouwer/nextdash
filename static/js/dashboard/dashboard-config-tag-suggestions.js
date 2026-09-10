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

    function reasonText(t, group) {
        if (group.reason.kind === 'rule') return t('config.tagSuggestionReasonRule', 'your rule');
        if (group.reason.kind === 'catalogue') {
            // The subject is named as well as the source, because the tag on
            // the row may be the reader's own word for it rather than the
            // catalogue's -- and a row you cannot account for is one you
            // cannot judge.
            return t('config.tagSuggestionReasonCatalogue', 'the catalogue ({subject})')
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

        const list = document.createElement('div');
        list.className = 'config-suggestions-list config-suggestion-rules-list';
        rules.forEach((rule, index) => {
            const row = document.createElement('div');
            row.className = 'config-suggestion-row config-suggestion-row--rule';
            row.setAttribute('data-tag-rule', String(index));
            const text = document.createElement('span');
            text.className = 'config-suggestion-rule-text';
            text.textContent = `${rule.pattern} → #${rule.tag}`;
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'config-btn config-btn--small config-btn--danger';
            remove.setAttribute('data-tag-rule-remove', String(index));
            remove.textContent = t('config.tagRuleRemove', 'Remove');
            row.append(text, remove);
            list.appendChild(row);
        });
        container.appendChild(list);
    }

    function renderList(t, groups) {
        const list = document.createElement('ul');
        list.className = 'config-suggestions-list config-suggestions-list--proposals';
        groups.slice(0, MAX_ROWS).forEach((group, index) => {
            const row = document.createElement('li');
            row.className = 'config-suggestion-row config-suggestion-row--proposal';
            row.setAttribute('data-tag-suggestion', String(index));

            const tag = document.createElement('span');
            tag.className = 'config-suggestion-tag';
            tag.textContent = `#${group.tag}`;

            const pattern = document.createElement('span');
            pattern.className = 'config-suggestion-pattern';
            // A page-text row is grouped by subject across sites, so there is
            // no host to name in this column.
            pattern.textContent = group.pattern === 'page-text'
                ? t('config.tagSuggestionAcrossSites', 'across sites')
                : group.pattern;

            /*
             * The number alone, in a chip.
             *
             * Fifteen rows each ending in the word "bookmark" is fifteen
             * copies of a word the column already means. The full phrase stays
             * as the accessible name, because a bare "3" read aloud is not a
             * count of anything.
             */
            const count = document.createElement('span');
            count.className = 'config-suggestion-count';
            count.textContent = String(group.keys.length);
            count.setAttribute('aria-label', group.keys.length === 1
                ? t('config.tagSuggestionCountOne', '1 bookmark')
                : t('config.tagSuggestionCount', '{n} bookmarks').replace('{n}', String(group.keys.length)));
            count.title = count.getAttribute('aria-label');

            const why = document.createElement('span');
            why.className = 'config-suggestion-reason';
            why.textContent = reasonText(t, group);

            const apply = document.createElement('button');
            apply.type = 'button';
            apply.className = 'config-btn config-btn--small';
            apply.setAttribute('data-tag-suggestion-apply', String(index));
            apply.textContent = t('config.tagSuggestionApply', 'Apply');

            const dismiss = document.createElement('button');
            dismiss.type = 'button';
            dismiss.className = 'config-btn config-btn--small';
            dismiss.setAttribute('data-tag-suggestion-dismiss', String(index));
            dismiss.textContent = t('config.tagSuggestionDismiss', 'No thanks');

            const actions = document.createElement('span');
            actions.className = 'config-suggestion-actions';
            actions.append(apply, dismiss);

            row.append(tag, pattern, count, why, actions);
            list.appendChild(row);
        });
        return list;
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
        container.replaceChildren();
        container.hidden = false;

        const head = document.createElement('div');
        head.className = 'config-suggestions-head';

        const intro = document.createElement('p');
        intro.className = 'config-widget-field-hint';
        intro.textContent = t('config.tagSuggestionsIntro',
            'Proposals only — nothing is tagged until you press Apply.');

        const info = document.createElement('button');
        info.type = 'button';
        info.className = 'config-info-btn';
        info.setAttribute('data-tag-suggestions-info', '');
        info.setAttribute('aria-label', t('config.settingInfoAria', 'More info'));
        info.title = t('config.settingInfoAria', 'More info');
        info.textContent = 'ℹ';

        head.append(intro, info);
        container.appendChild(head);

        if (groups.length) {
            const count = document.createElement('p');
            count.className = 'config-suggestions-title';
            count.setAttribute('data-tag-suggestions-count', '');
            count.textContent = t('config.tagSuggestionsSummaryCount', '{n} to review')
                .replace('{n}', String(groups.length));
            container.appendChild(count);
            container.appendChild(renderList(t, groups));
            if (groups.length > MAX_ROWS) {
                const more = document.createElement('p');
                more.className = 'config-widget-field-hint';
                more.setAttribute('data-tag-suggestions-capped', '');
                more.textContent = t('config.tagSuggestionsCapped',
                    'Showing the {shown} biggest suggestions of {total}. Accept some and the rest move up.')
                    .replace('{shown}', String(MAX_ROWS))
                    .replace('{total}', String(groups.length));
                container.appendChild(more);
            }
        } else {
            const empty = document.createElement('p');
            empty.className = 'config-widget-field-hint';
            empty.textContent = t('config.tagSuggestionsEmpty',
                'Nothing to propose yet. Give three bookmarks from the same site the same tag and the rest of that site is offered it — or write a rule below and it proposes at once.');
            container.appendChild(empty);
        }

        if (ctx.scan && ctx.scan.pending > 0) {
            // A row rather than a line of prose: it offers an action, the rows
            // above it offer actions, and it lines up with them.
            const scan = document.createElement('div');
            scan.className = 'config-suggestion-row config-suggestion-row--scan';
            scan.setAttribute('data-tag-scan', '');
            const cost = document.createElement('span');
            cost.className = 'config-suggestion-scan-text';
            cost.textContent = t('config.tagScanCost', '{n} bookmarks have no keywords yet.')
                .replace('{n}', String(ctx.scan.pending));
            const start = document.createElement('button');
            start.type = 'button';
            start.className = 'config-btn config-btn--small';
            start.setAttribute('data-tag-scan-start', '');
            // Stopping lives on the progress overlay the round puts up, so
            // this stays one button rather than changing meaning mid-round.
            start.textContent = t('config.tagScanStart', 'Read their pages');
            start.disabled = !!ctx.scan.running;
            scan.append(cost, start);
            container.appendChild(scan);
        }

        const refused = (ctx.dismissed || []).length;
        if (refused) {
            const note = document.createElement('p');
            note.className = 'config-widget-field-hint';
            note.setAttribute('data-tag-suggestions-dismissed', '');
            note.textContent = `${t('config.tagSuggestionsDismissedCount', '{n} turned down.')
                .replace('{n}', String(refused))} `;
            const restore = document.createElement('button');
            restore.type = 'button';
            restore.className = 'config-link-button';
            restore.setAttribute('data-tag-suggestions-restore', '');
            restore.textContent = t('config.tagSuggestionsRestore', 'Offer them again');
            note.appendChild(restore);
            container.appendChild(note);
        }

        return groups;
    }

    global.ConfigTagSuggestions = { render, renderRules, MAX_ROWS };
})(window);
