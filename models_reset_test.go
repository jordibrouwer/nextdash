package main

import (
	"os"
	"testing"
	"time"
)

func TestResetAllDataDoesNotDeadlock(t *testing.T) {
	t.Parallel()

	tmp := t.TempDir()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(tmp); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(wd) })

	store := NewStore()

	done := make(chan error, 1)
	go func() { done <- store.ResetAllData() }()

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("ResetAllData error: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("ResetAllData deadlocked")
	}
}
