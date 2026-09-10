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

    /*
     * Whether the rules editor is open, remembered per browser.
     *
     * The panel is redrawn after every write -- applying a group, adding a
     * rule, any bulk undo -- so a <details> whose state is derived from the
     * content could not be kept shut: it would spring open again on the next
     * repaint. The reader's own choice outranks the content, so it is stored;
     * only the first visit falls back to the content, which opens the editor
     * when there is nothing to review and there is nothing else to do here.
     */
    const OPEN_KEY = 'configTagRulesOpen';

    function storedOpen() {
        try {
            const raw = global.localStorage?.getItem(OPEN_KEY);
            if (raw === 'true') return true;
            if (raw === 'false') return false;
        } catch (err) {
            // A private window, or site data switched off. The content decides.
        }
        return null;
    }

    function reasonText(t, group) {
        if (group.reason.kind === 'rule') return t('config.tagSuggestionReasonRule', 'your rule');
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

    function renderRules(container, ctx, hasGroups) {
        const t = ctx.t;
        const rules = ctx.rules || [];
        const wrap = document.createElement('details');
        wrap.className = 'config-suggestion-rules';
        wrap.id = 'config-tag-rules-details';
        const remembered = storedOpen();
        wrap.open = remembered === null ? !hasGroups : remembered;

        const heading = document.createElement('summary');
        heading.className = 'config-suggestions-summary';
        const headingName = document.createElement('span');
        headingName.className = 'config-suggestions-summary-title';
        headingName.textContent = t('config.tagRulesTitle', 'Your rules');
        const headingNote = document.createElement('span');
        headingNote.className = 'config-suggestions-summary-note';
        headingNote.textContent = rules.length
            ? t('config.tagRulesSummaryCount', '{n} in use').replace('{n}', String(rules.length))
            : t('config.tagRulesSummaryNone', 'none yet');
        heading.append(headingName, headingNote);
        wrap.appendChild(heading);

        const hint = document.createElement('p');
        hint.className = 'config-widget-field-hint';
        hint.textContent = t('config.tagRulesHint',
            'github.com → #code tags every GitHub bookmark. A rule always beats what nextDash worked out on its own. One path segment at most: github.com/anthropics, not github.com/anthropics/claude.');
        wrap.appendChild(hint);

        rules.forEach((rule, index) => {
            const row = document.createElement('div');
            row.className = 'config-suggestion-row';
            const text = document.createElement('span');
            text.textContent = `${rule.pattern} → #${rule.tag}`;
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'config-btn config-btn--small config-btn--danger';
            remove.setAttribute('data-tag-rule-remove', String(index));
            remove.textContent = t('config.tagRuleRemove', 'Remove');
            row.append(text, remove);
            wrap.appendChild(row);
        });

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
        wrap.appendChild(form);

        // Written into by addTagRule when the server would have dropped the
        // rule. Kept in the DOM so the row does not jump when it fills.
        const error = document.createElement('p');
        error.className = 'config-suggestion-error';
        error.setAttribute('data-tag-rule-error', '');
        error.setAttribute('role', 'status');
        error.hidden = true;
        wrap.appendChild(error);

        container.appendChild(wrap);
    }

    function renderList(t, groups) {
        const list = document.createElement('ul');
        list.className = 'config-suggestions-list';
        groups.slice(0, MAX_ROWS).forEach((group, index) => {
            const row = document.createElement('li');
            row.className = 'config-suggestion-row';
            row.setAttribute('data-tag-suggestion', String(index));

            const tag = document.createElement('span');
            tag.className = 'config-suggestion-tag';
            tag.textContent = `#${group.tag}`;

            const pattern = document.createElement('span');
            pattern.className = 'config-suggestion-pattern';
            pattern.textContent = group.pattern;

            const count = document.createElement('span');
            count.className = 'config-suggestion-count';
            count.textContent = t('config.tagSuggestionCount', '{n} bookmarks')
                .replace('{n}', String(group.keys.length));

            const why = document.createElement('span');
            why.className = 'config-suggestion-reason';
            why.textContent = reasonText(t, group);

            const apply = document.createElement('button');
            apply.type = 'button';
            apply.className = 'config-btn config-btn--small';
            apply.setAttribute('data-tag-suggestion-apply', String(index));
            apply.textContent = t('config.tagSuggestionApply', 'Apply');

            row.append(tag, pattern, count, why, apply);
            list.appendChild(row);
        });
        return list;
    }

    function render(container, ctx) {
        if (!container) return [];
        const t = ctx.t;
        const groups = global.TagSuggestions.suggest(ctx.items, { rules: ctx.rules });
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

        renderRules(container, ctx, groups.length > 0);
        return groups;
    }

    global.ConfigTagSuggestions = { render, OPEN_KEY, MAX_ROWS };
})(window);
