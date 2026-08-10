package main

import (
	"io"
	"log"
	"os"
	"path/filepath"
	"testing"
)

// What a request line actually costs, measured against the plain stderr writer
// the server used before the log viewer existed.

func benchLine() string {
	return "2026/08/10 00:11:55 50ebdf22bfeff3a5 GET /api/bookmarks 200 1104B 164.417µs"
}

// Baseline: the logger as it was, writing to a discard file.
func BenchmarkLogStderrOnly(b *testing.B) {
	lg := log.New(io.Discard, "", log.LstdFlags)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		lg.Printf("%s", benchLine())
	}
}

// The buffer alone, no disk mirror.
func BenchmarkLogSinkMemoryOnly(b *testing.B) {
	s := &serverLogSink{}
	lg := log.New(io.MultiWriter(io.Discard, s), "", log.LstdFlags)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		lg.Printf("%s", benchLine())
	}
}

// The buffer plus the rotating file — what actually ships.
func BenchmarkLogSinkWithDisk(b *testing.B) {
	dir := b.TempDir()
	s := &serverLogSink{file: &activityRotatingFile{
		path:     filepath.Join(dir, "server.log"),
		maxBytes: serverLogMaxBytes,
		backups:  serverLogBackupCount,
		keepOpen: true,
	}}
	lg := log.New(io.MultiWriter(io.Discard, s), "", log.LstdFlags)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		lg.Printf("%s", benchLine())
	}
}

// Just the file write, isolated: one stat + open + write + close per line.
// This is the activity log's path, kept as the before-picture.
func BenchmarkRotatingFileWrite(b *testing.B) {
	dir := b.TempDir()
	f := &activityRotatingFile{path: filepath.Join(dir, "x.log"), maxBytes: 1 << 30, backups: 1}
	line := []byte(benchLine() + "\n")
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = f.write(line)
	}
}

// The same, with the handle held open — what the server log uses.
func BenchmarkRotatingFileWriteKeepOpen(b *testing.B) {
	dir := b.TempDir()
	f := &activityRotatingFile{path: filepath.Join(dir, "x.log"), maxBytes: 1 << 30, backups: 1, keepOpen: true}
	line := []byte(benchLine() + "\n")
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = f.write(line)
	}
}

// An append to an already-open handle, for comparison with the above.
func BenchmarkAppendToOpenHandle(b *testing.B) {
	dir := b.TempDir()
	fh, err := os.OpenFile(filepath.Join(dir, "y.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		b.Fatal(err)
	}
	defer fh.Close()
	line := []byte(benchLine() + "\n")
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = fh.Write(line)
	}
}

// The ring at capacity: every append also trims, which currently reallocates.
func BenchmarkSinkAtCapacity(b *testing.B) {
	s := &serverLogSink{}
	for i := 0; i < serverLogBufferLines; i++ {
		s.appendLine(benchLine())
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		s.appendLine(benchLine())
	}
}

// The same, with an age cap set, so pruneExpiredLocked walks the ring too.
func BenchmarkSinkAtCapacityWithRetention(b *testing.B) {
	s := &serverLogSink{}
	s.SetRetention(serverLogModeTime, 24, serverLogDefaultMaxEntries)
	for i := 0; i < serverLogBufferLines; i++ {
		s.appendLine(benchLine())
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		s.appendLine(benchLine())
	}
}
