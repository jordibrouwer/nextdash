package main

import (
	"context"
	"embed"
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

//go:embed static/* templates/* locales/*
var embeddedFiles embed.FS

func main() {
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
	store := NewStore()
	if strings.TrimSpace(os.Getenv("NEXTDASH_DATA_DIR")) != "" {
		log.Printf("Using data directory: %s", ResolveDataDir())
	}

	// Initialize handlers
	handlers := NewHandlers(store, embeddedFiles)

	// Create router
	r := mux.NewRouter()

	// Routes
	r.HandleFunc("/version", Version).Methods("GET")
	r.HandleFunc("/manifest.webmanifest", handlers.WebAppManifest).Methods("GET")
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
	r.HandleFunc("/api/bookmarks/prefetch-icons", handlers.PrefetchBookmarkIcons).Methods("POST")
	r.HandleFunc("/api/bookmarks/delete-all", handlers.DeleteAllBookmarks).Methods("POST")
	r.HandleFunc("/api/finders", handlers.GetFinders).Methods("GET")
	r.HandleFunc("/api/finders", handlers.SaveFinders).Methods("POST")
	r.HandleFunc("/api/categories", handlers.GetCategories).Methods("GET")
	r.HandleFunc("/api/categories", handlers.SaveCategories).Methods("POST")
	r.HandleFunc("/api/pages", handlers.GetPages).Methods("GET")
	r.HandleFunc("/api/pages", handlers.SavePages).Methods("POST")
	r.HandleFunc("/api/data-revision", handlers.GetDataRevision).Methods("GET")
	r.HandleFunc("/api/app-version", handlers.AppVersion).Methods("GET")
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
	r.HandleFunc("/api/import", handlers.Import).Methods("POST")
	r.HandleFunc("/api/ping", handlers.PingURL).Methods("GET")

	// New feature endpoints
	r.HandleFunc("/api/duplicates", handlers.CheckDuplicates).Methods("GET")
	r.HandleFunc("/api/health", handlers.Health).Methods("GET")
	r.HandleFunc("/api/bookmark-health", handlers.GetBookmarkHealth).Methods("GET")
	r.HandleFunc("/api/health/cache-scan", handlers.CacheScanResult).Methods("POST")
	r.HandleFunc("/api/health/update-status", handlers.UpdateBookmarkHealthStatus).Methods("POST")
	r.HandleFunc("/api/health/retest-all", handlers.RetestAll).Methods("POST")
	r.HandleFunc("/api/health/check-mode-all", handlers.SetAllCheckModes).Methods("POST")
	r.HandleFunc("/api/health/check-mode", handlers.SetBookmarkCheckMode).Methods("POST")
	r.HandleFunc("/api/health/check-url", handlers.CheckBookmarkHealthURL).Methods("POST")
	r.HandleFunc("/api/health/open-broken", handlers.OpenBroken).Methods("POST")
	r.HandleFunc("/api/health/merge-duplicates", handlers.MergeDuplicates).Methods("POST")
	r.HandleFunc("/api/health/delete-bookmark", handlers.DeleteHealthBookmark).Methods("POST")
	r.HandleFunc("/api/health/auto-heal-suggest", handlers.AutoHealSuggest).Methods("GET")
	r.HandleFunc("/api/health/auto-heal-apply", handlers.AutoHealApply).Methods("POST")
	r.HandleFunc("/api/bookmark-preview", handlers.GetBookmarkPreview).Methods("GET")
	r.HandleFunc("/api/inbox", handlers.GetInbox).Methods("GET")
	r.HandleFunc("/api/inbox", handlers.AddInboxItem).Methods("POST")
	r.HandleFunc("/api/inbox", handlers.DeleteInboxItem).Methods("DELETE")
	r.HandleFunc("/api/inbox", handlers.PatchInboxItem).Methods("PATCH")
	r.HandleFunc("/api/inbox", handlers.PutInboxItem).Methods("PUT")
	r.HandleFunc("/api/inbox-stats", handlers.GetInboxStats).Methods("GET")
	r.HandleFunc("/api/previews/clear", handlers.ClearAllBookmarkPreviews).Methods("POST")
	r.HandleFunc("/api/previews/refresh", handlers.RefreshAllBookmarkPreviews).Methods("POST")
	r.HandleFunc("/api/track-open", handlers.TrackBookmarkOpen).Methods("POST")

	// Data files (for uploaded favicons, etc.)
	dataDir := ResolveDataDir()
	r.PathPrefix("/data/").Handler(http.StripPrefix("/data/", http.FileServer(http.Dir(dataDir))))

	// Locales: prefer on-disk files in dev/Docker mounts, fall back to embed.
	if info, err := os.Stat("locales"); err == nil && info.IsDir() {
		log.Printf("Serving /locales/ from disk (./locales)")
		r.PathPrefix("/locales/").Handler(http.StripPrefix("/locales/", http.FileServer(http.Dir("locales"))))
	} else {
		localesFS, _ := fs.Sub(embeddedFiles, "locales")
		r.PathPrefix("/locales/").Handler(http.StripPrefix("/locales/", http.FileServer(http.FS(localesFS))))
	}

	// Static: prefer on-disk files so container/dev picks up JS/CSS without rebuild.
	var staticHandler http.Handler
	if info, err := os.Stat("static"); err == nil && info.IsDir() {
		log.Printf("Serving /static/ from disk (./static)")
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
		Addr:    ":" + port,
		Handler: requestLogging(gzipMiddleware(securityHeaders(r))),
	}

	// Weekly automatic local backups (keeps the latest few, respects the setting).
	schedulerStop := make(chan struct{})
	handlers.StartAutoBackupScheduler(schedulerStop)
	// Periodic background health rechecks (opt-in, respects the setting + interval).
	handlers.StartHealthRecheckScheduler(schedulerStop)
	// Uptime monitoring for bookmarks opted into the faster monitor tier.
	handlers.StartHealthMonitorScheduler(schedulerStop)
	// Announce a newer release once per version, off the startup path so a slow
	// push service never delays the server coming up.
	go handlers.notifyReleaseOnStartup()

	go func() {
		log.Printf("Server starting on port %s", port)
		log.Printf("Dashboard: http://localhost:%s", port)
		log.Printf("Configuration: http://localhost:%s/#config", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	log.Printf("Shutting down server...")
	close(schedulerStop)
	handlers.FlushCaches()

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("Shutdown error: %v", err)
	}
	log.Printf("Server stopped")
}
