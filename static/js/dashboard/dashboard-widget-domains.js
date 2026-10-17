/**
 * The domains widget: which registrations run out soon, by registered domain.
 *
 * Grouped by the name that is actually registered (example.com), not by host:
 * nas.example.com and www.example.com are one registration and one renewal, so
 * they are one line. The server looks the dates up through RDAP and sends them
 * with the same health response the certificates widget reads.
 *
 * Some registries publish no date at all -- .nl answers and leaves it out, .de
 * and .io have no RDAP -- and a tile that only counted the ones with a date
 * would look like a clean bill of health for the rest. Those domains are named
 * in a quiet group of their own.
 */
(function () {
    'use strict';

    const DAY = 24 * 60 * 60 * 1000;

    function label(dash, key, fallback) {
        const value = dash?.language?.t?.(key);
        return value && value !== key ? value : fallback;
    }

    /**
     * What the last report said about domains.
     *
     * `null` before any report arrived. The summary says whether lookups are on
     * at all, so "off", "nothing yet" and "nothing soon" stay three different
     * sentences.
     */
    function domainsFrom(dash) {
        const facts = window.HealthFacts;
        const summary = facts?.domainSummary || dash.healthReport?.domainSummary || null;
        if (!summary && !dash.healthSummary) return null;
        const map = facts?.domains || dash.healthReport?.domains || {};
        const dated = Object.entries(map).map(([name, entry]) => ({
            domain: String(entry?.domain || name),
            expiry: Number(entry?.expiresAt) || 0,
        })).filter((entry) => entry.expiry > 0);
        return { summary: summary || { enabled: false, watched: 0, noDate: [] }, dated };
    }

    function noDateText(dash, entry) {
        if (entry.state === 'unsupported') {
            const tld = String(entry.domain).split('.').pop();
            return label(dash, 'dashboard.widgetDomainsNoRdap', 'no RDAP for .{tld}').replace('{tld}', tld);
        }
        return label(dash, 'dashboard.widgetDomainsHidden', 'registry shows no date');
    }

    function openFiltered(dash) {
        window.DashboardWidgetUtils?.openHealthFiltered(dash, 'domains');
    }

    function dueRow(dash, entry) {
        const days = Math.floor((entry.expiry - Date.now()) / DAY);
        const row = document.createElement('button');
        row.type = 'button';
        row.className = `dashboard-widget-row dashboard-widget-row--${days <= 7 ? 'bad' : 'warn'}`;

        const name = document.createElement('span');
        name.className = 'dashboard-widget-row-name';
        name.textContent = entry.domain;

        const detail = document.createElement('span');
        detail.className = 'dashboard-widget-row-detail';
        detail.textContent = days < 0
            ? label(dash, 'dashboard.widgetDomainsExpired', 'expired')
            : label(dash, 'dashboard.widgetDomainsDays', '{n}d').replace('{n}', String(days));
        detail.title = new Date(entry.expiry).toLocaleDateString();

        const when = document.createElement('span');
        when.className = 'dashboard-widget-row-detail dashboard-widget-wide-only';
        when.textContent = new Date(entry.expiry).toLocaleDateString();

        row.append(name, detail, when);
        window.DashboardWidgetUtils?.bindRowAction(row, dash, {
            labelKey: 'widgetActionOpenHealth',
            labelFallback: 'Open in Bookmarks',
            run: () => openFiltered(dash),
        });
        return row;
    }

    function noDateRow(dash, entry) {
        const row = document.createElement('div');
        row.className = 'dashboard-widget-row dashboard-widget-row--quiet';
        const name = document.createElement('span');
        name.className = 'dashboard-widget-row-name';
        name.textContent = entry.domain;
        const detail = document.createElement('span');
        detail.className = 'dashboard-widget-row-detail';
        detail.textContent = noDateText(dash, entry);
        row.append(name, detail);
        return row;
    }

    function windowed(data, withinDays) {
        const cutoff = Date.now() + withinDays * DAY;
        return data.dated.filter((entry) => entry.expiry <= cutoff).sort((a, b) => a.expiry - b.expiry);
    }

    /**
     * The group the certificates widget can add under its hosts: the domains
     * inside the same window, as rows, or null when there is nothing to add.
     */
    function appendGroup(wrap, dash, { withinDays, rows }) {
        const data = domainsFrom(dash);
        if (!data || !data.summary.enabled) return;
        const due = windowed(data, withinDays);
        if (!due.length) return;
        const utils = window.DashboardWidgetUtils;
        const heading = document.createElement('p');
        heading.className = 'dashboard-widget-group-label';
        heading.textContent = label(dash, 'dashboard.widgetDomainsGroup', 'Domains');
        wrap.appendChild(heading);
        const list = utils?.rowList?.() || document.createElement('div');
        if (!list.className) list.className = 'dashboard-widget-rows dashboard-widget-rows--pairs';
        due.slice(0, rows).forEach((entry) => list.appendChild(dueRow(dash, entry)));
        utils?.appendOverflowRow?.(list, dash, due.length - rows, () => openFiltered(dash));
        wrap.appendChild(list);
    }

    function render(body, widget, dash) {
        const utils = window.DashboardWidgetUtils;
        const wrap = utils?.panel ? utils.panel(body) : (body.replaceChildren(), body);
        const note = (className, text) => {
            const p = document.createElement('p');
            p.className = className;
            p.textContent = text;
            wrap.appendChild(p);
        };

        const data = domainsFrom(dash);
        if (!data) {
            note('dashboard-widget-waiting', label(dash, 'dashboard.widgetDomainsWaiting', 'Checking…'));
            return;
        }
        if (!data.summary.enabled) {
            note('dashboard-widget-empty', label(dash, 'dashboard.widgetDomainsOff',
                'Domain expiry is off. Turn it on under Config → Monitoring.'));
            return;
        }
        if (!data.summary.watched) {
            note('dashboard-widget-empty', label(dash, 'dashboard.widgetDomainsNone',
                'No domains looked up yet. They appear once a checked bookmark has one.'));
            return;
        }

        const config = widget?.config || {};
        const withinDays = Math.min(Math.max(Number(config.withinDays) || 60, 1), 730);
        const rows = Math.min(Math.max(Number(config.rows) || 5, 1), 20);
        const due = windowed(data, withinDays);
        const noDate = Array.isArray(data.summary.noDate) ? data.summary.noDate : [];

        if (!due.length) {
            note('dashboard-widget-empty', label(dash, 'dashboard.widgetDomainsEmpty',
                'No domain expires within {n} days.').replace('{n}', String(withinDays)));
        } else {
            const urgent = due.filter((entry) => entry.expiry - Date.now() <= 7 * DAY).length;
            const summary = utils?.statGrid?.([
                {
                    value: String(urgent),
                    label: label(dash, 'dashboard.widgetDomainsUrgentLabel', 'within a week'),
                    tone: urgent > 0 ? 'bad' : undefined,
                },
                { value: String(due.length), label: label(dash, 'dashboard.widgetDomainsWindowLabel', 'in the window') },
                { value: String(data.summary.watched), label: label(dash, 'dashboard.widgetDomainsWatchedLabel', 'looked up') },
            ]);
            if (summary) {
                summary.classList.add('dashboard-widget-wide-only');
                wrap.appendChild(summary);
            }
            const list = utils?.rowList?.() || document.createElement('div');
            if (!list.className) list.className = 'dashboard-widget-rows dashboard-widget-rows--pairs';
            due.slice(0, rows).forEach((entry) => list.appendChild(dueRow(dash, entry)));
            utils?.appendOverflowRow?.(list, dash, due.length - rows, () => openFiltered(dash));
            wrap.appendChild(list);
        }

        if (noDate.length) {
            const heading = document.createElement('p');
            heading.className = 'dashboard-widget-group-label';
            heading.textContent = label(dash, 'dashboard.widgetDomainsNoDateGroup', 'No expiry date available');
            wrap.appendChild(heading);
            const list = utils?.rowList?.() || document.createElement('div');
            if (!list.className) list.className = 'dashboard-widget-rows';
            noDate.slice(0, 3).forEach((entry) => list.appendChild(noDateRow(dash, entry)));
            if (noDate.length > 3) {
                const more = document.createElement('p');
                more.className = 'dashboard-widget-empty';
                more.textContent = label(dash, 'dashboard.widgetDomainsNoDateMore', '+{n} more').replace('{n}', String(noDate.length - 3));
                list.appendChild(more);
            }
            wrap.appendChild(list);
        }
    }

    window.DashboardWidgets = window.DashboardWidgets || {};
    window.DashboardWidgets.domains = render;
    window.DashboardWidgetDomains = { appendGroup };
})();
