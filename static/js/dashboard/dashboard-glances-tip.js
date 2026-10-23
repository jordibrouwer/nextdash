/**
 * Page 0: the hover card.
 *
 * Point at a number, a bar, a row or a graph and a small card says more about
 * it: the parts of a figure, the device behind a mount, the sensors in a group,
 * the reading under the pointer on a graph. The same card shows when a
 * focusable element gets the keyboard focus, and goes on Escape.
 *
 * The page redraws its blocks every beat, so the card is not tied to an
 * element. Elements carry a key (data-glances-tip) and the section that drew
 * them registers how to build its card under that key on every draw; the card
 * follows the key, so it stays put and refreshes its numbers while you hold the
 * pointer on one row instead of flickering away with each redraw.
 */
(function () {
    'use strict';

    const SHOW_DELAY = 180;

    class GlancesTip {
        constructor(view) {
            this.view = view;
            /** key -> () => Node | string | null, rebuilt by every draw. */
            this.builders = new Map();
            this.card = null;
            this.activeKey = null;
            this.pointer = { x: 0, y: 0 };
            this._timer = null;
            this._onOver = (e) => this._over(e);
            this._onMove = (e) => this._move(e);
            this._onOut = (e) => this._out(e);
            this._onFocus = (e) => this._focus(e);
            this._onBlur = () => this.hide();
            this._onKey = (e) => { if (e.key === 'Escape' && this.card) this.hide(); };
            this._onScroll = () => this.hide();
        }

        /** Listen on the page's host element, for the life of the view. */
        bind(host) {
            this.unbind();
            this.host = host;
            host.addEventListener('pointerover', this._onOver);
            host.addEventListener('pointermove', this._onMove);
            host.addEventListener('pointerout', this._onOut);
            host.addEventListener('focusin', this._onFocus);
            host.addEventListener('focusout', this._onBlur);
            document.addEventListener('keydown', this._onKey, true);
            window.addEventListener('scroll', this._onScroll, true);
        }

        unbind() {
            if (this.host) {
                this.host.removeEventListener('pointerover', this._onOver);
                this.host.removeEventListener('pointermove', this._onMove);
                this.host.removeEventListener('pointerout', this._onOut);
                this.host.removeEventListener('focusin', this._onFocus);
                this.host.removeEventListener('focusout', this._onBlur);
            }
            document.removeEventListener('keydown', this._onKey, true);
            window.removeEventListener('scroll', this._onScroll, true);
            this.host = null;
            this.hide();
        }

        /** A draw starts: forget the old builders. */
        reset() {
            this.builders = new Map();
        }

        /** Give an element a card: its key, and how to build it. */
        attach(el, key, build) {
            el.setAttribute('data-glances-tip', key);
            this.builders.set(key, build);
        }

        /** A draw ended: a card that is up follows its key, or goes if the key is gone. */
        refresh() {
            // A card for a point on a graph has no key: it stays while the pointer is on a graph.
            if (this.card && !this.activeKey) {
                const under = document.elementFromPoint(this.pointer.x, this.pointer.y);
                if (!under?.closest?.('[data-glances-plot]')) this.hide();
                return;
            }
            if (!this.card || !this.activeKey) return;
            const build = this.builders.get(this.activeKey);
            if (!build) {
                this.hide();
                return;
            }
            this._fill(build);
        }

        _target(e) {
            return e.target?.closest?.('[data-glances-tip]') || null;
        }

        _over(e) {
            if (e.pointerType === 'touch') return;
            const target = this._target(e);
            if (!target) return;
            const key = target.getAttribute('data-glances-tip');
            if (key === this.activeKey && this.card) return;
            this.pointer = { x: e.clientX, y: e.clientY };
            this._schedule(key);
        }

        _move(e) {
            this.pointer = { x: e.clientX, y: e.clientY };
            if (this.card) this._place();
        }

        _out(e) {
            const to = e.relatedTarget?.closest?.('[data-glances-tip]');
            if (to && to.getAttribute('data-glances-tip') === this.activeKey) return;
            if (this._target(e)) this.hide();
        }

        _focus(e) {
            const target = this._target(e);
            if (!target) return;
            const rect = target.getBoundingClientRect();
            this.pointer = { x: rect.left + Math.min(rect.width, 40), y: rect.bottom };
            this._schedule(target.getAttribute('data-glances-tip'), 0);
        }

        _schedule(key, delay = SHOW_DELAY) {
            clearTimeout(this._timer);
            this.activeKey = key;
            this._timer = setTimeout(() => {
                const build = this.builders.get(key);
                if (!build) return;
                this._ensure();
                this._fill(build);
            }, delay);
        }

        _ensure() {
            if (this.card) return;
            this.card = document.createElement('div');
            this.card.className = 'glances-tip';
            this.card.setAttribute('role', 'tooltip');
            document.body.appendChild(this.card);
        }

        _fill(build) {
            let content = null;
            try {
                content = build();
            } catch (err) {
                console.error('Glances card failed to build', err);
            }
            if (!content) {
                this.hide();
                return;
            }
            this.card.replaceChildren(typeof content === 'string' ? document.createTextNode(content) : content);
            this._place();
        }

        /** Show a card for something that is not an element (a point on a graph). */
        showAt(content, x, y) {
            clearTimeout(this._timer);
            this.activeKey = null;
            this.pointer = { x, y };
            this._ensure();
            this.card.replaceChildren(content);
            this._place();
        }

        _place() {
            const card = this.card;
            if (!card) return;
            const margin = 12;
            const { x, y } = this.pointer;
            const width = card.offsetWidth;
            const height = card.offsetHeight;
            let left = x + 16;
            let top = y + 18;
            if (left + width + margin > window.innerWidth) left = Math.max(margin, x - width - 16);
            if (top + height + margin > window.innerHeight) top = Math.max(margin, y - height - 14);
            card.style.left = `${Math.round(left)}px`;
            card.style.top = `${Math.round(top)}px`;
        }

        hide() {
            clearTimeout(this._timer);
            this.activeKey = null;
            if (this.card) {
                this.card.remove();
                this.card = null;
            }
        }

        /* ── The cards' own markup ─────────────────────────────────────── */

        /** A title and rows of label/value, the shape most cards have. */
        static rows(title, rows, note) {
            const wrap = document.createElement('div');
            wrap.className = 'glances-tip-body';
            if (title) {
                const head = document.createElement('p');
                head.className = 'glances-tip-title';
                head.textContent = title;
                wrap.appendChild(head);
            }
            const list = document.createElement('dl');
            list.className = 'glances-tip-rows';
            rows.filter((r) => r && r[1] !== null && r[1] !== undefined && r[1] !== '').forEach(([label, value]) => {
                const row = document.createElement('div');
                const dt = document.createElement('dt');
                dt.textContent = label;
                const dd = document.createElement('dd');
                dd.textContent = String(value);
                row.append(dt, dd);
                list.appendChild(row);
            });
            wrap.appendChild(list);
            if (note) {
                const p = document.createElement('p');
                p.className = 'glances-tip-note';
                p.textContent = note;
                wrap.appendChild(p);
            }
            return wrap;
        }
    }

    /*
     * Cards from a row of Glances' own answer: a spec says which fields to show,
     * under which words and how to print them. A field the host did not send is
     * left out, never shown as 0.
     */
    const KINDS = {
        text: (v) => (typeof v === 'string' || typeof v === 'number' ? String(v) : ''),
        num: (v) => { const n = window.DashboardGlances.num(v); return n === null ? '' : String(Math.round(n * 100) / 100); },
        pct: (v) => { const n = window.DashboardGlances.num(v); return n === null ? '' : `${Math.round(n * 10) / 10}%`; },
        bytes: (v) => { const n = window.DashboardGlances.num(v); return n === null ? '' : window.DashboardGlances.formatBytes(n); },
        rate: (v) => { const n = window.DashboardGlances.num(v); return n === null ? '' : `${window.DashboardGlances.formatBytes(n)}/s`; },
        hz: (v) => { const n = window.DashboardGlances.num(v); return n === null ? '' : `${(n / 1e9).toFixed(2)} GHz`; },
        seconds: (v) => {
            const n = window.DashboardGlances.num(v);
            if (n === null) return '';
            const days = Math.floor(n / 86400);
            const hours = Math.floor((n % 86400) / 3600);
            const minutes = Math.floor((n % 3600) / 60);
            return days ? `${days}d ${hours}h` : (hours ? `${hours}h ${minutes}m` : `${minutes}m`);
        },
        epoch: (v) => { const n = window.DashboardGlances.num(v); return n === null || n <= 0 ? '' : new Date(n * 1000).toLocaleString(); },
        iso: (v) => { const t = typeof v === 'string' ? Date.parse(v) : NaN; return Number.isFinite(t) ? new Date(t).toLocaleString() : ''; },
        list: (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' || typeof x === 'number').join(', ') : ''),
    };

    function pick(obj, dotted) {
        return String(dotted).split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
    }

    /** spec: [[[labelKey, fallback], 'path.in.row', 'kind'], ...]; `view` words the labels. */
    GlancesTip.describe = function describe(view, title, obj, spec, note) {
        const rows = spec.map(([label, key, kind]) => [view.t(label[0], label[1]), (KINDS[kind] || KINDS.text)(pick(obj || {}, key))]);
        return GlancesTip.rows(title, rows, note);
    };

    /** A pair for a row built by hand: label words, a ready value. */
    GlancesTip.pair = function pair(view, label, value) {
        return [view.t(label[0], label[1]), value];
    };

    window.DashboardGlancesTip = GlancesTip;
}());
