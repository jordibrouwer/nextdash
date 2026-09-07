'use strict';

/**
 * The chrome shared by the list views: a sticky header, a rail carrying summary
 * figures and filters, one toolbar row, and a body the view repaints.
 *
 * The split matters more than the markup. A view rebuilding its whole container
 * on every keystroke has to put the caret back by hand; a view that repaints
 * only `handle.body` does not.
 */
class ListViewShell {
    static mount(container, config = {}) {
        if (!container) {
            throw new Error('ListViewShell.mount needs a container');
        }
        const id = String(config.id || 'view');

        const root = document.createElement('div');
        root.className = 'lvs';

        const header = document.createElement('div');
        header.className = 'lvs-header';
        const headerText = document.createElement('div');
        headerText.className = 'lvs-header-text';
        const title = document.createElement('h2');
        title.className = 'lvs-title';
        title.textContent = String(config.title || '');
        const description = document.createElement('p');
        description.className = 'lvs-description';
        description.textContent = String(config.description || '');
        headerText.append(title, description);
        const headerActions = document.createElement('div');
        headerActions.className = 'lvs-header-actions';
        header.append(headerText, headerActions);

        const rail = document.createElement('div');
        rail.className = 'lvs-rail';

        const main = document.createElement('div');
        main.className = 'lvs-main';
        const toolbar = document.createElement('div');
        toolbar.className = 'lvs-toolbar';
        // The view owns the slot, not the row: it fills its slot with
        // innerHTML, and shell-owned controls beside it must survive that.
        const toolbarSlot = document.createElement('div');
        toolbarSlot.className = 'lvs-toolbar-slot';
        toolbar.appendChild(toolbarSlot);
        const body = document.createElement('div');
        body.className = 'lvs-body';
        main.append(toolbar, body);

        root.append(header, rail, main);
        container.appendChild(root);
        container.classList.add('lvs-host');
        container.setAttribute('data-lvs-id', id);

        return {
            id,
            root,
            header,
            headerActions,
            rail,
            toolbarRow: toolbar,
            toolbar: toolbarSlot,
            body,
            destroy() {
                root.remove();
                container.classList.remove('lvs-host');
                container.removeAttribute('data-lvs-id');
            },
        };
    }
}

window.ListViewShell = ListViewShell;
