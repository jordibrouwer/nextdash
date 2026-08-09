package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestParseServerLogLine(t *testing.T) {
	cases := []struct {
		name    string
		raw     string
		level   string
		source  string
		message string
		hasTime bool
	}{
		{
			name:    "subsystem prefix becomes the source",
			raw:     "2026/08/10 00:11:43 auto-backup: created scheduled backup",
			level:   logLevelInfo,
			source:  "auto-backup",
			message: "created scheduled backup",
			hasTime: true,
		},
		{
			name:    "a two-word subsystem still counts",
			raw:     "2026/08/10 00:11:43 health history: recorded a sample",
			level:   logLevelInfo,
			source:  "health history",
			message: "recorded a sample",
			hasTime: true,
		},
		{
			// Startup banners open with a capitalised word and a colon; reading
			// those as subsystems would fill the source filter with junk.
			name:    "a capitalised sentence is not a subsystem",
			raw:     "2026/08/10 00:11:44 Dashboard: http://localhost:18099",
			level:   logLevelInfo,
			source:  "",
			message: "Dashboard: http://localhost:18099",
			hasTime: true,
		},
		{
			name:    "request lines are tagged and stay info on 2xx",
			raw:     "2026/08/10 00:11:55 50ebdf22 GET /api/logs 200 1104B 164µs",
			level:   logLevelInfo,
			source:  "request",
			message: "50ebdf22 GET /api/logs 200 1104B 164µs",
			hasTime: true,
		},
		{
			name:    "a 500 is an error",
			raw:     "2026/08/10 00:11:55 50ebdf22 POST /api/settings 500 12B 1ms",
			level:   logLevelError,
			source:  "request",
			hasTime: true,
		},
		{
			name:    "a 404 is a warning",
			raw:     "2026/08/10 00:11:55 50ebdf22 GET /api/nope 404 9B 1ms",
			level:   logLevelWarn,
			source:  "request",
			hasTime: true,
		},
		{
			name:    "failure wording lifts the level",
			raw:     "2026/08/10 00:11:43 import: failed to prepare data directory",
			level:   logLevelError,
			source:  "import",
			message: "failed to prepare data directory",
			hasTime: true,
		},
		{
			name:    "a line without a timestamp still parses",
			raw:     "plain message with no stamp",
			level:   logLevelInfo,
			source:  "",
			message: "plain message with no stamp",
			hasTime: false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := parseServerLogLine(tc.raw)
			if got.Level != tc.level {
				t.Errorf("level = %q, want %q", got.Level, tc.level)
			}
			if got.Source != tc.source {
				t.Errorf("source = %q, want %q", got.Source, tc.source)
			}
			if tc.message != "" && got.Message != tc.message {
				t.Errorf("message = %q, want %q", got.Message, tc.message)
			}
			if tc.hasTime && got.Time == "" {
				t.Error("expected a parsed timestamp, got none")
			}
			if !tc.hasTime && got.Time != "" {
				t.Errorf("expected no timestamp, got %q", got.Time)
			}
		})
	}
}

func TestServerLogSinkRingAndSince(t *testing.T) {
	s := &serverLogSink{}

	// One more than the ring holds, so the oldest has to fall out.
	for i := 0; i < serverLogBufferLines+5; i++ {
		s.appendLine("2026/08/10 00:11:43 test: line")
	}

	entries, next, dropped := s.Entries(-1, "", "", 0)
	if len(entries) != serverLogBufferLines {
		t.Fatalf("buffer holds %d entries, want %d", len(entries), serverLogBufferLines)
	}
	if dropped != 5 {
		t.Errorf("dropped = %d, want 5", dropped)
	}
	if next != int64(serverLogBufferLines+5) {
		t.Errorf("nextSeq = %d, want %d", next, serverLogBufferLines+5)
	}
	// The ring keeps the newest, so the oldest surviving seq is the count dropped.
	if entries[0].Seq != 5 {
		t.Errorf("oldest kept seq = %d, want 5", entries[0].Seq)
	}

	// Polling with the previous nextSeq must return only what came after it —
	// this is what keeps the viewer's refresh interval cheap.
	s.appendLine("2026/08/10 00:11:44 test: fresh")
	newer, _, _ := s.Entries(next-1, "", "", 0)
	if len(newer) != 1 || newer[0].Message != "fresh" {
		t.Fatalf("since-filter returned %d entries, want 1 fresh one", len(newer))
	}
}

