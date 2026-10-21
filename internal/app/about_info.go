package app

import (
	"encoding/json"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"time"
)

// processStartedAt is when this server process came up.
var processStartedAt = time.Now()

// AboutInfo is returned by GET /api/about-info. It carries facts for the
// Config → About page only; no filesystem paths.
type AboutInfo struct {
	Release       string `json:"release"`
	BuildVersion  string `json:"buildVersion"`
	BuildCommit   string `json:"buildCommit"`
	BuildDate     string `json:"buildDate,omitempty"`
	GoVersion     string `json:"goVersion"`
	OS            string `json:"os"`
	Arch          string `json:"arch"`
	StartedAt     int64  `json:"startedAt"`
	UptimeSeconds int64  `json:"uptimeSeconds"`
	DataBytes     int64  `json:"dataBytes"`
	Port          string `json:"port,omitempty"`
}

func aboutBuildDate() string {
	bi, ok := debug.ReadBuildInfo()
	if !ok {
		return ""
	}
	for _, s := range bi.Settings {
		if s.Key == "vcs.time" {
			return s.Value
		}
	}
	return ""
}

func dirFileBytes(dir string) int64 {
	var total int64
	_ = filepath.WalkDir(dir, func(_ string, d fs.DirEntry, err error) error {
		if err != nil || d == nil || !d.Type().IsRegular() {
			return nil
		}
		if fi, err := d.Info(); err == nil {
			total += fi.Size()
		}
		return nil
	})
	return total
}

func buildAboutInfo(now time.Time, started time.Time, dataDir string) AboutInfo {
	port, err := validateListenPort(os.Getenv("PORT"))
	if err != nil {
		port = ""
	}
	return AboutInfo{
		Release:       releaseTag(),
		BuildVersion:  buildVersion,
		BuildCommit:   buildCommit,
		BuildDate:     aboutBuildDate(),
		GoVersion:     runtime.Version(),
		OS:            runtime.GOOS,
		Arch:          runtime.GOARCH,
		StartedAt:     started.Unix(),
		UptimeSeconds: int64(now.Sub(started) / time.Second),
		DataBytes:     dirFileBytes(dataDir),
		Port:          port,
	}
}

// GetAboutInfo serves GET /api/about-info.
func (h *Handlers) GetAboutInfo(w http.ResponseWriter, r *http.Request) {
	info := buildAboutInfo(time.Now(), processStartedAt, ResolveDataDir())
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(info)
}
