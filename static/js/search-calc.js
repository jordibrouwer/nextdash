/**
 * A calculator for the search panel.
 *
 * Typing `=15% of 240`, `2+2*3` or `5 km in mi` answers on the spot, as the top
 * row of the list; Enter copies the answer. Nothing leaves the browser and
 * nothing is evaluated: the expression is read by a small parser of its own
 * (numbers, + - * / ^ %, brackets), never handed to eval or Function.
 *
 * Nothing says "calculate": what is plainly a sum is answered, and nothing else
 * is. A word or a shortcut never becomes a calculation, and neither does a
 * phrase, range, phone number or date with a dash in it (24/7, 20-30,
 * 06-12345678, 03-11-2026): a sum needs a + * ^ × ÷, a bracket, or a - or / with
 * a space on both sides. A leading = belongs to the assistant, not to this.
 */
(function (global) {
    'use strict';

    class CalcError extends Error {}

    /* ---------- arithmetic ---------- */

    function tokenize(text) {
        const tokens = [];
        const source = text.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/,/g, '');
        let i = 0;
        while (i < source.length) {
            const ch = source[i];
            if (/\s/.test(ch)) { i += 1; continue; }
            if (/[\d.]/.test(ch)) {
                let j = i;
                while (j < source.length && /[\d.]/.test(source[j])) j += 1;
                const raw = source.slice(i, j);
                if ((raw.match(/\./g) || []).length > 1 || raw === '.') throw new CalcError('number');
                tokens.push({ t: 'n', v: Number(raw) });
                i = j;
                continue;
            }
            if ('+-*/^()%'.includes(ch)) { tokens.push({ t: ch }); i += 1; continue; }
            throw new CalcError('character');
        }
        return tokens;
    }

    /** Recursive descent: expr → term (+|- term)*, term → power (*|/ power)*, power → unary (^ power)? */
    function parse(tokens) {
        let at = 0;
        const peek = () => tokens[at];
        const take = (t) => (peek() && peek().t === t ? tokens[at++] : null);

        function primary() {
            const n = take('n');
            if (n) {
                let value = n.v;
                while (take('%')) value /= 100;
                return value;
            }
            if (take('(')) {
                const value = expr();
                if (!take(')')) throw new CalcError('bracket');
                let out = value;
                while (take('%')) out /= 100;
                return out;
            }
            throw new CalcError('operand');
        }
        // -2^2 is -(2^2), as it is on paper and in a spreadsheet; the exponent
        // may carry its own sign (2^-1).
        function unary() {
            if (take('-')) return -unary();
            if (take('+')) return unary();
            return power();
        }
        function power() {
            const base = primary();
            return take('^') ? base ** unary() : base;
        }
        function term() {
            let value = unary();
            for (;;) {
                if (take('*')) value *= unary();
                else if (take('/')) {
                    const divisor = unary();
                    if (divisor === 0) throw new CalcError('zero');
                    value /= divisor;
                } else return value;
            }
        }
        function expr() {
            let value = term();
            for (;;) {
                if (take('+')) value += term();
                else if (take('-')) value -= term();
                else return value;
            }
        }
        const result = expr();
        if (at !== tokens.length) throw new CalcError('trailing');
        return result;
    }

    function arithmetic(text) {
        const value = parse(tokenize(text));
        if (!Number.isFinite(value)) throw new CalcError('range');
        return value;
    }

    /* ---------- units ---------- */

    // Each family counts in its own base unit; a factor is how many bases one unit is.
    const FAMILIES = {
        length: { m: 1, km: 1000, cm: 0.01, mm: 0.001, mi: 1609.344, mile: 1609.344, miles: 1609.344, yd: 0.9144, ft: 0.3048, foot: 0.3048, feet: 0.3048, in: 0.0254, inch: 0.0254, inches: 0.0254 },
        mass: { g: 1, kg: 1000, mg: 0.001, lb: 453.59237, lbs: 453.59237, oz: 28.349523125, t: 1e6 },
        volume: { l: 1, ml: 0.001, cl: 0.01, gal: 3.785411784, qt: 0.946352946, pt: 0.473176473, cup: 0.2365882365, floz: 0.0295735295625 },
        time: { s: 1, sec: 1, min: 60, h: 3600, hr: 3600, hour: 3600, hours: 3600, day: 86400, days: 86400, d: 86400, week: 604800, weeks: 604800 },
        data: { b: 1, kb: 1000, mb: 1e6, gb: 1e9, tb: 1e12, pb: 1e15, kib: 1024, mib: 1048576, gib: 1073741824, tib: 1099511627776 },
        speed: { 'm/s': 1, 'km/h': 1 / 3.6, kmh: 1 / 3.6, mph: 0.44704, kn: 0.514444 },
    };
    const TEMPS = new Set(['c', 'f', 'k', '°c', '°f']);

    function familyOf(unit) {
        for (const [name, table] of Object.entries(FAMILIES)) {
            if (Object.prototype.hasOwnProperty.call(table, unit)) return name;
        }
        return null;
    }

    function convertTemperature(value, from, to) {
        const norm = (u) => u.replace('°', '');
        const f = norm(from);
        const t = norm(to);
        const celsius = f === 'c' ? value : f === 'f' ? (value - 32) * 5 / 9 : value - 273.15;
        if (t === 'c') return celsius;
        if (t === 'f') return celsius * 9 / 5 + 32;
        return celsius + 273.15;
    }

    const UNIT_RE = /^\s*(-?[\d.,]+)\s*([a-z°/]+)\s+(?:in|to|naar|->|as)\s+([a-z°/]+)\s*$/i;

    /** "5 km in mi" → { value, unit } or null when it is not a conversion we know. */
    function convert(text) {
        const m = UNIT_RE.exec(text);
        if (!m) return null;
        const amount = Number(m[1].replace(/,/g, ''));
        if (!Number.isFinite(amount)) return null;
        const from = m[2].toLowerCase();
        const to = m[3].toLowerCase();
        if (TEMPS.has(from) && TEMPS.has(to)) {
            return { value: convertTemperature(amount, from, to), unit: to.replace('°', '').toUpperCase() === 'C' ? '°C' : to.replace('°', '').toUpperCase() === 'F' ? '°F' : 'K' };
        }
        const family = familyOf(from);
        if (!family || family !== familyOf(to)) return null;
        const table = FAMILIES[family];
        return { value: amount * table[from] / table[to], unit: m[3] };
    }

    /* ---------- the door ---------- */

    /** The answer as plain digits, for the clipboard: no grouping, whatever the locale. */
    function plain(value) {
        return String(Number(value.toPrecision(12)));
    }

    function format(value) {
        if (Math.abs(value) >= 1e15 || (Math.abs(value) < 1e-9 && value !== 0)) return value.toExponential(6);
        const rounded = Number(value.toPrecision(12));
        return rounded.toLocaleString(undefined, { maximumFractionDigits: 10 });
    }

    const PERCENT_OF = /^\s*([\d.,]+)\s*%\s*(?:of|van)\s*([\d.,]+)\s*$/i;
    const ARITHMETIC = /^[\d\s.,+\-*/^()%×÷−]+$/;
    /*
     * What counts as a sum when nothing says so.
     *
     * "24/7", "1-2", "20-30", "06-12345678" and "03-11-2026" are a phrase, a
     * range, a phone number and a date: an unspaced - or / between digits is not
     * arithmetic. A sum has a + * ^ × ÷, or a - or / with space on both sides
     * ("12 - 5"), or a bracket.
     */
    function plainlyASum(text) {
        if (/[+*^×÷()]/.test(text)) return /\d/.test(text) && /[+*^×÷]|\)\s*[-/]|[-/]\s*\(/.test(text) || /\([^)]*[+\-*/^][^)]*\)/.test(text);
        return /\d\s+[-/−]\s+[\d.(-]/.test(text);
    }

    const DATE_LIKE = /^\s*\d{4}-\d{1,2}(-\d{1,2})?\s*$/;

    /**
     * What the query answers, or null.
     */
    function evaluate(query) {
        const text = String(query || '');
        // A long line is never a sum, and a deeply bracketed one would only cost
        // the parser its stack.
        if (!text.trim() || text.length > 200) return null;
        try {
            const unit = convert(text);
            if (unit) return { expression: text.trim(), result: `${format(unit.value)} ${unit.unit}`, copy: plain(unit.value) };

            const percent = PERCENT_OF.exec(text);
            if (percent) {
                const value = (Number(percent[1].replace(/,/g, '')) / 100) * Number(percent[2].replace(/,/g, ''));
                if (Number.isFinite(value)) return { expression: text.trim(), result: format(value), copy: plain(value) };
                return null;
            }
            if (!ARITHMETIC.test(text) || !/\d/.test(text) || DATE_LIKE.test(text)) return null;
            if (!plainlyASum(text)) return null;
            const value = arithmetic(text);
            return { expression: text.trim(), result: format(value), copy: plain(value) };
        } catch (_error) {
            // CalcError, or anything the parser could not take: not a sum.
            return null;
        }
    }

    global.SearchCalc = { evaluate, arithmetic, convert, format };
}(typeof window !== 'undefined' ? window : globalThis));
