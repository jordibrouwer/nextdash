package main

import (
	"os"
	"testing"
)

func TestMain(m *testing.M) {
	os.Setenv("NEXTDASH_DISABLE_PREFETCH", "1")
	os.Exit(m.Run())
}
