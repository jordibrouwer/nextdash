/**
 * Config "Stats" tab — two-column insights dashboard.
 * Sections: overview, cleanup score, activity, top bookmarks,
 *           pages, categories, shortcuts, rot & cleanup, conflicts, search & status.
 */
class ConfigStats {
    constructor(t) {
        this.t = typeof t === 'function' ? t : (k) => k;
        this.lastManager = null;
        // Current period (days) per section; 0 = all time
        this.sectionPeriods = { activity: 30, top: 0, pages: 0, categories: 0, rot: 90 };
    }

    // ── helpers ────────────────────────────────────────────────────────────

    yn(val) { return val ? 'yes' : 'no'; }

    setText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    pageName(pages, pageId) {
        const id = Number(pageId);
        const p = pages.find((x) => Number(x.id) === id);
        return p && p.name ? String(p.name) : (Number.isFinite(id) ? `Page ${id}` : '');
    }

    formatWhen(ts, locale) {
        const n = Number(ts);
        if (!n) return '—';
        try {
            return new Date(n).toLocaleString(locale || undefined, { dateStyle: 'short', timeStyle: 'short' });
        } catch (e) { return '—'; }
    }

    clearTable(tbodyId) {
        const tb = document.getElementById(tbodyId);
        if (tb) tb.textContent = '';
    }

    appendRow(tbodyId, cells, opts = {}) {
        const tb = document.getElementById(tbodyId);
        if (!tb) return;
        const tr = document.createElement('tr');
        cells.forEach((content, i) => {
            const td = document.createElement('td');
            if (opts.barCol === i && opts.barPct != null) {
                td.className = 'stats-bar-cell';
                const fill = document.createElement('span');
                fill.className = 'stats-bar-cell-fill';
                fill.style.width = `${opts.barPct}%`;
                const text = document.createElement('span');
                text.className = 'stats-bar-cell-text';
                text.textContent = content;
                td.appendChild(fill);
                td.appendChild(text);
            } else {
                if (opts.rankCol === i) td.className = 'stats-rank';
                td.textContent = content;
            }
            tr.appendChild(td);
        });
        tb.appendChild(tr);
    }

    noData(tbodyId, cols) {
        this.clearTable(tbodyId);
        const tb = document.getElementById(tbodyId);
        if (!tb) return;
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = cols;
        td.textContent = '—';
        td.style.opacity = '0.5';
        tr.appendChild(td);
        tb.appendChild(tr);
    }

    filterByPeriod(bookmarks, days) {
        if (!days) return bookmarks;
        const cutoff = Date.now() - days * 86400000;
        return bookmarks.filter((b) => Number(b?.lastOpened || 0) >= cutoff);
    }

    // ── Period button binding ───────────────────────────────────────────────

    bindPeriodButtons(bookmarks, pages, locale) {
        document.querySelectorAll('.stats-period-bar').forEach((bar) => {
            const section = bar.getAttribute('data-section');
            bar.querySelectorAll('.stats-period-btn').forEach((btn) => {
                const fresh = btn.cloneNode(true);
                btn.replaceWith(fresh);
            });
            bar.querySelectorAll('.stats-period-btn').forEach((btn) => {
                btn.addEventListener('click', () => {
                    bar.querySelectorAll('.stats-period-btn').forEach((b) => b.classList.remove('active'));
                    btn.classList.add('active');
                    const days = Number(btn.getAttribute('data-period'));
                    this.sectionPeriods[section] = days;
                    this.renderSection(section, bookmarks, pages, locale);
                });
            });
        });
    }

    renderSection(section, bookmarks, pages, locale) {
        const days = this.sectionPeriods[section] || 0;
        switch (section) {
            case 'activity':    this.renderActivity(bookmarks, days, locale); break;
            case 'top':         this.renderTopBookmarks(bookmarks, pages, locale, days); break;
            case 'pages':       this.renderPagesBlock(bookmarks, pages, days); break;
            case 'categories':  this.renderCategoriesBlock(bookmarks, pages, days); break;
            case 'rot':         this.renderRotBlock(bookmarks, pages, locale, days); break;
        }
    }

