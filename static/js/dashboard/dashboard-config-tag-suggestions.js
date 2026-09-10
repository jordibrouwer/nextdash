/**
 * The review panel: what the engine proposes, and one button per group.
 *
 * Rendering only. It is handed items and rules and hands back the group the
 * reader accepted; applying is the config section's job, because that is
 * where the existing bulk path with its undo already lives.
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
        return t('config.tagSuggestionReasonDerived', 'your own tags ({have} of {of})')
            .replace('{have}', String(group.reason.have))
            .replace('{of}', String(group.reason.of));
    }

    function renderRules(container, ctx) {
        const t = ctx.t;
        const wrap = document.createElement('div');
        wrap.className = 'config-suggestion-rules';

        const heading = document.createElement('h4');
        heading.className = 'config-suggestions-title';
        heading.textContent = t('config.tagRulesTitle', 'Your rules');
        wrap.appendChild(heading);

        (ctx.rules || []).forEach((rule, index) => {
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
        form.className = 'config-suggestion-row';
        const pattern = document.createElement('input');
        pattern.type = 'text';
        pattern.className = 'config-text';
        pattern.setAttribute('data-tag-rule-pattern', '');
        pattern.placeholder = t('config.tagRulePatternPlaceholder', 'github.com');
        const tag = document.createElement('input');
        tag.type = 'text';
        tag.className = 'config-text';
        tag.setAttribute('data-tag-rule-tag', '');
        tag.placeholder = t('config.tagRuleTagPlaceholder', 'code');
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'config-btn config-btn--small';
        add.setAttribute('data-tag-rule-add', '');
        add.textContent = t('config.tagRuleAdd', 'Add rule');
        form.append(pattern, tag, add);
        wrap.appendChild(form);
        container.appendChild(wrap);
    }

    function render(container, ctx) {
        if (!container) return [];
        const t = ctx.t;
        const groups = global.TagSuggestions.suggest(ctx.items, { rules: ctx.rules });
        container.replaceChildren();
        container.hidden = false;
        if (!groups.length) {
            // A hint rather than silence: an editor lives here too, so the
            // panel still has a reason to show even with nothing proposed.
            const empty = document.createElement('p');
            empty.className = 'config-widget-field-hint';
            empty.textContent = t('config.tagSuggestionsEmpty',
                'Nothing to suggest yet — tag a few bookmarks and their neighbours will start proposing themselves.');
            container.appendChild(empty);
            renderRules(container, ctx);
            return groups;
        }

        const title = document.createElement('h4');
        title.className = 'config-suggestions-title';
        title.textContent = t('config.tagSuggestionsTitle', 'Tag suggestions');
        container.appendChild(title);

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
        container.appendChild(list);
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
        renderRules(container, ctx);
        return groups;
    }

    global.ConfigTagSuggestions = { render };
})(window);
