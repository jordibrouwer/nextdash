/**
 * Which addresses are a video, and where that video's player lives.
 *
 * Read from the address alone, so a row knows before any preview has been
 * fetched: the badge has to be there the moment the grid draws, and a
 * bookmark carries no field saying "this plays". The cost of that choice is
 * that a page which happens to hold a video without saying so in its address
 * gets no badge — which is the right way round, since a wrong badge is worse
 * than a missing one.
 *
 * The player address is built here too, for the case oEmbed cannot cover: a
 * preview stored before the server asked for oEmbed at all carries no
 * embedHtml, and a provider is free to stop advertising it. Every address this
 * returns points at a host the page's own frame-src already admits (see
 * security.go) — nothing here can widen that boundary.
 */
(function (global) {
    'use strict';

    /** The bare id from a path like /watch, /embed/<id> or /<id>. */
    function lastSegment(pathname) {
        const parts = String(pathname || '').split('/').filter(Boolean);
        return parts.length ? parts[parts.length - 1] : '';
    }

    function parse(url) {
        try {
            return new URL(String(url || ''), global.location?.href || 'https://localhost/');
        } catch (_error) {
            return null;
        }
    }

    /** The host without www., lowercased, for matching. */
    function hostOf(parsed) {
        return String(parsed?.hostname || '').replace(/^www\./i, '').toLowerCase();
    }

    /*
     * A file that is a video by its own extension.
     *
     * Kept apart from the providers: these need no player built for them, the
     * browser plays them, and they are the case a self-hoster hits most —
     * a recording on their own server behind Caddy.
     */
    function isVideoFile(parsed) {
        return /\.(mp4|webm|ogv|mov|m4v)$/i.test(String(parsed?.pathname || ''));
    }

    /**
     * Where this address's player lives, or '' when it has none.
     *
     * youtube-nocookie rather than youtube.com: the player is the same, and it
     * does not write a cookie before anything has been played. Both hosts are
     * in frame-src, so either would render.
     */
    function videoEmbedSource(url) {
        const parsed = parse(url);
        if (!parsed || parsed.protocol !== 'https:') return '';
        const host = hostOf(parsed);

        if (host === 'youtu.be') {
            const id = lastSegment(parsed.pathname);
            return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}` : '';
        }
        if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
            // /watch?v=…, /shorts/…, /live/… and /embed/… all name one video;
            // a channel or a search does not, and gets nothing.
            const id = parsed.searchParams.get('v')
                || (/^\/(shorts|live|embed)\//.test(parsed.pathname) ? lastSegment(parsed.pathname) : '');
            return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}` : '';
        }
        if (host === 'vimeo.com' || host === 'player.vimeo.com') {
            // Numbers only: vimeo.com/channels/staff is a channel, not a film.
            const id = lastSegment(parsed.pathname);
            return /^\d+$/.test(id) ? `https://player.vimeo.com/video/${id}` : '';
        }
        if (host === 'dailymotion.com' || host === 'dai.ly') {
            const id = host === 'dai.ly' ? lastSegment(parsed.pathname)
                : (/^\/video\//.test(parsed.pathname) ? lastSegment(parsed.pathname) : '');
            return id ? `https://www.dailymotion.com/embed/video/${encodeURIComponent(id)}` : '';
        }
        return '';
    }

    /**
     * Whether opening this bookmark means watching something.
     *
     * A provider page with a player, or a video file served directly. The
     * badge and the card's play button both ask this, so they can never
     * disagree about what counts.
     */
    function isVideoLink(url) {
        const parsed = parse(url);
        if (!parsed) return false;
        if (isVideoFile(parsed)) return true;
        if (videoEmbedSource(url) !== '') return true;
        // Twitch has a player, but its address needs the parent domain the
        // page is served from -- which a dashboard on a LAN address cannot
        // promise. It is a video link all the same, so it gets the badge and
        // opens in its own tab rather than in the card.
        const host = hostOf(parsed);
        return (host === 'twitch.tv' || host === 'm.twitch.tv')
            && /^\/(videos|clips)\//.test(parsed.pathname);
    }

    global.VideoLinks = { isVideoLink, videoEmbedSource, isVideoFile: (url) => isVideoFile(parse(url)) };
}(window));