func TestServerLogSinkFilters(t *testing.T) {
	s := &serverLogSink{}
	s.appendLine("2026/08/10 00:11:43 import: all good")
	s.appendLine("2026/08/10 00:11:43 import: failed to read file")
	s.appendLine("2026/08/10 00:11:43 backup: skip stale entry")

	errOnly, _, _ := s.Entries(-1, logLevelError, "", 0)
	if len(errOnly) != 1 || errOnly[0].Level != logLevelError {
		t.Fatalf("error filter returned %d entries, want 1", len(errOnly))
	}

	// warn is a minimum, so it must include errors too.
	warnUp, _, _ := s.Entries(-1, logLevelWarn, "", 0)
	if len(warnUp) != 2 {
		t.Fatalf("warn filter returned %d entries, want 2", len(warnUp))
	}

	found, _, _ := s.Entries(-1, "", "stale", 0)
	if len(found) != 1 || !strings.Contains(found[0].Message, "stale") {
		t.Fatalf("search returned %d entries, want the stale one", len(found))
	}

	// Search also matches the subsystem, which is how you isolate one component.
	bySource, _, _ := s.Entries(-1, "", "import", 0)
	if len(bySource) != 2 {
		t.Fatalf("source search returned %d entries, want 2", len(bySource))
	}
}

func TestServerLogRetentionDropsOldLines(t *testing.T) {
	s := &serverLogSink{}
	now := time.Now()

	// Three hours back, then one just now: a 2h window must keep only the new one.
	s.appendLine(now.Add(-3 * time.Hour).Format("2006/01/02 15:04:05") + " import: ancient")
	s.appendLine(now.Format("2006/01/02 15:04:05") + " import: recent")

	all, _, _ := s.Entries(-1, "", "", 0)
	if len(all) != 2 {
		t.Fatalf("before retention: %d entries, want 2", len(all))
	}

	s.SetRetentionHours(2)
	kept, _, dropped := s.Entries(-1, "", "", 0)
	if len(kept) != 1 || kept[0].Message != "recent" {
		t.Fatalf("after a 2h retention: %d entries, want just the recent one", len(kept))
	}
	// Ageing out is what the user asked for, so it must not read as data loss.
	if dropped != 0 {
		t.Errorf("dropped = %d, want 0 for expired lines", dropped)
	}

	// 0 means keep everything; it must not retroactively resurrect anything,
	// but it must stop pruning.
	s.SetRetentionHours(0)
	s.appendLine(now.Add(-48 * time.Hour).Format("2006/01/02 15:04:05") + " import: old but kept")
	after, _, _ := s.Entries(-1, "", "", 0)
	if len(after) != 2 {
		t.Fatalf("with retention off: %d entries, want 2", len(after))
	}
}

func TestClampServerLogRetentionHours(t *testing.T) {
	for _, tc := range []struct{ in, want int }{
		{-5, serverLogRetentionKeepAll},
		{0, serverLogRetentionKeepAll},
		{1, 1},
		{24, 24},
		{serverLogMaxRetentionHours + 100, serverLogMaxRetentionHours},
	} {
		if got := clampServerLogRetentionHours(tc.in); got != tc.want {
			t.Errorf("clamp(%d) = %d, want %d", tc.in, got, tc.want)
		}
	}
}

func TestServerLogClearRemovesBufferAndFiles(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "server.log")
	s := &serverLogSink{file: &activityRotatingFile{path: path, maxBytes: serverLogMaxBytes, backups: 2}}

	s.appendLine("2026/08/10 00:11:43 import: written to disk")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("expected the line to reach disk: %v", err)
	}
	// A rotated backup must go too, or "clear" would leave history behind.
	if err := os.WriteFile(path+".1", []byte("older\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	s.Clear()

	entries, _, dropped := s.Entries(-1, "", "", 0)
	if len(entries) != 0 || dropped != 0 {
		t.Errorf("after clear: %d entries, dropped=%d; want 0 and 0", len(entries), dropped)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Error("server.log survived the clear")
	}
	if _, err := os.Stat(path + ".1"); !os.IsNotExist(err) {
		t.Error("rotated backup survived the clear")
	}
}

func TestServerLogSeedsFromDisk(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)
	path := filepath.Join(dir, "server.log")
	if err := os.WriteFile(path, []byte("2026/08/10 00:11:43 import: from a previous run\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	s := &serverLogSink{file: &activityRotatingFile{path: path}}
	s.seedFromDisk()

	entries, _, _ := s.Entries(-1, "", "", 0)
	if len(entries) != 1 || entries[0].Message != "from a previous run" {
		t.Fatalf("seed produced %d entries, want the previous run's line", len(entries))
	}
	// Replay must not append what it just read, or every restart doubles the file.
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(string(data), "from a previous run") != 1 {
		t.Error("seeding wrote the replayed line back to the file")
	}
}
