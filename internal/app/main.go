package app

import (
	"context"
	"io"
	"io/fs"
	"log"
	"mime"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/gorilla/mux"
)

// The embedded copy of static/, templates/ and locales/, handed in by the
// root package at startup.
//
// The //go:embed directive itself cannot live here: embed patterns are
// relative to the directory of the file that carries them and may not climb
// with "..", so the directive has to sit beside the directories it names — in
// the repository root. Run takes the result rather than this package
// re-declaring it, which keeps the asset set a single source.
var embeddedFiles assetFS

// Run starts the server. It is main() in everything but name; the root package
// holds only the embed directive and calls straight through to here.
func Run(files assetFS) {
	embeddedFiles = files
	// Initialize MIME types
	mime.AddExtensionType(".css", "text/css")
	mime.AddExtensionType(".js", "application/javascript")

	// Content-hashed asset URLs. Must run before any template renders so
	// {{asset "..."}} reads from the same source the /static/ handler serves.
	initAssetHashing(embeddedFiles)

	// Initialize the data store
	if err := validateDataDirAtStartup(); err != nil {
		log.Fatalf("%v", err)
	}
	// Mirror the log to a ring buffer (and a rotating file) for the in-app log
	// viewer. Installed right after the data dir is known and before anything
	// interesting is logged; stderr still receives every line, so `docker logs`
	// is unaffected. It starts paused — settings are not readable until the
	// store exists a few lines down.
	InitServerLog()
	log.SetOutput(io.MultiWriter(os.Stderr, serverLog))

	store := NewStore()
	// Now that settings are readable, start collecting if the user asked for
	// it. Off by default, so a dashboard nobody debugs pays nothing for the
	// viewer and its log stays genuinely empty.
	startupSettings := store.GetSettings()
	// The environment first, then the settings on top of it: NEXTDASH_LOG_LEVEL
	// keeps working for anyone who set it, and a level chosen in the app wins.
	setLogLevel(os.Getenv("NEXTDASH_LOG_LEVEL"))
	applyLogSettings(startupSettings)
	ConfigureServerLog(
		startupSettings.ServerLogEnabled,
		startupSettings.ServerLogRetentionMode,
		startupSettings.ServerLogRetentionHours,
		startupSettings.ServerLogMaxEntries,
	)
	if strings.TrimSpace(os.Getenv("NEXTDASH_DATA_DIR")) != "" {
		logInfo(logComponentServer, "data directory: %s", ResolveDataDir())
	}

	// Expire trashed bookmarks past their 30 days. Retention otherwise rides
	// along with writes, so an instance that was off for a month would keep
	// showing items it should have dropped until the next delete.
	if removed, err := store.PruneTrash(); err != nil {
		logWarn(logComponentStore, "expired trash could not be cleared away (%v); it will be tried again at the next start", err)
	} else if removed > 0 {
		logInfo(logComponentStore, "cleared %s from the trash", plural(removed, "expired item", "expired items"))
	}

	// Initialize handlers
	handlers := NewHandlers(store, embeddedFiles)
	// The sources that reach the network through the handler's own client, so
	// they inherit the SSRF checks and the rate limiting rather than each
	// arranging their own.
	handlers.registerHandlerSources()
	// Same wiring for outgoing deliveries: whether a webhook may reach a local
	// address is this install's setting, not a decision webhooks.go can make on
	// its own.
	handlers.RegisterWebhookDelivery()

	// Create router
	r := mux.NewRouter()

	// Routes
	r.HandleFunc("/version", Version).Methods("GET")
	r.HandleFunc("/manifest.webmanifest", handlers.WebAppManifest).Methods("GET")
	// The address bar as a search box; see opensearch.go.
	r.HandleFunc("/opensearch.xml", handlers.OpenSearchDescription).Methods("GET")
	// Served from the root because a service worker's scope cannot rise above its
	// own path; from /static/ it could not control the dashboard.
	r.HandleFunc("/push-service-worker.js", handlers.PushServiceWorker).Methods("GET")
	r.HandleFunc("/", handlers.Dashboard).Methods("GET")
	r.HandleFunc("/health", handlers.HealthPage).Methods("GET")
	r.HandleFunc("/config", handlers.Config).Methods("GET")
	r.HandleFunc("/colors", handlers.Colors).Methods("GET")
	r.HandleFunc("/api/bookmarks", handlers.GetBookmarks).Methods("GET")
	r.HandleFunc("/api/bookmarks", handlers.SaveBookmarks).Methods("POST")
	r.HandleFunc("/api/bookmarks", handlers.DeleteBookmark).Methods("DELETE")
	r.HandleFunc("/api/bookmarks/add", handlers.AddBookmark).Methods("POST")
	r.HandleFunc("/api/bookmarks/import-browser", handlers.ImportBrowserBookmarks).Methods("POST")
	// The file itself rather than the browser's reading of it, so an import
	// keeps the tags, notes and dates every export has always carried.
	r.HandleFunc("/api/bookmarks/import-html", handlers.ImportBookmarksHTML).Methods("POST")
	r.HandleFunc("/api/bookmarks/export-html", handlers.ExportBookmarksHTML).Methods("GET")
	// The source register: where bookmarks come from, and what the last round
	// did. Every route is behind the write token -- a source can hold one.
	r.HandleFunc("/api/sources", handlers.ListSourcesHandler).Methods("GET", "OPTIONS")
	r.HandleFunc("/api/sources/{id}", handlers.SaveSourceHandler).Methods("PUT", "OPTIONS")
	r.HandleFunc("/api/sources/{id}", handlers.DeleteSourceHandler).Methods("DELETE", "OPTIONS")
	// GET previews, POST imports. Two calls on purpose: a source that writes on
	// the first click is one nobody clicks twice.
	r.HandleFunc("/api/sources/{id}/run", handlers.RunSourceHandler).Methods("GET", "POST", "OPTIONS")
	r.HandleFunc("/api/bookmarks/prefetch-icons", handlers.PrefetchBookmarkIcons).Methods("POST")
	r.HandleFunc("/api/bookmarks/delete-all", handlers.DeleteAllBookmarks).Methods("POST")
	r.HandleFunc("/api/finders", handlers.GetFinders).Methods("GET")
	r.HandleFunc("/api/finders", handlers.SaveFinders).Methods("POST")
	r.HandleFunc("/api/categories", handlers.GetCategories).Methods("GET")
	r.HandleFunc("/api/categories", handlers.SaveCategories).Methods("POST")
	r.HandleFunc("/api/pages", handlers.GetPages).Methods("GET")
	r.HandleFunc("/api/pages", handlers.SavePages).Methods("POST")
	// A page's widgets and the order every block on it is drawn in -- category
	// ids and widget ids in one list, so a widget can sit between categories.
	r.HandleFunc("/api/pages/{id:[0-9]+}/blocks", handlers.GetPageBlocksHandler).Methods("GET", "OPTIONS")
	r.HandleFunc("/api/pages/{id:[0-9]+}/blocks", handlers.SavePageBlocksHandler).Methods("PUT", "OPTIONS")
	r.HandleFunc("/api/data-revision", handlers.GetDataRevision).Methods("GET")
	r.HandleFunc("/static/bundle/dashboard.js", handlers.ServeAssetBundle).Methods("GET")
	r.HandleFunc("/static/bundle/dashboard.css", handlers.ServeAssetBundle).Methods("GET")
	r.HandleFunc("/static/bundle/views.css", handlers.ServeAssetBundle).Methods("GET")
	r.HandleFunc("/static/bundle/search.js", handlers.ServeAssetBundle).Methods("GET")
	r.HandleFunc("/api/app-version", handlers.AppVersion).Methods("GET")
	r.HandleFunc("/api/update-status", handlers.GetUpdateStatus).Methods("GET")
	r.HandleFunc("/api/pages/{id:[0-9]+}", handlers.DeletePage).Methods("DELETE")
	r.HandleFunc("/api/reset", handlers.ResetAllData).Methods("POST")
	r.HandleFunc("/api/settings", handlers.GetSettings).Methods("GET")
	r.HandleFunc("/api/settings", handlers.SaveSettings).Methods("POST")
	r.HandleFunc("/api/favicon", handlers.UploadFavicon).Methods("POST")
	r.HandleFunc("/api/font", handlers.UploadFont).Methods("POST")
	r.HandleFunc("/api/icon", handlers.UploadIcon).Methods("POST")
	r.HandleFunc("/api/icon/from-url", handlers.UploadIconFromURL).Methods("POST")
	r.HandleFunc("/api/colors", handlers.GetColors).Methods("GET")
	r.HandleFunc("/api/colors", handlers.SaveColors).Methods("POST")
	r.HandleFunc("/api/colors/reset", handlers.ResetColors).Methods("POST")
	r.HandleFunc("/api/colors/custom-themes", handlers.GetCustomThemesList).Methods("GET")
	r.HandleFunc("/api/theme.css", handlers.CustomThemeCSS).Methods("GET")
	r.HandleFunc("/api/push/public-key", handlers.PushPublicKey).Methods("GET")
	r.HandleFunc("/api/push/devices", handlers.ListPushDevices).Methods("GET")
	r.HandleFunc("/api/push/subscribe", handlers.SubscribePush).Methods("POST")
	r.HandleFunc("/api/push/unsubscribe", handlers.UnsubscribePush).Methods("POST")
	r.HandleFunc("/api/push/test", handlers.TestPushNotification).Methods("POST")
	r.HandleFunc("/api/backup", handlers.Backup).Methods("GET")
	r.HandleFunc("/api/auto-backups", handlers.ListAutoBackups).Methods("GET")
	r.HandleFunc("/api/auto-backups/download", handlers.DownloadAutoBackup).Methods("GET")
	r.HandleFunc("/api/auto-backups", handlers.DeleteAutoBackup).Methods("DELETE")
	r.HandleFunc("/api/auto-backups/run", handlers.RunAutoBackup).Methods("POST")
	r.HandleFunc("/api/auto-backups/restore", handlers.RestoreAutoBackup).Methods("POST")
	r.HandleFunc("/api/logs", handlers.GetServerLog).Methods("GET")
	r.HandleFunc("/api/logs", handlers.ClearServerLog).Methods("DELETE")
	r.HandleFunc("/api/logs/download", handlers.DownloadServerLog).Methods("GET")
	r.HandleFunc("/api/import", handlers.Import).Methods("POST")
	r.HandleFunc("/api/ping", handlers.PingURL).Methods("GET")

	// New feature endpoints
	r.HandleFunc("/api/duplicates", handlers.CheckDuplicates).Methods("GET")
	r.HandleFunc("/api/health", handlers.Health).Methods("GET")
	r.HandleFunc("/api/bookmark-health", handlers.GetBookmarkHealth).Methods("GET")
	// The daily points alone, without building a report for them.
	r.HandleFunc("/api/health/trend", handlers.GetHealthTrend).Methods("GET")
	r.HandleFunc("/api/feeds", handlers.GetFeeds).Methods("GET")
	// The five most recent posts from nextdash.cc, fetched by the server so the
	// page never talks to another host and one fetch serves every reader.
	r.HandleFunc("/api/site-news", handlers.GetSiteNews).Methods("GET")
	r.HandleFunc("/api/feeds/poll", handlers.PollFeedsNow).Methods("POST")
	r.HandleFunc("/api/health/cache-scan", handlers.CacheScanResult).Methods("POST")
	r.HandleFunc("/api/health/update-status", handlers.UpdateBookmarkHealthStatus).Methods("POST")
	r.HandleFunc("/api/health/retest-all", handlers.RetestAll).Methods("POST")
	r.HandleFunc("/api/health/check-mode-all", handlers.SetAllCheckModes).Methods("POST")
	r.HandleFunc("/api/health/check-mode", handlers.SetBookmarkCheckMode).Methods("POST")
	// The secrets a check sends, in their own file outside the backup.
	// The one widget that reads from outside, by widget id rather than by URL.
	r.HandleFunc("/api/widgets/custom", handlers.CustomWidgetHandler).Methods("GET", "OPTIONS")
	r.HandleFunc("/api/health/credentials", handlers.HealthCredentialsHandler).Methods("GET", "PUT", "DELETE", "OPTIONS")
	r.HandleFunc("/api/webhooks", handlers.WebhooksHandler).Methods("GET", "PUT", "DELETE", "OPTIONS")
	r.HandleFunc("/api/webhooks/test", handlers.TestWebhookHandler).Methods("POST", "OPTIONS")
	// Not under /api: an MCP endpoint is a published address that goes into a
	// client's config file, and /mcp is where every client looks first.
	r.HandleFunc("/mcp", handlers.MCPHandler).Methods("POST", "OPTIONS")
	r.HandleFunc("/api/health/expectations", handlers.SetBookmarkExpectations).Methods("POST")
	// The same fields for a list of bookmarks, so muting a dozen during a known
	// outage is one request rather than a dozen dialogs.
	r.HandleFunc("/api/health/expectations-bulk", handlers.SetBookmarkExpectationsBulk).Methods("POST")
	r.HandleFunc("/api/health/ignore", handlers.SetBookmarkHealthIgnores).Methods("POST")
	r.HandleFunc("/api/health/accept-drift", handlers.AcceptDrift).Methods("POST")
	r.HandleFunc("/api/health/check-url", handlers.CheckBookmarkHealthURL).Methods("POST")
	r.HandleFunc("/api/health/open-broken", handlers.OpenBroken).Methods("POST")
	r.HandleFunc("/api/health/merge-duplicates", handlers.MergeDuplicates).Methods("POST")
	r.HandleFunc("/api/health/delete-bookmark", handlers.DeleteHealthBookmark).Methods("POST")
	r.HandleFunc("/api/health/delete-bookmarks", handlers.DeleteHealthBookmarksBulk).Methods("POST")
	r.HandleFunc("/api/health/history-export", handlers.ExportHealthHistory).Methods("GET")
	r.HandleFunc("/api/health/archive-snapshot", handlers.ArchiveSnapshot).Methods("GET")
	// Asking the archive to keep a copy, rather than hoping someone already
	// did. Behind the write token: it spends a shared daily budget.
	// The second archive, which keeps what the first was not allowed to.
	r.HandleFunc("/api/health/archive-today", handlers.ArchiveTodayHandler).Methods("GET", "OPTIONS")
	r.HandleFunc("/api/health/archive-save", handlers.SaveArchiveCapture).Methods("POST", "OPTIONS")
	r.HandleFunc("/api/health/archive-save-status", handlers.ArchiveCaptureStatusHandler).Methods("GET", "OPTIONS")
	// The keys, on a route that never hands them back.
	r.HandleFunc("/api/health/archive-settings", handlers.ArchiveSettingsHandler).Methods("GET", "PUT", "OPTIONS")
	// A copy on this disk, through monolith. Behind the write token, captures
	// included: a stored page is the whole content of something the reader chose
	// to keep, which /data/'s unauthenticated allowlist is no place for.
	r.HandleFunc("/api/archives", handlers.LocalArchivesHandler).Methods("GET", "OPTIONS")
	r.HandleFunc("/api/archives/capture", handlers.CaptureLocallyHandler).Methods("POST", "OPTIONS")
	r.PathPrefix("/api/archives/").HandlerFunc(handlers.ServeLocalArchive).Methods("GET")
	r.PathPrefix("/api/archives/").HandlerFunc(handlers.DeleteLocalArchive).Methods("DELETE")
	r.HandleFunc("/api/health/auto-heal-suggest", handlers.AutoHealSuggest).Methods("GET")
	r.HandleFunc("/api/health/auto-heal-apply", handlers.AutoHealApply).Methods("POST")
	r.HandleFunc("/api/health/test-notification", handlers.TestMonitorNotification).Methods("POST")
	r.HandleFunc("/api/bookmark-preview", handlers.GetBookmarkPreview).Methods("GET")
	// Capture from outside the dashboard: the PWA share target and the
	// bookmarklet. Both are GET because neither can set a header — see
	// share_capture.go.
	r.HandleFunc("/share", handlers.ShareTargetCapture).Methods("GET")
	r.HandleFunc("/add", handlers.AddCapture).Methods("GET")
	r.HandleFunc("/api/inbox", handlers.GetInbox).Methods("GET")
	r.HandleFunc("/api/inbox", handlers.AddInboxItem).Methods("POST")
	r.HandleFunc("/api/inbox", handlers.DeleteInboxItem).Methods("DELETE")
	r.HandleFunc("/api/inbox", handlers.PatchInboxItem).Methods("PATCH")
	r.HandleFunc("/api/inbox", handlers.PutInboxItem).Methods("PUT")
	r.HandleFunc("/api/inbox-stats", handlers.GetInboxStats).Methods("GET")
	r.HandleFunc("/api/trash", handlers.GetTrash).Methods("GET")
	r.HandleFunc("/api/trash", handlers.AddTrashItems).Methods("POST")
	r.HandleFunc("/api/trash", handlers.DeleteTrashItem).Methods("DELETE")
	r.HandleFunc("/api/trash/restore", handlers.RestoreTrashItem).Methods("POST")
	r.HandleFunc("/api/previews/clear", handlers.ClearAllBookmarkPreviews).Methods("POST")
	r.HandleFunc("/api/previews/refresh", handlers.RefreshAllBookmarkPreviews).Methods("POST")
	r.HandleFunc("/api/track-open", handlers.TrackBookmarkOpen).Methods("POST")

	// Data files (for uploaded favicons, etc.)
	//
	// Narrowed to the three things the UI actually links: data/icons/*, and the
	// uploaded favicon/font at the data root. A bare FileServer over the whole
	// data directory also served settings.json, every bookmarks-N.json,
	// inbox.json, trash.json and the auto-backup ZIPs -- ungated, with directory
	// listings, while /api/backup returns the same content only behind
	// requireWriteAccess.
	dataDir := ResolveDataDir()
	dataFileServer := http.StripPrefix("/data/", http.FileServer(http.Dir(dataDir)))
	r.PathPrefix("/data/").HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rel := strings.TrimPrefix(r.URL.Path, "/data/")
		if rel == "" || strings.Contains(rel, "..") {
			http.NotFound(w, r)
			return
		}
		switch {
		case strings.HasPrefix(rel, "icons/") && !strings.Contains(strings.TrimPrefix(rel, "icons/"), "/"):
			// Icon filenames carry 8 random bytes and are never rewritten in
			// place, so they can be frozen. These are the most numerous requests
			// on the dashboard -- one per bookmark -- and had no Cache-Control at
			// all, costing a conditional round trip each on every load.
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		case strings.HasPrefix(rel, "favicon.") || strings.HasPrefix(rel, "font."):
			// Overwritten in place by the upload handlers, so it must revalidate.
			w.Header().Set("Cache-Control", "public, max-age=300")
		default:
			http.NotFound(w, r)
			return
		}
		dataFileServer.ServeHTTP(w, r)
	})

	// Locales: prefer on-disk files in dev/Docker mounts, fall back to embed.
	if info, err := os.Stat("locales"); err == nil && info.IsDir() {
		logInfo(logComponentServer, "serving /locales/ from ./locales on disk")
	}
	// One handler for both sources: it reads from disk when there is a disk copy
	// and from the embedded set otherwise, and it can narrow the file to a scope
	// so the dashboard does not fetch the Help tab's prose to draw a label.
	r.PathPrefix("/locales/").HandlerFunc(handlers.LocaleFile)

	// Static: prefer on-disk files so container/dev picks up JS/CSS without rebuild.
	var staticHandler http.Handler
	if info, err := os.Stat("static"); err == nil && info.IsDir() {
		logInfo(logComponentServer, "serving /static/ from ./static on disk")
		staticHandler = http.FileServer(http.Dir("static"))
	} else {
		staticFS, _ := fs.Sub(embeddedFiles, "static")
		staticHandler = http.FileServer(http.FS(staticFS))
	}
	r.PathPrefix("/static/").Handler(http.StripPrefix("/static/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		applyStaticCacheControl(w, r)
		ext := filepath.Ext(r.URL.Path)
		if mimeType := mime.TypeByExtension(ext); mimeType != "" {
			w.Header().Set("Content-Type", mimeType)
		}
		staticHandler.ServeHTTP(w, r)
	})))

	// Get port from environment or use default
	port, err := validateListenPort(os.Getenv("PORT"))
	if err != nil {
		log.Fatalf("%v", err)
	}

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           requestLogging(gzipMiddleware(securityHeaders(r))),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	// Weekly automatic local backups (keeps the latest few, respects the setting).
	schedulerStop := make(chan struct{})
	handlers.StartAutoBackupScheduler(schedulerStop)
	// Periodic background health rechecks (opt-in, respects the setting + interval).
	handlers.StartHealthRecheckScheduler(schedulerStop)
	// Uptime monitoring for bookmarks opted into the faster monitor tier.
	handlers.StartHealthMonitorScheduler(schedulerStop)
	// Feed polling for bookmarks whose page advertises one (opt-in, same cadence
	// as the background recheck).
	handlers.StartFeedPollScheduler(schedulerStop)
	// Dates the links that are already failing, so a row can say the page has
	// been gone for years rather than only that it broke here on Tuesday.
	handlers.StartArchiveBackfillScheduler(schedulerStop)
	handlers.StartUpdateCheckScheduler(schedulerStop)

	go func() {
		logInfo(logComponentServer, "starting on port %s", port)
		logInfo(logComponentServer, "dashboard: http://localhost:%s", port)
		logInfo(logComponentServer, "configuration: http://localhost:%s/#config", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	logInfo(logComponentServer, "shutting down")
	close(schedulerStop)
	handlers.FlushCaches()

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		logError(logComponentServer, "the shutdown did not finish cleanly: %v", err)
	}
	logInfo(logComponentServer, "stopped")
}
