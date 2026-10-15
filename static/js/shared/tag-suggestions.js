/**
 * What tags a bookmark could take, worked out from the ones you already gave
 * its neighbours.
 *
 * Pure on purpose: items in, groups out, no DOM and no knowledge of how the
 * app stores a bookmark. That is what lets the same rules run in the config
 * panel, on the dashboard, and — if the browser extension ever wants them —
 * in Go, without three implementations drifting apart.
 */
(function (global) {
    'use strict';

    const DEFAULTS = { minGroup: 3, minShare: 0.6, maxPerBookmark: 2 };

    /*
     * How many of a page's own words have to land on one subject.
     *
     * Two, not one. A single shared word is a coincidence often enough to be
     * worthless -- "charts" belongs to finance and to music, "python" to code
     * and to wildlife -- and a wrong tag offered on one word's evidence is
     * worse than no row at all, because the reader has to work out why it is
     * there before they can refuse it.
     */
    const MIN_KEYWORD_HITS = 2;

    /*
     * The pseudo-pattern a page-text row carries where the others carry a host.
     *
     * These rows are grouped by subject across sites, so there is no host to
     * name. It is a real string rather than an empty one because it is half of
     * the key a refusal is stored under, and it is written in the shape
     * sanitizeDismissedTagSuggestions accepts.
     */
    const TEXT_PATTERN = 'page-text';
    const EMPTY = new Set();

    /*
     * A URL becomes at most two patterns: the host, and the host with its
     * FIRST path segment. One domain often carries several subjects -- a
     * site's /docs is not its /blog -- and the first segment is usually where
     * that difference lives. Anything deeper is a page rather than a subject.
     *
     * This is the whole vocabulary: nothing below the first segment is ever
     * emitted, so nothing below it can ever be matched. sanitizeTagRules() in
     * internal/app/handlers.go refuses to store a rule the shape of which this
     * function cannot produce.
     */
    function patternsFor(url) {
        let parsed;
        try {
            parsed = new URL(String(url || ''));
        } catch (error) {
            return [];
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return [];
        const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
        if (!host) return [];
        const segment = parsed.pathname.split('/').filter(Boolean)[0];
        return segment ? [host, `${host}/${segment.toLowerCase()}`] : [host];
    }

    function tagsOf(item) {
        return Array.isArray(item.tags)
            ? item.tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean)
            : [];
    }

    /** Every item that a pattern covers, keyed by that pattern. */
    function groupByPattern(items, patternsOf) {
        const byPattern = new Map();
        items.forEach((item) => {
            (patternsOf.get(item) || []).forEach((pattern) => {
                const bucket = byPattern.get(pattern) || [];
                bucket.push(item);
                byPattern.set(pattern, bucket);
            });
        });
        return byPattern;
    }

    /*
     * The tag a group agrees on, or nothing.
     *
     * The share is counted over the *tagged* members rather than all of them:
     * a host where three of thirty carry #code still says something about the
     * three, and demanding a majority of thirty would silence every group that
     * has only begun to be tagged.
     *
     * But the share alone let the thinnest evidence produce the widest row:
     * two bookmarks of thirty carrying #todo agreed unanimously, and offered
     * #todo to the other twenty-eight. So the tag has to appear on at least
     * minEvidence bookmarks before it counts as something the group agreed on
     * -- the same three the empty panel asks the reader for.
     */
    function dominantTag(members, minShare, minEvidence) {
        const counts = new Map();
        let tagged = 0;
        members.forEach((item) => {
            const tags = tagsOf(item);
            if (!tags.length) return;
            tagged += 1;
            new Set(tags).forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1));
        });
        if (tagged < 2) return null;
        let best = null;
        counts.forEach((count, tag) => {
            if (!best || count > best.have) best = { tag, have: count };
        });
        if (!best || best.have < minEvidence) return null;
        if (best.have / tagged < minShare) return null;
        return { tag: best.tag, have: best.have, of: tagged };
    }

    /*
     * host -> [{tag, aliases, exact}], built once per call.
     *
     * The catalogue ships as a list of subjects, each naming the sites that
     * belong to it; matching goes the other way, so it is turned inside out
     * here rather than scanned per bookmark.
     *
     * A host may sit under two subjects -- duckduckgo.com is a search engine
     * and a privacy tool -- and a bookmark has room for two suggestions, so
     * both are kept. A host written "=google.com" is exact: it answers for
     * itself and lends nothing to its subdomains.
     *
     * A host written "~drawio.com" was looked up online for this collection
     * (TagCatalogue, internal/app/tag_lookup.go) rather than shipped. It is
     * exact too -- it was asked about by name -- and its proposals say where
     * they came from, with Wikidata's description of the site beside them.
     */
    function aliasesOf(entry) {
        return (Array.isArray(entry?.aliases) ? entry.aliases : [])
            .map((alias) => String(alias).trim().toLowerCase())
            .filter(Boolean);
    }

    /*
     * Each subject's ancestors, nearest first, as { tag, aliases }.
     *
     * The catalogue is a tree: premier-league sits under soccer, soccer
     * under sports. A fine subject is only worth offering to a reader who
     * files that finely; whoever tags everything #soccer should be offered
     * #soccer. The walk stops at a subject it has seen, so a cycle written
     * into the file by mistake ends the chain rather than the page.
     */
    function ancestryOf(catalogue) {
        const bySubject = new Map();
        (Array.isArray(catalogue) ? catalogue : []).forEach((entry) => {
            const tag = String(entry?.tag || '').trim().toLowerCase();
            if (tag) bySubject.set(tag, entry);
        });
        const chains = new Map();
        bySubject.forEach((entry, tag) => {
            const chain = [];
            const seen = new Set([tag]);
            let parent = String(entry?.parent || '').trim().toLowerCase();
            while (parent && !seen.has(parent) && bySubject.has(parent)) {
                seen.add(parent);
                const above = bySubject.get(parent);
                chain.push({ tag: parent, aliases: aliasesOf(above) });
                parent = String(above?.parent || '').trim().toLowerCase();
            }
            chains.set(tag, chain);
        });
        return chains;
    }

    function catalogueByHost(catalogue, chains = ancestryOf(catalogue)) {
        const byHost = new Map();
        (Array.isArray(catalogue) ? catalogue : []).forEach((entry) => {
            const tag = String(entry?.tag || '').trim().toLowerCase();
            if (!tag) return;
            const aliases = aliasesOf(entry);
            const ancestors = chains.get(tag) || [];
            (Array.isArray(entry?.hosts) ? entry.hosts : []).forEach((host) => {
                const written = String(host).trim().toLowerCase();
                const online = written.startsWith('~');
                const exact = online || written.startsWith('=');
                const key = written.replace(/^[=~]/, '').replace(/^www\./, '');
                if (!key) return;
                const about = online ? String(entry?.about?.[key] || '') : '';
                const list = byHost.get(key) || [];
                if (!list.some((known) => known.tag === tag)) list.push({ tag, aliases, ancestors, exact, online, about });
                byHost.set(key, list);
            });
        });
        return byHost;
    }

    /*
     * The catalogue's entries for a host, or for the nearest parent that has
     * any it lends out.
     *
     * The file names sites by their registrable domain; a bookmark is often on
     * a subdomain of it -- docs.docker.com, wiki.archlinux.org -- and the
     * subdomain says nothing the domain did not. Walks from the most specific
     * suffix up and stops at two labels, so a bare TLD is never tried. Returns
     * the key it matched on, so the caller can group on the site the catalogue
     * knows rather than on every subdomain of it.
     *
     * But not every domain speaks for its subdomains: google.com is a search
     * engine and mail.google.com is not. An exact entry is passed over on a
     * parent, and the walk goes on up. The server's resolve() in
     * internal/app/tag_catalogue.go walks the same way.
     */
    function lookupHost(byHost, host) {
        const labels = host.split('.');
        for (let i = 0; i <= labels.length - 2; i++) {
            const key = labels.slice(i).join('.');
            const entries = (byHost.get(key) || []).filter((entry) => i === 0 || !entry.exact);
            if (entries.length) return { key, entries };
        }
        return null;
    }

    /*
     * Where a self-hosted app lives: an address of its own network.
     *
     * Private IPv4 ranges (and 100.64/10, which Tailscale hands out), the
     * loopback, IPv6 local addresses, a bare name with no dot (`sonarr`, as a
     * container network resolves it) and the suffixes home networks use. A
     * port or an everyday word is only evidence on one of these.
     */
    const PRIVATE_SUFFIXES = ['.local', '.lan', '.home', '.home.arpa', '.internal', '.localdomain',
        '.intranet', '.ts.net', '.box', '.test'];

    function isPrivateHost(host) {
        if (!host) return false;
        if (host === 'localhost' || !host.includes('.')) return true;
        if (host.startsWith('[')) {
            const v6 = host.slice(1, -1);
            return v6 === '::1' || /^f[cd]/.test(v6) || v6.startsWith('fe80');
        }
        const ip = host.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
        if (ip) {
            const [a, b] = [Number(ip[1]), Number(ip[2])];
            return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)
                || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254);
        }
        return PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix));
    }

    /** The last two labels: jellyfin.example.cc -> example.cc. Rough, and only used to group a reader's own hosts. */
    function siteOf(host) {
        return String(host || '').split('.').slice(-2).join('.');
    }

    /*
     * Domains the reader's own apps live under: two or more different apps
     * recognised on subdomains of one public domain (jellyfin.example.cc,
     * seerr.example.cc) make it a home address, so the rest of what sits
     * there is matched as if it were on the home network.
     */
    function homeDomainsOf(rows, index) {
        const appsBySite = new Map();
        rows.forEach((item) => {
            const found = matchApp(item, index);
            if (!found || found.via !== 'label') return;
            let host = '';
            try {
                host = new URL(String(item.url)).hostname.toLowerCase();
            } catch (error) {
                return;
            }
            if (isPrivateHost(host) || host.split('.').length < 3) return;
            const site = siteOf(host);
            const apps = appsBySite.get(site) || new Set();
            apps.add(found.app.id);
            appsBySite.set(site, apps);
        });
        return new Set([...appsBySite].filter(([, apps]) => apps.size >= 2).map(([site]) => site));
    }

    /** On the home network, or under a domain the reader's own apps live on. */
    function isHomeAddress(url, homeDomains) {
        let parsed;
        try {
            parsed = new URL(String(url || ''));
        } catch (error) {
            return false;
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
        const host = parsed.hostname.toLowerCase();
        return isPrivateHost(host) || !!homeDomains?.has(siteOf(host));
    }

    /** Lower case, every run of non-letters a space, padded: whole words compare. */
    function asWords(text) {
        return ` ${String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
    }

    /*
     * The app list (internal/app/tag_apps.json) made ready to match.
     *
     * A port is only worth something when it says one thing: 5055 is
     * Overseerr and Jellyseerr alike, which tag the same, so it stays; 9091 is
     * Transmission and Authelia, which do not, so it says nothing.
     */
    const appIndexes = new WeakMap();

    function appIndex(apps) {
        const source = Array.isArray(apps) ? apps : [];
        const cached = appIndexes.get(source);
        if (cached) return cached;
        const list = source.map((app) => {
            const names = (app.names || []).map(asWords).filter((name) => name.trim());
            const nameWords = new Set(names.map((name) => name.trim().replace(/ /g, '')));
            return {
                id: String(app.id || ''),
                app: String(app.app || app.id || ''),
                tags: (app.tags || []).map((tag) => String(tag).trim().toLowerCase()).filter(Boolean).slice(0, 2),
                names,
                labels: new Set((app.labels || []).map((label) => String(label).toLowerCase())),
                nameWords,
                ports: new Set((app.ports || []).map(Number)),
                common: !!app.common,
            };
        }).filter((app) => app.id && app.tags.length);
        const byPort = new Map();
        list.forEach((app) => app.ports.forEach((port) => {
            const owners = byPort.get(port) || [];
            owners.push(app);
            byPort.set(port, owners);
        }));
        const portOwner = new Map();
        byPort.forEach((owners, port) => {
            const tags = owners[0].tags.join('|');
            if (owners.every((owner) => owner.tags.join('|') === tags)) portOwner.set(port, owners[0]);
        });
        /*
         * Labels by owner, the first in the list winning: the hand list comes
         * first, the generated long tail after. A label with no dash is also
         * a word the app goes by -- `adguard-1` on an IP is AdGuard -- but
         * only at home, where it is the bookmark's own name that says so.
         */
        const labelOwner = new Map();
        list.forEach((app) => app.labels.forEach((label) => {
            if (!labelOwner.has(label)) labelOwner.set(label, app);
        }));
        const index = { list, portOwner, labelOwner };
        appIndexes.set(source, index);
        return index;
    }

    /*
     * Which app a bookmark is, and by what: { app, via } or null.
     *
     * The host's first label first (sonarr.home.lan), then a whole word in
     * the name or the page title, then the port. On a public host a label
     * only counts when it is the app's own name -- `cloud.google.com` is not
     * Nextcloud for having `cloud` up front -- and an app whose name is an
     * everyday word (Flood, Element) is only taken at home.
     */
    function matchApp(item, index, homeDomains) {
        let parsed;
        try {
            parsed = new URL(String(item.url || ''));
        } catch (error) {
            return null;
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
        const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
        const home = isPrivateHost(host) || !!homeDomains?.has(siteOf(host));
        const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith('[');
        const label = isIp ? '' : host.split('.')[0];
        const text = asWords(`${item.name || ''} ${item.title || ''}`);

        if (label) {
            const byLabel = index.labelOwner.get(label);
            if (byLabel && (home || (!byLabel.common && byLabel.nameWords.has(label)))) return { app: byLabel, via: 'label' };
        }
        if (text.trim()) {
            const byName = index.list.find((app) => (home || !app.common)
                && app.names.some((name) => text.includes(name)));
            if (byName) return { app: byName, via: 'name' };
            if (home) {
                const word = text.trim().split(' ').find((w) => w.length >= 4 && index.labelOwner.has(w));
                if (word) return { app: index.labelOwner.get(word), via: 'name' };
            }
        }
        if (home && parsed.port) {
            const byPort = index.portOwner.get(Number(parsed.port));
            if (byPort) return { app: byPort, via: 'port' };
        }
        return null;
    }

    /*
     * Your word for the catalogue's subject, if you have one.
     *
     * The catalogue supplies the subject; the reader's own tags supply the
     * name. If it says `dev` and every GitHub link here is already tagged
     * #code, the suggestion is #code -- otherwise a shipped vocabulary splits
     * a tidy collection into two tags for one thing. The tag itself wins over
     * an alias when the reader uses both.
     *
     * Then up the tree: a reader who has no word for premier-league but tags
     * #soccer (or #futbol, soccer's alias) is offered that, the nearest
     * ancestor first. Only with no word anywhere on the chain does the
     * subject's own tag stand.
     */
    function inTheirWords(entry, vocabulary) {
        for (const subject of [entry, ...(entry.ancestors || [])]) {
            if (vocabulary.has(subject.tag)) return subject.tag;
            const known = subject.aliases.find((alias) => vocabulary.has(alias));
            if (known) return known;
        }
        return entry.tag;
    }

    /*
     * Proposals, most specific first.
     *
     * A rule is something you wrote down, so it outranks a pattern the app
     * merely noticed; and within what it noticed, host-plus-segment outranks
     * the bare host, because the narrower group is the better guess.
     *
     * Rank decides who wins a conflict, not what the reader sees first: the
     * rendered order is by group size at the bottom of this function, so a
     * 45-item host does not sit under a 3-item segment merely for being less
     * specific.
     */
    function suggest(items, options) {
        const settings = { ...DEFAULTS, ...(options || {}) };
        const rows = Array.isArray(items) ? items.filter((item) => item && item.key && item.url) : [];
        const proposals = [];

        // Parsed once per item rather than once per item per rule: this used to
        // re-parse every URL inside the rule loop, which is the whole cost of
        // suggest() on a large collection with a real rule list behind it.
        const patternsOf = new Map();
        rows.forEach((item) => patternsOf.set(item, patternsFor(item.url)));

        (settings.rules || []).forEach((rule) => {
            const tag = String(rule.tag || '').trim().toLowerCase();
            const pattern = String(rule.pattern || '').trim().toLowerCase();
            if (!tag || !pattern) return;
            const keys = rows
                .filter((item) => (patternsOf.get(item) || []).includes(pattern) && !tagsOf(item).includes(tag))
                .map((item) => item.key);
            if (keys.length) {
                proposals.push({ tag, pattern, reason: { kind: 'rule' }, keys, rank: 0 });
            }
        });

        groupByPattern(rows, patternsOf).forEach((members, pattern) => {
            if (members.length < settings.minGroup) return;
            const found = dominantTag(members, settings.minShare, settings.minGroup);
            if (!found) return;
            const keys = members
                .filter((item) => !tagsOf(item).includes(found.tag))
                .map((item) => item.key);
            if (!keys.length) return;
            proposals.push({
                tag: found.tag,
                pattern,
                reason: { kind: 'derived', have: found.have, of: found.of },
                keys,
                rank: pattern.includes('/') ? 1 : 2,
            });
        });

        /*
         * The catalogue, by host.
         *
         * No minimum group here: the evidence is the shipped file, not the
         * collection, so a single bookmark on a known site is as good a match
         * as forty. Grouping still happens by host, so the reader gets one row
         * covering a site rather than one row per bookmark. Only bare hosts
         * are looked up -- the catalogue names sites, not sections.
         *
         * And it says nothing about a host the collection has already settled.
         * Renaming through the aliases only helps when the two words are
         * related: a reader who files every github.com link under #work would
         * otherwise be offered #dev on all of them, which is the shipped
         * vocabulary splitting a tidy collection in two -- the exact thing the
         * aliases exist to prevent.
         */
        const chains = ancestryOf(settings.catalogue);

        /*
         * Apps, by name.
         *
         * A self-hosted app sits at an address of its own -- an IP, a name on
         * the home network -- that no catalogue can list, so it is known by
         * what it is called instead (matchApp). Grouped per app, so all three
         * Sonarrs are one row and one refusal. After what the reader wrote
         * and did, before the catalogue: a recognised app is better evidence
         * than its host.
         */
        const apps = appIndex(settings.apps || settings.catalogue?.apps);
        if (apps.list.length) {
            const subjectOf = new Map((Array.isArray(settings.catalogue) ? settings.catalogue : [])
                .map((entry) => [String(entry?.tag || '').trim().toLowerCase(), entry]));
            const vocabulary = new Set();
            rows.forEach((item) => tagsOf(item).forEach((tag) => vocabulary.add(tag)));
            const byApp = new Map();
            const homeDomains = homeDomainsOf(rows, apps);
            const atHome = [];
            rows.forEach((item) => {
                const found = matchApp(item, apps, homeDomains);
                if (!found) {
                    if (isHomeAddress(item.url, homeDomains)) atHome.push(item);
                    return;
                }
                const group = byApp.get(found.app.id) || { app: found.app, via: found.via, members: [] };
                group.members.push(item);
                byApp.set(found.app.id, group);
            });
            byApp.forEach(({ app, via, members }) => {
                app.tags.forEach((subject) => {
                    const entry = { tag: subject, aliases: aliasesOf(subjectOf.get(subject)), ancestors: chains.get(subject) || [] };
                    const tag = inTheirWords(entry, vocabulary);
                    const keys = members.filter((item) => !tagsOf(item).includes(tag)).map((item) => item.key);
                    if (!keys.length) return;
                    proposals.push({
                        tag,
                        pattern: `app:${app.id}`,
                        reason: { kind: 'app', app: app.app, subject, via },
                        keys,
                        rank: 2.5,
                    });
                });
            });
            /*
             * Anything else at a home address is still the reader's own
             * server, whatever runs there: one row offers #self-hosted for
             * all of it. Only when the catalogue has the subject.
             */
            if (atHome.length && subjectOf.has('self-hosted')) {
                const entry = { tag: 'self-hosted', aliases: aliasesOf(subjectOf.get('self-hosted')), ancestors: chains.get('self-hosted') || [] };
                const tag = inTheirWords(entry, vocabulary);
                const keys = atHome.filter((item) => !tagsOf(item).includes(tag)).map((item) => item.key);
                if (keys.length) {
                    proposals.push({ tag, pattern: 'home:', reason: { kind: 'home', subject: 'self-hosted' }, keys, rank: 2.6 });
                }
            }
        }

        const byHost = catalogueByHost(settings.catalogue, chains);
        if (byHost.size) {
            const settled = new Set(proposals
                .filter((proposal) => proposal.reason.kind === 'derived')
                .map((proposal) => proposal.pattern));
            const vocabulary = new Set();
            rows.forEach((item) => tagsOf(item).forEach((tag) => vocabulary.add(tag)));
            // Grouped by the catalogue's site, not the bookmark's host: a
            // docs.docker.com link and a docker.com link are one row.
            const bySite = new Map();
            const groups = groupByPattern(rows, patternsOf);
            /*
             * A section of a site first: youtube.com/@veritasium is science
             * while youtube.com is video. The catalogue names such a section
             * as host plus first segment, the second pattern patternsFor
             * gives; a bookmark it answers for is not asked about its host.
             */
            const bySection = new Set();
            groups.forEach((members, pattern) => {
                if (!pattern.includes('/') || settled.has(pattern)) return;
                const entries = byHost.get(pattern);
                if (!entries?.length) return;
                bySite.set(pattern, { entries, members: [...members] });
                members.forEach((item) => bySection.add(item.key));
            });
            groups.forEach((members, pattern) => {
                if (pattern.includes('/')) return;
                if (settled.has(pattern)) return;
                const rest = members.filter((item) => !bySection.has(item.key));
                if (!rest.length) return;
                const found = lookupHost(byHost, pattern);
                if (!found || settled.has(found.key)) return;
                const site = bySite.get(found.key) || { entries: found.entries, members: [] };
                site.members.push(...rest);
                bySite.set(found.key, site);
            });
            bySite.forEach(({ entries, members }, pattern) => {
                entries.forEach((entry) => {
                    const tag = inTheirWords(entry, vocabulary);
                    const keys = members
                        .filter((item) => !tagsOf(item).includes(tag))
                        .map((item) => item.key);
                    if (!keys.length) return;
                    proposals.push({
                        tag,
                        pattern,
                        reason: entry.online
                            ? { kind: 'online', subject: entry.tag, about: entry.about }
                            : { kind: 'catalogue', subject: entry.tag },
                        keys,
                        // A lookup is weaker evidence than the shipped file:
                        // after it, before the page's own words.
                        rank: entry.online ? 3.5 : 3,
                    });
                });
            });
        }

        /*
         * The catalogue, by what the page said about itself.
         *
         * The last source, and the only one that needed a network round to
         * become possible: these are the bookmarks on sites the catalogue has
         * never heard of, so the host says nothing and the collection says
         * nothing either. What is left is the page's own vocabulary, read
         * once by the scan round and stored as a dozen words.
         *
         * Only for bookmarks the first three sources could not reach. A
         * bookmark that already has a proposal has one from better evidence --
         * something the reader wrote, or did, or a site the catalogue knows by
         * name -- and page text is the guess of last resort, not a second
         * opinion.
         *
         * Grouped by subject rather than by host, because that is the shape
         * this evidence has: the nine bookmarks that mention kubernetes are on
         * nine different sites, and a row per site would be nine rows saying
         * the same thing.
         */
        if (settings.keywords) {
            const spokenFor = new Set();
            proposals.forEach((proposal) => proposal.keys.forEach((key) => spokenFor.add(key)));
            const vocabulary = new Set();
            rows.forEach((item) => tagsOf(item).forEach((tag) => vocabulary.add(tag)));

        /*
         * A page that names the subject outright counts double.
         *
         * The catalogue's keywords are the vocabulary *around* a subject --
         * "kubelet", "etcd" -- and two of them agreeing is the floor. But a
         * page whose own words include the subject's name, or a word the
         * reader uses for it, has said what it is rather than hinted: drawio
         * writes "diagramming" in its h1, and waiting for a second word there
         * would be pedantry. So a name is worth the whole floor on its own,
         * and two hints are worth the same.
         */
            const bySubject = new Map();
            (Array.isArray(settings.catalogue) ? settings.catalogue : []).forEach((entry) => {
                const tag = String(entry?.tag || '').trim().toLowerCase();
                const words = (Array.isArray(entry?.keywords) ? entry.keywords : [])
                    .map((word) => String(word).trim().toLowerCase())
                    .filter(Boolean);
                const names = new Set([tag, ...(Array.isArray(entry?.aliases) ? entry.aliases : [])
                    .map((alias) => String(alias).trim().toLowerCase())].filter(Boolean));
                if (tag && (words.length || names.size)) {
                    bySubject.set(tag, {
                        entry: { tag, aliases: aliasesOf(entry), ancestors: chains.get(tag) || [] },
                        words: new Set(words),
                        names,
                    });
                }
            });

            const byTag = new Map();
            rows.forEach((item) => {
                if (spokenFor.has(item.key)) return;
                const found = (settings.keywords[item.key] || [])
                    .map((word) => String(word).trim().toLowerCase())
                    .filter(Boolean);
                if (!found.length) return;

                let best = null;
                bySubject.forEach(({ entry, words, names }, tag) => {
                    const distinct = [...new Set(found)];
                    const named = distinct.filter((word) => names.has(word));
                    const hinted = distinct.filter((word) => words.has(word));
                    // One shared hint is a coincidence often enough to be
                    // worthless: "charts" is finance and it is also music. A
                    // name is not a hint, so it carries the floor by itself.
                    const score = named.length * MIN_KEYWORD_HITS + hinted.length;
                    if (score < MIN_KEYWORD_HITS) return;
                    const hits = [...new Set([...named, ...hinted])];
                    if (!best || score > best.score) best = { entry, tag, hits, score };
                });
                if (!best) return;

                const tag = inTheirWords(best.entry, vocabulary);
                if (tagsOf(item).includes(tag)) return;
                const bucket = byTag.get(tag) || { subject: best.entry.tag, keys: [], words: new Set() };
                bucket.keys.push(item.key);
                best.hits.forEach((word) => bucket.words.add(word));
                byTag.set(tag, bucket);
            });

            byTag.forEach((bucket, tag) => {
                proposals.push({
                    tag,
                    pattern: TEXT_PATTERN,
                    reason: {
                        kind: 'text',
                        subject: bucket.subject,
                        words: [...bucket.words].slice(0, 4),
                    },
                    keys: bucket.keys,
                    rank: 4,
                });
            });
        }

        /*
         * What the reader turned down stays down.
         *
         * Dropped before the per-bookmark ceiling rather than after: a
         * dismissed proposal that still consumed one of a bookmark's two slots
         * would hide the proposal the reader might have wanted, which is the
         * opposite of what refusing one is for.
         */
        const refused = new Set((settings.dismissed || [])
            .map((entry) => String(entry).trim().toLowerCase())
            .filter(Boolean));
        /*
         * And per bookmark. A refusal names a site -- "docs.docker.com|containers"
         * when the tag was taken off a bookmark there by hand -- while the
         * proposal that would bring it back may be grouped on another pattern:
         * the catalogue groups on docker.com. So a refusal also holds for every
         * bookmark on that host or below it, whatever the proposal's pattern.
         */
        const hostOf = (item) => (patternsOf.get(item) || [])[0] || '';
        const byItemKey = new Map(rows.map((item) => [item.key, item]));
        const refusedHere = (key, tag) => {
            const host = hostOf(byItemKey.get(key));
            if (!host) return false;
            const labels = host.split('.');
            for (let i = 0; i <= labels.length - 2; i++) {
                if (refused.has(`${labels.slice(i).join('.')}|${tag}`)) return true;
            }
            return false;
        };
        /*
         * And up the tree. Turning #soccer down on a site turns down what sits
         * under it there too: premier-league is soccer said more narrowly, and
         * a split of the catalogue must not bring back what was refused before
         * it under a finer name.
         */
        const refusable = (proposal) => [proposal.tag,
            ...(chains.get(String(proposal.reason?.subject || '')) || []).map((above) => above.tag)];
        const kept = refused.size
            ? proposals
                .filter((proposal) => !refusable(proposal).some((tag) => refused.has(`${proposal.pattern}|${tag}`)))
                .map((proposal) => {
                    const tags = refusable(proposal);
                    return { ...proposal, keys: proposal.keys.filter((key) => !tags.some((tag) => refusedHere(key, tag))) };
                })
                .filter((proposal) => proposal.keys.length)
            : proposals;
        kept.sort((a, b) => a.rank - b.rank || b.keys.length - a.keys.length);

        // The ceiling is per bookmark, not per group: three plausible tags on
        // one link is a review panel nobody finishes reading.
        //
        // And the same tag is offered to a bookmark once, however many
        // proposals arrive at it. A rule that writes down what the collection
        // already says -- {github.com -> code} where every github.com item is
        // tagged code -- produced two rows differing only in their reason, and
        // the pair ate both of the bookmark's two slots, hiding a genuinely
        // different second suggestion. Rules come first in `proposals`, so
        // dropping the later duplicate is what makes the rule win.
        const used = new Map();
        const taken = new Map();
        const groups = [];
        kept.forEach((proposal) => {
            const keys = proposal.keys.filter((key) => !(taken.get(key) || EMPTY).has(proposal.tag)
                && (used.get(key) || 0) < settings.maxPerBookmark);
            if (!keys.length) return;
            keys.forEach((key) => {
                used.set(key, (used.get(key) || 0) + 1);
                const tags = taken.get(key) || new Set();
                tags.add(proposal.tag);
                taken.set(key, tags);
            });
            const { rank, ...group } = proposal;
            groups.push({ ...group, keys });
        });

        // Biggest first: what the reader most wants to accept in one click is
        // the group that saves the most clicks. Sort is stable, so groups of
        // equal size keep the rank order they were resolved in.
        groups.sort((a, b) => b.keys.length - a.keys.length);
        return groups;
    }

    global.TagSuggestions = { patternsFor, suggest, isPrivateHost };
})(window);
