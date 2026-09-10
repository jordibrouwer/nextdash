/**
 * The review panel: what the engine proposes, and one button per group.
 *
 * Rendering only. It is handed items and rules and hands back the group the
 * reader accepted; applying is the config section's job, because that is
 * where the existing bulk path with its undo already lives.
 */
(function (global) {
    'use strict';

    function reasonText(t, group) {
        if (group.reason.kind === 'rule') return t('config.tagSuggestionReasonRule', 'your rule');
        return t('config.tagSuggestionReasonDerived', 'your own tags ({have} of {of})')
            .replace('{have}', String(group.reason.have))
            .replace('{of}', String(group.reason.of));
    }

    function render(container, ctx) {
        if (!container) return [];
        const t = ctx.t;
        const groups = global.TagSuggestions.suggest(ctx.items, { rules: ctx.rules });
        container.replaceChildren();
        if (!groups.length) {
            // Silence rather than an empty box: a panel that is always there
            // saying nothing is a panel people stop reading.
            container.hidden = true;
            return groups;
        }
        container.hidden = false;

        const title = document.createElement('h4');
        title.className = 'config-suggestions-title';
        title.textContent = t('config.tagSuggestionsTitle', 'Tag suggestions');
        container.appendChild(title);

        const list = document.createElement('ul');
        list.className = 'config-suggestions-list';
        groups.forEach((group, index) => {
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
        return groups;
    }

    global.ConfigTagSuggestions = { render };
})(window);
