package app

import (
	"encoding/json"
	"os"
	"path/filepath"
)

/*
writeFileAtomic is every write to the data directory, so it is also where a
failed one is finally said out loud.

Callers vary in what they do with the error — some report it, several drop it —
and a disk that has filled up or a directory that turned read-only is the kind
of thing a reader needs to hear the first time it happens, not the third time
something quietly did not save.
*/
func writeFileAtomic(path string, data []byte, perm os.FileMode) (err error) {
	defer func() {
		if err != nil {
			logError(logComponentStore, "%s could not be written: %v", filepath.Base(path), err)
			if activityEnabled(activityCategoryStore) {
				logActivity(activityCategoryStore, "store.write_failed", map[string]any{
					"file":  filepath.Base(path),
					"error": err.Error(),
				}, "")
			}
		}
	}()

	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	tmp, err := os.CreateTemp(dir, ".tmp-*")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	success := false
	defer func() {
		if !success {
			_ = os.Remove(tmpPath)
		}
	}()

	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Chmod(perm); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, path); err != nil {
		return err
	}
	success = true
	// The rename is atomic but not yet durable: until the directory entry itself
	// is flushed, a power cut can leave the file at its old contents -- or at
	// neither name. Failing here is not worth reporting to the caller, whose
	// write did land; the fsync is best effort on filesystems that refuse it.
	syncDir(dir)
	return nil
}

// syncDir flushes a directory entry so a completed rename survives a crash.
func syncDir(dir string) {
	handle, err := os.Open(dir)
	if err != nil {
		return
	}
	_ = handle.Sync()
	_ = handle.Close()
}

func writeIndentJSONFile(path string, v any) error {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return writeFileAtomic(path, data, 0644)
}