    // ── Scrollspy ──────────────────────────────────────────────────────────

    initScrollspy() {
        const sections = document.querySelectorAll('.stats-content .stats-block[id]');
        const links = document.querySelectorAll('.stats-index-list a');
        if (!sections.length || !links.length || !('IntersectionObserver' in window)) return;

        const obs = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    links.forEach((a) => {
                        a.classList.toggle('is-active', a.getAttribute('href') === `#${entry.target.id}`);
                    });
                }
            });
        }, { rootMargin: '-10% 0px -70% 0px', threshold: 0 });

        sections.forEach((s) => obs.observe(s));
    }

    // ── Overview ───────────────────────────────────────────────────────────

    renderOverview(bookmarks, pages) {
        const withUrl = bookmarks.filter((b) => String(b?.url || '').trim()).length;
        const withSc  = bookmarks.filter((b) => String(b?.shortcut || '').trim()).length;
        const catKeys = new Set();
        bookmarks.forEach((b) => {
            catKeys.add(`${Number(b.pageId)||0}::${String(b.category||'').trim()}`);
        });
        const totalOpens = bookmarks.reduce((s, b) => s + Number(b?.openCount || 0), 0);
        const avg = bookmarks.length > 0 ? Math.round((totalOpens / bookmarks.length) * 10) / 10 : 0;

        this.setText('stats-pages-count',      String(pages.length));
        this.setText('stats-categories-count', String(catKeys.size));
        this.setText('stats-bookmarks-total',  String(bookmarks.length));
        this.setText('stats-with-url',         String(withUrl));
        this.setText('stats-without-url',      String(Math.max(0, bookmarks.length - withUrl)));
        this.setText('stats-with-shortcut',    String(withSc));
        this.setText('stats-without-shortcut', String(Math.max(0, bookmarks.length - withSc)));
        this.setText('stats-avg-opens',        String(avg));
    }

    // ── Info buttons ───────────────────────────────────────────────────────

    bindInfoButtons() {
        const sections = [
            ['stats-overview-info-btn',   'statsInfoOverviewTitle',   'statsInfoOverviewMsg'],
            ['stats-score-info-btn',      'statsInfoScoreTitle',      'statsInfoScoreMsg'],
            ['stats-activity-info-btn',   'statsInfoActivityTitle',   'statsInfoActivityMsg'],
            ['stats-top-info-btn',        'statsInfoTopTitle',        'statsInfoTopMsg'],
            ['stats-pages-info-btn',      'statsInfoPagesTitle',      'statsInfoPagesMsg'],
            ['stats-categories-info-btn', 'statsInfoCategoriesTitle', 'statsInfoCategoriesMsg'],
            ['stats-shortcuts-info-btn',  'statsInfoShortcutsTitle',  'statsInfoShortcutsMsg'],
            ['stats-rot-info-btn',        'statsInfoRotTitle',        'statsInfoRotMsg'],
            ['stats-conflicts-info-btn',  'statsInfoConflictsTitle',  'statsInfoConflictsMsg'],
            ['stats-search-info-btn',     'statsInfoSearchTitle',     'statsInfoSearchMsg'],
        ];
        sections.forEach(([btnId, titleKey, msgKey]) => {
            const btn = document.getElementById(btnId);
            if (!btn) return;
            const fresh = btn.cloneNode(true);
            btn.replaceWith(fresh);
            fresh.addEventListener('click', () => {
                if (!window.AppModal) return;
                window.AppModal.alert({
                    title: this.t(`config.${titleKey}`),
                    htmlMessage: this.t(`config.${msgKey}`).replace(/\n/g, '<br>'),
                    confirmText: this.t('config.gotIt'),
                });
            });
        });
    }

    // ── Cleanup score ──────────────────────────────────────────────────────

    renderCleanupScore(bookmarks) {
        const total = bookmarks.length;
        const el = document.getElementById('stats-score-detail');
        if (!el) return;
        el.textContent = '';

        if (total === 0) {
            this.setText('stats-score-value', '—');
            return;
        }

        const neverOpened = bookmarks.filter(
            (b) => !Number(b?.openCount) && !Number(b?.lastOpened)
        ).length;

        const cutoff90 = Date.now() - 90 * 86400000;
        const stale90  = bookmarks.filter((b) => {
            const lo = Number(b?.lastOpened || 0);
            return lo > 0 && lo < cutoff90;
        }).length;

        const urlMap = new Map();
        bookmarks.forEach((b) => {
            const url = String(b?.url || '').trim().toLowerCase();
            if (url) urlMap.set(url, (urlMap.get(url) || 0) + 1);
        });
        const dupCount = [...urlMap.values()].filter((c) => c > 1).length;

        const scMap = new Map();
        bookmarks.forEach((b) => {
            const sc = String(b?.shortcut || '').trim().toLowerCase();
            if (sc) scMap.set(sc, (scMap.get(sc) || 0) + 1);
        });
        const conflictCount = [...scMap.values()].filter((c) => c > 1).length;

        let score = 100;
        const details = [];

        const neverRatio   = neverOpened / total;
        const neverPenalty = Math.round(Math.min(neverRatio * 50, 25));
        if (neverPenalty > 0) {
            score -= neverPenalty;
            const txt = this.t('config.statsScoreNeverOpened')
                .replace('{count}', neverOpened)
                .replace('{pct}', Math.round(neverRatio * 100));
            details.push({ text: txt, penalty: neverPenalty, type: 'warn' });
        }

        const staleRatio   = stale90 / total;
        const stalePenalty = Math.round(Math.min(staleRatio * 40, 20));
        if (stalePenalty > 0) {
            score -= stalePenalty;
            const txt = this.t('config.statsScoreStale90')
                .replace('{count}', stale90)
                .replace('{pct}', Math.round(staleRatio * 100));
            details.push({ text: txt, penalty: stalePenalty, type: 'warn' });
        }

        if (dupCount > 0) {
            const pen = Math.min(dupCount * 3, 15);
            score -= pen;
            details.push({ text: this.t('config.statsScoreDupUrls').replace('{count}', dupCount), penalty: pen, type: 'bad' });
        }

        if (conflictCount > 0) {
            const pen = Math.min(conflictCount * 5, 10);
            score -= pen;
            details.push({ text: this.t('config.statsScoreConflicts').replace('{count}', conflictCount), penalty: pen, type: 'bad' });
        }

        score = Math.max(0, Math.min(100, score));

        if (details.length === 0) {
            details.push({ text: this.t('config.statsScoreHealthy'), type: 'good' });
        }

        this.setText('stats-score-value', String(score));
        const fill = document.getElementById('stats-score-bar-fill');
        if (fill) fill.style.width = `${score}%`;

        // Score colour via accent-primary fallback; shift to warning/error at low scores
        const scoreEl = document.getElementById('stats-score-value');
        if (scoreEl) {
            scoreEl.style.color = score >= 80
                ? 'var(--accent-success)'
                : score >= 50
                    ? 'var(--accent-warning)'
                    : 'var(--accent-error)';
        }
        const barFill = document.getElementById('stats-score-bar-fill');
        if (barFill) {
            barFill.style.background = score >= 80
                ? 'var(--accent-success)'
                : score >= 50
                    ? 'var(--accent-warning)'
                    : 'var(--accent-error)';
        }

        details.forEach((item) => {
            const li = document.createElement('li');
            li.textContent = item.text;
            if (item.type === 'good') li.classList.add('is-good');
            if (item.type === 'bad')  li.classList.add('is-bad');
            if (item.penalty) {
                const badge = document.createElement('span');
                badge.className = 'stats-score-penalty';
                badge.textContent = `−${item.penalty}`;
                li.appendChild(badge);
            }
            el.appendChild(li);
        });
    }

    // ── Activity sparkline ─────────────────────────────────────────────────

    renderActivity(bookmarks, days, locale) {
        const now = Date.now();

        // Bucket configuration
        let bucketCount, bucketMs, labels;
        let effectiveDays = days;
        if (days === 7) {
            bucketCount = 7; bucketMs = 86400000;
            labels = ['–6d','–5d','–4d','–3d','–2d','–1d','today'];
        } else if (days === 30) {
            bucketCount = 5; bucketMs = 6 * 86400000;
            labels = ['–30d','–24d','–18d','–12d','–6d'];
        } else if (days === 90) {
            bucketCount = 9; bucketMs = 10 * 86400000;
            labels = ['–90d','–80d','–70d','–60d','–50d','–40d','–30d','–20d','–10d'];
        } else if (days === 180) {
            bucketCount = 6; bucketMs = 30 * 86400000;
            labels = ['–6mo','–5mo','–4mo','–3mo','–2mo','–1mo'];
        } else {
            // all time → last 12 months
            bucketCount = 12; bucketMs = 30 * 86400000;
            effectiveDays = 365;
            labels = ['–12mo','–11mo','–10mo','–9mo','–8mo','–7mo','–6mo','–5mo','–4mo','–3mo','–2mo','–1mo'];
        }

        const cutoff = now - effectiveDays * 86400000;
        const buckets = Array(bucketCount).fill(0);

        bookmarks.forEach((b) => {
            const lo = Number(b?.lastOpened || 0);
            if (lo < cutoff) return;
            const age = now - lo;
            const idx = Math.floor(age / bucketMs);
            const bucketIdx = bucketCount - 1 - Math.min(idx, bucketCount - 1);
            buckets[bucketIdx]++;
        });

        const active = bookmarks.filter((b) => Number(b?.lastOpened || 0) >= cutoff).length;
        const totalInPeriod = bookmarks.reduce((s, b) => {
            const lo = Number(b?.lastOpened || 0);
            return lo >= cutoff ? s + Number(b?.openCount || 0) : s;
        }, 0);

        this.setText('stats-activity-total',  String(totalInPeriod));
        this.setText('stats-activity-active', String(active));

        // Render SVG bar chart
        const wrap = document.getElementById('stats-sparkline');
        if (!wrap) return;
        wrap.textContent = '';

        const maxVal = Math.max(...buckets, 1);
        const W = 500, H = 72, gap = 3;
        const barW = Math.floor((W - gap * (bucketCount - 1)) / bucketCount);

        const rects = buckets.map((val, i) => {
            const h = Math.round((val / maxVal) * H);
            const x = i * (barW + gap);
            const y = H - h;
            const opacity = val === 0 ? 0.15 : 0.75 + (val / maxVal) * 0.25;
            return `<rect x="${x}" y="${y}" width="${barW}" height="${Math.max(h, val > 0 ? 2 : 0)}" fill="var(--accent-primary)" opacity="${opacity.toFixed(2)}" rx="1"/>`;
        }).join('');

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
        svg.setAttribute('preserveAspectRatio', 'none');
        svg.setAttribute('height', '72');
        svg.style.cssText = 'display:block;width:100%;';
        svg.innerHTML = rects;
        wrap.appendChild(svg);

        // Labels row
        const labelRow = document.createElement('div');
        labelRow.className = 'stats-sparkline-labels';
        const step = Math.max(1, Math.floor(bucketCount / 5));
        labels.forEach((lbl, i) => {
            const span = document.createElement('span');
            span.textContent = (i % step === 0 || i === bucketCount - 1) ? lbl : '';
            labelRow.appendChild(span);
        });
        wrap.appendChild(labelRow);
    }

    // ── Top bookmarks ──────────────────────────────────────────────────────

    renderTopBookmarks(bookmarks, pages, locale, days) {
        const subset = this.filterByPeriod(bookmarks, days);

        const top = [...subset]
            .filter((b) => Number(b?.openCount || 0) > 0)
            .sort((a, b) => Number(b.openCount || 0) - Number(a.openCount || 0))
            .slice(0, 20);

        this.clearTable('stats-top-opens-body');
        if (top.length === 0) {
            this.noData('stats-top-opens-body', 5);
        } else {
            const maxOpens = Number(top[0]?.openCount || 0);
            top.forEach((b, i) => {
                this.appendRow('stats-top-opens-body', [
                    String(i + 1),
                    String(b.name || '—'),
                    String(Number(b.openCount || 0)),
                    this.pageName(pages, b.pageId),
                    this.formatWhen(b.lastOpened, locale)
                ], { rankCol: 0, barCol: 2, barPct: maxOpens > 0 ? Math.round((Number(b.openCount||0)/maxOpens)*100) : 0 });
            });
        }

        const recent = [...subset]
            .filter((b) => Number(b?.lastOpened || 0) > 0)
            .sort((a, b) => Number(b.lastOpened || 0) - Number(a.lastOpened || 0))
            .slice(0, 20);

        this.clearTable('stats-recent-opens-body');
        if (recent.length === 0) {
            this.noData('stats-recent-opens-body', 4);
        } else {
            recent.forEach((b) => {
                this.appendRow('stats-recent-opens-body', [
                    String(b.name || '—'),
                    String(Number(b.openCount || 0)),
                    this.pageName(pages, b.pageId),
                    this.formatWhen(b.lastOpened, locale)
                ]);
            });
        }
    }

    // ── Pages ──────────────────────────────────────────────────────────────

    renderPagesBlock(bookmarks, pages, days) {
        const tbodyId = 'stats-pages-body';
        this.clearTable(tbodyId);
        if (!bookmarks.length || !pages.length) { this.noData(tbodyId, 4); return; }

        const cutoff = days ? Date.now() - days * 86400000 : 0;

        const map = new Map();
        pages.forEach((p) => map.set(Number(p.id), { name: p.name || `Page ${p.id}`, count: 0, opens: 0, never: 0 }));
        bookmarks.forEach((b) => {
            const pid = Number(b?.pageId) || 0;
            if (!map.has(pid)) return;
            const e = map.get(pid);
            e.count += 1;
            const lo = Number(b?.lastOpened || 0);
            if (!cutoff || lo >= cutoff) e.opens += Number(b?.openCount || 0);
            if (!Number(b?.openCount) && !Number(b?.lastOpened)) e.never += 1;
        });

        const rows = [...map.values()].sort((a, b) => b.opens - a.opens || b.count - a.count);
        const maxOpens = Math.max(...rows.map((r) => r.opens), 1);
        const tbody = document.getElementById(tbodyId);
        if (!tbody) return;

        rows.forEach((row) => {
            const tr = document.createElement('tr');
            // Page name with bar
            const tdName = document.createElement('td');
            tdName.className = 'stats-bar-cell';
            if (row.opens > 0) {
                const fill = document.createElement('span');
                fill.className = 'stats-bar-cell-fill';
                fill.style.width = `${Math.round((row.opens / maxOpens) * 100)}%`;
                tdName.appendChild(fill);
            }
            const lbl = document.createElement('span');
            lbl.className = 'stats-bar-cell-text';
            lbl.textContent = row.name;
            tdName.appendChild(lbl);
            tr.appendChild(tdName);

            [String(row.count), String(row.opens), String(row.never)].forEach((txt) => {
                const td = document.createElement('td');
                td.textContent = txt;
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
    }

    // ── Categories ─────────────────────────────────────────────────────────

    renderCategoriesBlock(bookmarks, pages, days) {
        const tbodyId = 'stats-categories-body';
        this.clearTable(tbodyId);
        if (!bookmarks.length) { this.noData(tbodyId, 4); return; }

        const cutoff = days ? Date.now() - days * 86400000 : 0;
        const map = new Map();
        bookmarks.forEach((b) => {
            const pid = Number(b?.pageId) || 0;
            const cat = String(b?.category || '').trim() || '(uncategorized)';
            const key = `${pid}::${cat}`;
            const e = map.get(key) || { pageId: pid, cat, count: 0, opens: 0 };
            e.count += 1;
            const lo = Number(b?.lastOpened || 0);
            if (!cutoff || lo >= cutoff) e.opens += Number(b?.openCount || 0);
            map.set(key, e);
        });

        const rows = [...map.values()].sort((a, b) => b.opens - a.opens || b.count - a.count);
        const maxOpens = Math.max(...rows.map((r) => r.opens), 1);
        const tbody = document.getElementById(tbodyId);
        if (!tbody) return;

        rows.forEach((row) => {
            const tr = document.createElement('tr');
            const tdCat = document.createElement('td');
            tdCat.className = 'stats-bar-cell';
            if (row.opens > 0) {
                const bar = document.createElement('span');
                bar.className = 'stats-bar-cell-fill';
                bar.style.width = `${Math.round((row.opens / maxOpens) * 100)}%`;
                tdCat.appendChild(bar);
            }
            const lbl = document.createElement('span');
            lbl.className = 'stats-bar-cell-text';
            lbl.textContent = row.cat;
            tdCat.appendChild(lbl);
            tr.appendChild(tdCat);

            [this.pageName(pages, row.pageId), String(row.count), String(row.opens)].forEach((txt) => {
                const td = document.createElement('td');
                td.textContent = txt;
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
    }

    // ── Shortcuts ──────────────────────────────────────────────────────────

    renderShortcutsBlock(bookmarks, pages) {
        const total  = bookmarks.length;
        const withSc = bookmarks.filter((b) => String(b?.shortcut || '').trim());
        const pct    = total > 0 ? Math.round((withSc.length / total) * 100) : 0;

        const fill  = document.getElementById('stats-shortcut-bar-fill');
        const label = document.getElementById('stats-shortcut-bar-label');
        if (fill)  fill.style.width   = `${pct}%`;
        if (label) label.textContent  = this.t('config.statsShortcutCoverage')
            .replace('{count}', withSc.length)
            .replace('{total}', total)
            .replace('{pct}', pct);

        const tbodyId = 'stats-shortcuts-body';
        this.clearTable(tbodyId);
        const top = [...withSc].sort((a, b) => Number(b?.openCount || 0) - Number(a?.openCount || 0)).slice(0, 20);
        if (top.length === 0) { this.noData(tbodyId, 4); return; }
        top.forEach((b) => {
            this.appendRow(tbodyId, [
                String(b.shortcut || '—'),
                String(b.name || '—'),
                String(Number(b.openCount || 0)),
                this.pageName(pages, b.pageId)
            ]);
        });
    }

    // ── Rot & cleanup ──────────────────────────────────────────────────────

    renderRotBlock(bookmarks, pages, locale, days) {
        const now    = Date.now();
        const cutoff = days ? now - days * 86400000 : 0;

        const neverOpened = bookmarks.filter(
            (b) => !Number(b?.openCount) && !Number(b?.lastOpened)
        );
        const stale = cutoff
            ? bookmarks.filter((b) => {
                const lo = Number(b?.lastOpened || 0);
                return lo > 0 && lo < cutoff;
            })
            : [];
        const recentlyAdded = cutoff
            ? bookmarks.filter((b) => {
                const added = Number(b?.addedAt || b?.createdAt || b?.created || b?.added || 0);
                return added > 0 && added >= cutoff;
            })
            : [];

        this.setText('stats-never-opened',      String(neverOpened.length));
        this.setText('stats-stale-count',        String(stale.length));
        this.setText('stats-recently-added-count', String(recentlyAdded.length));

        // Never opened table
        const neverId = 'stats-never-opened-body';
        this.clearTable(neverId);
        if (neverOpened.length === 0) {
            this.noData(neverId, 4);
        } else {
            neverOpened.slice(0, 30).forEach((b) => {
                const added = Number(b?.addedAt || b?.createdAt || b?.created || b?.added || 0);
                this.appendRow(neverId, [
                    String(b.name || '—'),
                    this.pageName(pages, b.pageId),
                    String(b.category || '—'),
                    added ? this.formatWhen(added, locale) : '—'
                ]);
            });
        }

        // Stale table
        const staleId = 'stats-stale-body';
        this.clearTable(staleId);
        if (stale.length === 0) {
            this.noData(staleId, 4);
        } else {
            [...stale]
                .sort((a, b) => Number(a?.lastOpened || 0) - Number(b?.lastOpened || 0))
                .slice(0, 30)
                .forEach((b) => {
                    this.appendRow(staleId, [
                        String(b.name || '—'),
                        this.pageName(pages, b.pageId),
                        String(Number(b.openCount || 0)),
                        this.formatWhen(b.lastOpened, locale)
                    ]);
                });
        }
    }

    // ── Conflicts ──────────────────────────────────────────────────────────

    renderConflictsBlock(bookmarks) {
        const urlMap = new Map();
        bookmarks.forEach((b) => {
            const url = String(b?.url || '').trim().toLowerCase();
            if (url) urlMap.set(url, (urlMap.get(url) || 0) + 1);
        });
        const duplicateUrlCount = [...urlMap.values()].filter((c) => c > 1).length;

        const scMap = new Map();
        bookmarks.forEach((b) => {
            const sc = String(b?.shortcut || '').trim().toLowerCase();
            if (sc) scMap.set(sc, (scMap.get(sc) || 0) + 1);
        });
        const conflicting     = [...scMap.entries()].filter(([, c]) => c > 1);
        const shortcutConflict = conflicting.length;

        this.setText('stats-duplicate-url-count',     String(duplicateUrlCount));
        this.setText('stats-shortcut-conflict-count', String(shortcutConflict));

        const detail = document.getElementById('stats-conflicts-detail');
        if (!detail) return;
        detail.textContent = '';

        if (duplicateUrlCount === 0 && shortcutConflict === 0) {
            const p = document.createElement('p');
            p.className = 'stats-muted';
            p.textContent = this.t('config.statsNoConflictsFound');
            detail.appendChild(p);
            return;
        }

        if (conflicting.length > 0) {
            const p = document.createElement('p');
            p.className = 'stats-muted';
            p.style.marginTop = '0.75rem';
            const labels = conflicting.slice(0, 8).map(([sc, c]) => `${sc} (×${c})`).join(', ');
            const more   = conflicting.length > 8
                ? this.t('config.statsConflictMore').replace('{count}', conflicting.length - 8)
                : '';
            p.textContent = this.t('config.statsConflictingShortcuts')
                .replace('{labels}', labels)
                .replace('{more}', more);
            detail.appendChild(p);
        }
    }

    // ── Search & status ────────────────────────────────────────────────────

    renderSearchStatus(settings, bookmarks) {
        const statusCheckCount = bookmarks.filter((b) => b?.checkStatus === true).length;
        const idxKnown = Object.prototype.hasOwnProperty.call(settings, 'searchIndexed');
        this.setText('stats-search-indexed',    idxKnown ? this.yn(Boolean(settings.searchIndexed)) : '—');
        this.setText('stats-interleave',        this.yn(Boolean(settings.interleaveMode)));
        this.setText('stats-fuzzy',             this.yn(Boolean(settings.enableFuzzySuggestions)));
        this.setText('stats-show-status',       this.yn(Boolean(settings.showStatus)));
        this.setText('stats-status-check-count', String(statusCheckCount));
    }

    // ── Main entry point ───────────────────────────────────────────────────

    refresh(manager) {
        this.lastManager = manager;
        const bookmarks = Array.isArray(manager.allBookmarksData) ? manager.allBookmarksData : [];
        const pages     = Array.isArray(manager.pagesData)        ? manager.pagesData        : [];
        const settings  = manager.settingsData || {};
        const locale    = settings.language || undefined;

        this.renderOverview(bookmarks, pages);
        this.renderCleanupScore(bookmarks);
        this.renderActivity(bookmarks, this.sectionPeriods.activity, locale);
        this.renderTopBookmarks(bookmarks, pages, locale, this.sectionPeriods.top);
        this.renderPagesBlock(bookmarks, pages, this.sectionPeriods.pages);
        this.renderCategoriesBlock(bookmarks, pages, this.sectionPeriods.categories);
        this.renderShortcutsBlock(bookmarks, pages);
        this.renderRotBlock(bookmarks, pages, locale, this.sectionPeriods.rot);
        this.renderConflictsBlock(bookmarks);
        this.renderSearchStatus(settings, bookmarks);

        this.bindPeriodButtons(bookmarks, pages, locale);
        this.bindInfoButtons();
        this.initScrollspy();
    }
}

window.ConfigStats = ConfigStats;
