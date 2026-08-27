package app

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

func validateListenPort(raw string) (string, error) {
	port := strings.TrimSpace(raw)
	if port == "" {
		return "8080", nil
	}
	n, err := strconv.Atoi(port)
	if err != nil || n < 1 || n > 65535 {
		return "", fmt.Errorf("invalid PORT %q: must be a number between 1 and 65535", port)
	}
	return strconv.Itoa(n), nil
}

func validateDataDirAtStartup() error {
	dir, err := filepath.Abs(ResolveDataDir())
	if err != nil {
		return fmt.Errorf("NEXTDASH_DATA_DIR: invalid path: %w", err)
	}
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("NEXTDASH_DATA_DIR: cannot create %s: %w", dir, err)
	}
	probe := filepath.Join(dir, ".nextdash-write-test")
	if err := os.WriteFile(probe, []byte("ok"), 0600); err != nil {
		return fmt.Errorf("NEXTDASH_DATA_DIR: %s is not writable: %w", dir, err)
	}
	_ = os.Remove(probe)
	return nil
}
