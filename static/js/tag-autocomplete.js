/**
 * TagAutocomplete
 * Dropdown autocomplete for comma-separated tag inputs.
 *
 * Usage:
 *   TagAutocomplete.attach(inputEl, () => ['work', 'dev', 'personal']);
 *   TagAutocomplete.detach(inputEl);
 */
class TagAutocomplete {
    /**
     * @param {HTMLInputElement} input
     * @param {() => string[]} getTagsFn
     */
    constructor(input, getTagsFn) {
        this._input = input;
        this._getTagsFn = getTagsFn;
        this._dropdown = null;
        this._activeIndex = -1;

        this._onInput = this._handleInput.bind(this);
        this._onKeydown = this._handleKeydown.bind(this);
        this._onBlur = this._handleBlur.bind(this);
        this._onScroll = this._reposition.bind(this);

        input.addEventListener('input', this._onInput);
        input.addEventListener('keydown', this._onKeydown);
        input.addEventListener('blur', this._onBlur);
        input.addEventListener('focus', this._onInput);
    }

    // ── Public ────────────────────────────────────────────────────────────────

    static attach(input, getTagsFn) {
        TagAutocomplete.detach(input);
        input._tagAutocomplete = new TagAutocomplete(input, getTagsFn);
    }

    static detach(input) {
        if (input._tagAutocomplete) {
            input._tagAutocomplete._destroy();
            delete input._tagAutocomplete;
        }
    }

    // ── Event handlers ────────────────────────────────────────────────────────

    _handleInput() {
        const token = this._currentToken();
        if (!token) { this._close(); return; }

        const known = (this._getTagsFn() || []).map(t => t.toLowerCase());
        const used = this._usedTags();
        const candidates = known.filter(t =>
            t.startsWith(token) && t !== token && !used.includes(t)
        ).sort((a, b) => a.localeCompare(b)).slice(0, 8);

        if (candidates.length === 0) { this._close(); return; }
        this._open(candidates, token);
    }

    _handleKeydown(e) {
        if (!this._dropdown) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            this._activeIndex = Math.min(this._activeIndex + 1, this._items().length - 1);
            this._highlightActive();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this._activeIndex = Math.max(this._activeIndex - 1, 0);
            this._highlightActive();
        } else if (e.key === 'Tab' || e.key === 'Enter') {
            const items = this._items();
            const target = items[this._activeIndex] ?? items[0];
            if (target) {
                e.preventDefault();
                this._accept(target.dataset.tag);
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            this._close();
        }
    }

    _handleBlur() {
        // Delay so a mousedown on a dropdown item fires before close
        setTimeout(() => this._close(), 120);
    }

    // ── Dropdown ──────────────────────────────────────────────────────────────

    _open(candidates, token) {
        if (!this._dropdown) {
            this._dropdown = document.createElement('ul');
            this._dropdown.className = 'tag-ac-dropdown';
            this._dropdown.setAttribute('role', 'listbox');
            document.body.appendChild(this._dropdown);
            window.addEventListener('scroll', this._onScroll, true);
        }

        this._dropdown.innerHTML = '';
        this._activeIndex = 0;

        candidates.forEach((tag, i) => {
            const li = document.createElement('li');
            li.className = 'tag-ac-item' + (i === 0 ? ' tag-ac-item-active' : '');
            li.setAttribute('role', 'option');
            li.dataset.tag = tag;

            // Bold the matching prefix
            const bold = document.createElement('strong');
            bold.textContent = tag.slice(0, token.length);
            const rest = document.createTextNode(tag.slice(token.length));
            li.appendChild(bold);
            li.appendChild(rest);

            li.addEventListener('mousedown', (e) => {
                e.preventDefault(); // keep focus on input
                this._accept(tag);
            });
            this._dropdown.appendChild(li);
        });

        this._reposition();
    }

    _reposition() {
        if (!this._dropdown) return;
        const rect = this._input.getBoundingClientRect();
        this._dropdown.style.left = rect.left + 'px';
        this._dropdown.style.top = rect.bottom + 'px';
        this._dropdown.style.width = rect.width + 'px';
    }

    _close() {
        if (this._dropdown) {
            this._dropdown.remove();
            this._dropdown = null;
            window.removeEventListener('scroll', this._onScroll, true);
        }
        this._activeIndex = -1;
    }

    _items() {
        return this._dropdown ? [...this._dropdown.querySelectorAll('.tag-ac-item')] : [];
    }

    _highlightActive() {
        this._items().forEach((li, i) => {
            li.classList.toggle('tag-ac-item-active', i === this._activeIndex);
        });
    }

    _accept(tag) {
        const val = this._input.value;
        const lastComma = val.lastIndexOf(',');
        const prefix = lastComma >= 0 ? val.slice(0, lastComma + 1) + ' ' : '';
        const prevParts = prefix.split(',').map(t => t.trim()).filter(Boolean);
        prevParts.push(tag);
        this._input.value = prevParts.join(', ') + ', ';
        this._input.selectionStart = this._input.selectionEnd = this._input.value.length;
        this._close();
        this._input.dispatchEvent(new Event('input', { bubbles: true }));
        this._input.focus();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    _currentToken() {
        const val = this._input.value;
        const lastComma = val.lastIndexOf(',');
        const raw = lastComma >= 0 ? val.slice(lastComma + 1) : val;
        return raw.trimStart().toLowerCase();
    }

    _usedTags() {
        const val = this._input.value;
        const lastComma = val.lastIndexOf(',');
        const prefix = lastComma >= 0 ? val.slice(0, lastComma) : '';
        return prefix.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    }

    // ── Cleanup ───────────────────────────────────────────────────────────────

    _destroy() {
        this._input.removeEventListener('input', this._onInput);
        this._input.removeEventListener('keydown', this._onKeydown);
        this._input.removeEventListener('blur', this._onBlur);
        this._input.removeEventListener('focus', this._onInput);
        this._close();
    }
}

window.TagAutocomplete = TagAutocomplete;
