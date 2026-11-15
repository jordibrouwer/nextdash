/**
 * The Immich widgets: photos, a slideshow, albums, people and the server's state.
 *
 * Four of them are lists of pictures and draw on the shared media tile
 * (dashboard-media-tile.js), which brings the layouts -- the frame and the
 * slideshow among them --, the pictures, the detail card and where a click
 * goes. Immich's own part is its words and what each one asks of the tile:
 * square photos, round faces, the order the server chose.
 *
 * The status tile is not a list; the server sends `result.immich` and this
 * file draws it: the library's size, the disk, the jobs and a line when an
 * update is out. A figure Immich did not tell is left out, never drawn as 0.
 */
(function () {
    'use strict';

    const Tile = window.DashboardMediaTile;
    if (!Tile) return;

    const WORDS = {
        noLibraries: ['dashboard.widgetImmichNoChoice', 'Choose an album or a person in this widget’s settings.'],
        nothing: ['dashboard.widgetImmichNothing', 'No photos to show.'],
        open: ['dashboard.widgetImmichOpen', 'Open in Immich'],
        actionOpen: ['widgetActionImmichOpen', 'Open in Immich'],
    };

    const register = (id, name, extra, words = {}) => {
        const render = Tile.register({ id, name, words: { ...WORDS, ...words }, keepOrder: true, ...extra });
        window.DashboardWidgets = window.DashboardWidgets || {};
        if (render) window.DashboardWidgets[id] = render;
    };

    register('immich', 'Immich', { photos: true, defaultLayout: 'grid' });
    register('immich-slideshow', 'Immich', { photos: true, defaultLayout: 'slides' });
    register('immich-albums', 'Immich', { photos: true, defaultLayout: 'list' }, {
        nothing: ['dashboard.widgetImmichNoAlbums', 'No albums to show.'],
    });
    register('immich-people', 'Immich', { photos: true, round: true, defaultLayout: 'strip' }, {
        nothing: ['dashboard.widgetImmichNoPeople', 'No named people to show.'],
        actionOpen: ['widgetActionImmichPerson', 'Open this person in Immich'],
    });

    /* ---- status ---- */

    const STATUS_WORDS = {
        update: ['dashboard.widgetImmichUpdate', 'Update available: {version}'],
        photos: ['dashboard.widgetImmichFigPhotos', 'photos'],
        videos: ['dashboard.widgetImmichFigVideos', 'videos'],
        usage: ['dashboard.widgetImmichFigUsage', 'stored'],
        disk: ['dashboard.widgetImmichDisk', '{used} of {size}'],
        jobsIdle: ['dashboard.widgetImmichJobsIdle', 'Background jobs are idle.'],
        jobsBusy: ['dashboard.widgetImmichJobsBusy', '{n} jobs waiting or running'],
        jobsFailed: ['dashboard.widgetImmichJobsFailed', '{n} jobs failed'],
        paused: ['dashboard.widgetImmichPaused', 'paused'],
        duplicates: ['dashboard.widgetImmichDuplicates', '{n} duplicates to review'],
        noDuplicates: ['dashboard.widgetImmichNoDuplicates', 'No duplicates found.'],
        partial: ['dashboard.widgetImmichPartial', 'Part of this could not be read just now. It is tried again shortly.'],
        nothing: ['dashboard.widgetImmichStatusNothing', 'Choose what to show in this widget’s settings.'],
        notAdmin: ['dashboard.widgetImmichStatusNeedsAdmin',
            'Immich shares the library totals and the jobs with an administrator’s key only.'],
    };

    // The queues Immich names, as people say them.
    const QUEUES = {
        thumbnailGeneration: ['dashboard.widgetImmichQueueThumbnails', 'Thumbnails'],
        metadataExtraction: ['dashboard.widgetImmichQueueMetadata', 'Metadata'],
        videoConversion: ['dashboard.widgetImmichQueueVideo', 'Video conversion'],
        faceDetection: ['dashboard.widgetImmichQueueFaces', 'Face detection'],
        facialRecognition: ['dashboard.widgetImmichQueueRecognition', 'Face recognition'],
        smartSearch: ['dashboard.widgetImmichQueueSearch', 'Smart search'],
        duplicateDetection: ['dashboard.widgetImmichQueueDuplicates', 'Duplicate detection'],
        backgroundTask: ['dashboard.widgetImmichQueueBackground', 'Background tasks'],
        storageTemplateMigration: ['dashboard.widgetImmichQueueStorage', 'Storage template'],
        migration: ['dashboard.widgetImmichQueueMigration', 'Migration'],
        search: ['dashboard.widgetImmichQueueIndex', 'Search index'],
        sidecar: ['dashboard.widgetImmichQueueSidecar', 'Sidecar files'],
        library: ['dashboard.widgetImmichQueueLibrary', 'Library scan'],
        notifications: ['dashboard.widgetImmichQueueNotifications', 'Notifications'],
        backupDatabase: ['dashboard.widgetImmichQueueBackup', 'Database backup'],
        ocr: ['dashboard.widgetImmichQueueOcr', 'Text recognition'],
        workflow: ['dashboard.widgetImmichQueueWorkflow', 'Workflows'],
        integrityCheck: ['dashboard.widgetImmichQueueIntegrity', 'Integrity check'],
        editor: ['dashboard.widgetImmichQueueEditor', 'Editing'],
    };

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = String(text);
        return node;
    }

    function word(dash, table, key, values = {}) {
        const [i18n, fallback] = table[key] || [key, key];
        const value = dash?.language?.t?.(i18n);
        let text = value && value !== i18n ? value : fallback;
        Object.entries(values).forEach(([k, v]) => { text = text.replace(`{${k}}`, String(v)); });
        return text;
    }

    const number = (value) => new Intl.NumberFormat().format(Number(value) || 0);

    /** A name Immich does not give a word to is split at its capitals. */
    function queueName(dash, name) {
        if (QUEUES[name]) return word(dash, QUEUES, name);
        return String(name).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
    }

    function figure(dash, value, key) {
        const cell = el('span', 'immich-fig');
        cell.append(el('span', 'immich-fig-value', number(value)), el('span', 'immich-fig-label', word(dash, STATUS_WORDS, key)));
        return cell;
    }

    function drawStatus(wrap, dash, widget, _items, result) {
        const s = result.immich;
        // The bell's row for failed jobs reads this answer; tell it there is a new one.
        window.ImmichBellSource?.refresh();
        wrap.classList.add('immich-status');
        if (!s) {
            wrap.appendChild(el('p', 'dashboard-widget-empty', word(dash, STATUS_WORDS, 'nothing')));
            return;
        }
        const head = Tile.itemButton(dash, widget, { id: 'immich', title: 'Immich', openUrl: s.openUrl }, 'immich-status-head');
        head.append(el('span', 'immich-status-name', 'Immich'));
        if (s.version) head.append(el('span', 'immich-status-version', s.version));
        wrap.appendChild(head);

        if (s.update) {
            wrap.appendChild(el('p', 'immich-status-update', word(dash, STATUS_WORDS, 'update', { version: s.update })));
        }

        const topics = Array.isArray(s.topics) ? s.topics : [];
        if (topics.includes('library')) {
            if (s.photos !== undefined || s.videos !== undefined) {
                const row = el('div', 'immich-figs');
                if (s.photos !== undefined) row.appendChild(figure(dash, s.photos, 'photos'));
                if (s.videos !== undefined) row.appendChild(figure(dash, s.videos, 'videos'));
                if (s.usage !== undefined) {
                    const cell = el('span', 'immich-fig');
                    cell.append(el('span', 'immich-fig-value', Tile.formatBytes(s.usage)),
                        el('span', 'immich-fig-label', word(dash, STATUS_WORDS, 'usage')));
                    row.appendChild(cell);
                }
                wrap.appendChild(row);
            }
        }
        if (topics.includes('storage') && s.disk) {
            const line = el('div', 'immich-disk');
            line.appendChild(el('span', 'immich-disk-text', word(dash, STATUS_WORDS, 'disk',
                { used: Tile.formatBytes(s.disk.used), size: Tile.formatBytes(s.disk.size) })));
            const bar = Tile.meterBar(s.disk.pct, 80, 90);
            if (bar) line.appendChild(bar);
            line.appendChild(el('span', 'immich-disk-pct', `${Math.round(s.disk.pct)}%`));
            wrap.appendChild(line);
        }
        if (topics.includes('jobs') && s.jobsRead) {
            const queues = Array.isArray(s.queues) ? s.queues : [];
            const failed = Number(s.failed) || 0;
            const busy = queues.reduce((sum, q) => sum + (Number(q.active) || 0) + (Number(q.waiting) || 0), 0);
            const block = el('div', 'immich-jobs');
            if (failed > 0) {
                block.appendChild(el('p', 'immich-jobs-line immich-jobs-line--bad', word(dash, STATUS_WORDS, 'jobsFailed', { n: number(failed) })));
            } else if (busy > 0) {
                block.appendChild(el('p', 'immich-jobs-line', word(dash, STATUS_WORDS, 'jobsBusy', { n: number(busy) })));
            } else {
                block.appendChild(el('p', 'immich-jobs-line immich-jobs-line--quiet', word(dash, STATUS_WORDS, 'jobsIdle')));
            }
            const list = el('ul', 'immich-queues');
            queues.slice(0, 5).forEach((q) => {
                const item = el('li', q.failed > 0 ? 'immich-queue immich-queue--bad' : 'immich-queue');
                const detail = [];
                if (q.failed > 0) detail.push(`${number(q.failed)} ✗`);
                if (q.active + q.waiting > 0) detail.push(number(q.active + q.waiting));
                if (q.paused) detail.push(word(dash, STATUS_WORDS, 'paused'));
                item.append(el('span', 'immich-queue-name', queueName(dash, q.name)), el('span', 'immich-queue-count', detail.join(' · ')));
                list.appendChild(item);
            });
            if (list.children.length) block.appendChild(list);
            wrap.appendChild(block);
        }
        if (topics.includes('duplicates') && s.duplicates !== undefined) {
            wrap.appendChild(el('p', 'immich-dup', s.duplicates > 0
                ? word(dash, STATUS_WORDS, 'duplicates', { n: number(s.duplicates) })
                : word(dash, STATUS_WORDS, 'noDuplicates')));
        }
        if (s.needsAdmin) wrap.appendChild(el('p', 'media-stale', word(dash, STATUS_WORDS, 'notAdmin')));
        if (s.partial) wrap.appendChild(el('p', 'media-stale', word(dash, STATUS_WORDS, 'partial')));
    }

    register('immich-status', 'Immich', { art: false, draw: drawStatus, minTtl: 30, ttl: 120 });
})();
