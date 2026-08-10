/**
 * Shared script loading for the lazy view loaders.
 *
 * Three stubs — inbox, health and config — each fetch a heavy module on first
 * use. Inbox and health carried near-identical copies of the loading logic, and
 * config carried a shorter one that was missing two of its guards. That gap was
 * a real hang: config attached `load`/`error` listeners to an existing <script>
 * without first checking whether the module had already registered. A tag that
 * finished loading before the listener was attached fires neither event again,
 * so the promise never settled — and because the loader caches that promise,
 * every later attempt to open config waited on the same dead promise. No error,
 * no retry, the button simply stopped responding.
 *
 * The fix belongs here rather than in the third copy: one implementation means
 * the guards cannot drift apart again.
 *
 * Readiness is asked of the caller rather than inferred from the filename. The
 * old copies matched on substrings, which is why the health loader needed a
 * comment warning that "dashboard-health-multi-select.js" also matches the test
 * for "dashboard-health.js" and therefore had to be checked first. An explicit
 * predicate has no such ordering trap.
 */
(function (global) {
    // A script tag can be in the document and still not have run — deferred,
    // async, or simply mid-parse. When that happens there is no event left to
    // wait for, so readiness is polled per frame instead. The cap keeps a
    // module that loads but never registers its global from hanging forever;
    // at roughly one frame each this is a short wait, not a real timeout.
    const READY_POLL_FRAMES = 40;

    /** Hashed URL for an asset path, falling back to the unhashed one. */
    function assetURL(rel) {
        return (global.NEXTDASH_ASSETS && global.NEXTDASH_ASSETS[rel])
            || `/static/${rel}`;
    }

    /**
     * Load a script once and resolve when `isReady()` reports its exports are
     * registered.
     *
     * Safe to call concurrently and repeatedly: an already-registered module
     * resolves without touching the DOM, and an in-flight tag is waited on
     * rather than duplicated.
     *
     * @param {string} rel        asset path, e.g. 'js/dashboard/dashboard-health.js'
     * @param {string} datasetKey data-* marker identifying this script's tag
     * @param {() => boolean} isReady true once the module's globals exist
     */
    function loadScriptOnce(rel, datasetKey, isReady) {
        const ready = typeof isReady === 'function' ? isReady : () => true;

        return new Promise((resolve, reject) => {
            // Checked before anything else: on a warm call the module is already
            // there and no DOM work is needed at all.
            if (ready()) {
                resolve();
                return;
            }

            const waitForReady = () => {
                if (ready()) {
                    resolve();
                    return;
                }
                let attempts = 0;
                const tick = () => {
                    if (ready()) {
                        resolve();
                        return;
                    }
                    if (attempts >= READY_POLL_FRAMES) {
                        reject(new Error(`${rel} loaded without registering exports`));
                        return;
                    }
                    attempts += 1;
                    global.requestAnimationFrame(tick);
                };
                tick();
            };

            const existing = document.querySelector(`script[data-${datasetKey}]`);
            if (existing) {
                // The tag may already have run, in which case its load event is
                // long gone. Poll rather than listen — listening alone is what
                // used to hang config permanently.
                existing.addEventListener('load', waitForReady, { once: true });
                existing.addEventListener(
                    'error',
                    () => reject(new Error(`${rel} failed to load`)),
                    { once: true }
                );
                waitForReady();
                return;
            }

            const script = document.createElement('script');
            script.src = assetURL(rel);
            script.async = true;
            script.dataset[datasetKey] = 'true';
            script.onload = waitForReady;
            script.onerror = () => reject(new Error(`${rel} failed to load`));
            document.head.appendChild(script);
        });
    }

    /**
     * Install the stub's placeholder Escape handler.
     *
     * All three loaders need the same thing: while the module is not loaded,
     * Escape is watched here, and the moment the module exists the key is handed
     * over to it — the module's own handler knows about modals, inline edit and
     * search, which this one cannot judge. Capture phase, so the stub sees the
     * key before anything downstream.
     *
     * `onWhileLoading` is the only part that differed between the copies: health
     * closes its half-open view, inbox and config simply stand aside. Omitting it
     * keeps the original "do nothing until loaded" behaviour.
     *
     * @param {object} stub with `_escapeHandler`, `isActiveView()` and `instance`
     * @param {(e: KeyboardEvent) => void} [onWhileLoading] runs when Escape is
     *        pressed before the module has loaded
     */
    function bindStubEscape(stub, onWhileLoading) {
        unbindStubEscape(stub);
        stub._escapeHandler = (e) => {
            if (e.key !== 'Escape') return;
            if (!stub.isActiveView()) return;
            if (!stub.instance) {
                if (onWhileLoading) onWhileLoading(e);
                return;
            }
            // Hand the key over, then step aside. Order matters: the module has
            // to be listening before this handler stops.
            stub.instance.setupEscapeShortcut?.();
            unbindStubEscape(stub);
        };
        document.addEventListener('keydown', stub._escapeHandler, true);
    }

    /** Remove the stub's Escape handler, if one is installed. */
    function unbindStubEscape(stub) {
        if (stub._escapeHandler) {
            document.removeEventListener('keydown', stub._escapeHandler, true);
            stub._escapeHandler = null;
        }
    }

    global.LazyScript = { assetURL, loadScriptOnce, bindStubEscape, unbindStubEscape };
}(typeof window !== 'undefined' ? window : globalThis));
