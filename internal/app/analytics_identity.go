package app

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"sync"
)

// analyticsInstallRef is the code a usage-analytics snapshot carries so that
// visits from one install count as one.
//
// Umami's own visitor id rotates every month and differs per browser, which
// made retention and release uptake unmeasurable. This one is made from the
// file install-id in the data folder, as the daily install count's id is, but
// hashed with a purpose of its own: the two datasets live in different Umami
// websites and must not be joinable by a shared value. Deleting install-id
// gives the install a new code.
//
// Gated like every other analytics value: with analytics off the file is not
// even read, let alone created.
func analyticsInstallRef(enabled bool) string {
	if !enabled {
		return ""
	}
	id, err := loadOrCreateInstallID(ResolveDataDir())
	if err != nil {
		return ""
	}
	sum := sha256.Sum256([]byte("usage-analytics:" + id))
	return hex.EncodeToString(sum[:8])
}

var analyticsDistributionOnce struct {
	sync.Once
	value string
}

// analyticsDistribution is how this server runs: "unraid", "docker" or "other".
// A fixed word, worked out once; "" when analytics is off.
func analyticsDistribution(enabled bool) string {
	if !enabled {
		return ""
	}
	analyticsDistributionOnce.Do(func() {
		switch {
		case installPlatform() == "unraid":
			analyticsDistributionOnce.value = "unraid"
		case fileExists("/.dockerenv"):
			analyticsDistributionOnce.value = "docker"
		default:
			analyticsDistributionOnce.value = "other"
		}
	})
	return analyticsDistributionOnce.value
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
