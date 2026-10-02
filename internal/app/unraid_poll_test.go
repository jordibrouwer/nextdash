package app

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestUnraidCacheSharesOneRequest(t *testing.T) {
	var calls int32
	c := newUnraidCache()
	fetch := func(ctx context.Context) (any, string, error) {
		atomic.AddInt32(&calls, 1)
		time.Sleep(50 * time.Millisecond)
		return "x", "ok", nil
	}
	var wg sync.WaitGroup
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); c.get(context.Background(), "array", 30*time.Second, fetch) }()
	}
	wg.Wait()
	c.get(context.Background(), "array", 30*time.Second, fetch)
	if calls != 1 {
		t.Fatalf("calls = %d", calls)
	}
}

func TestUnraidCacheKeepsTheLastGoodAnswer(t *testing.T) {
	c := newUnraidCache()
	c.get(context.Background(), "array", 0, func(context.Context) (any, string, error) { return "good", "ok", nil })
	r := c.get(context.Background(), "array", 0, func(context.Context) (any, string, error) { return nil, "unreachable", errUnraidNoAPI })
	if r.Data != "good" || r.Status != "unreachable" || r.Error == "" || r.LastOkAt == 0 {
		t.Fatalf("r = %+v", r)
	}
}

func TestUnraidCacheBacksOffAfter429(t *testing.T) {
	c := newUnraidCache()
	var calls int32
	fetch := func(context.Context) (any, string, error) {
		atomic.AddInt32(&calls, 1)
		return nil, "unreachable", errUnraidRateLimited
	}
	c.get(context.Background(), "array", 0, fetch)
	c.get(context.Background(), "array", 0, fetch)
	if calls != 1 {
		t.Fatalf("asked again during back-off: %d", calls)
	}
}

func TestUnraidCacheSurvivesTheLeaderClosing(t *testing.T) {
	c := newUnraidCache()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	r := c.get(ctx, "array", 30*time.Second, func(ctx context.Context) (any, string, error) {
		if ctx.Err() != nil {
			return nil, "unreachable", ctx.Err()
		}
		return "x", "ok", nil
	})
	if r.Status != "ok" || r.Data != "x" {
		t.Fatalf("r = %+v", r)
	}
}

func TestUnraidCacheDoesNotWedgeOnAPanic(t *testing.T) {
	c := newUnraidCache()
	r := c.get(context.Background(), "array", 0, func(context.Context) (any, string, error) { panic("boom") })
	if r.Status != "unsupported" || r.Error == "" {
		t.Fatalf("panic answer = %+v", r)
	}
	done := make(chan unraidAreaResult, 1)
	go func() {
		done <- c.get(context.Background(), "array", 0, func(context.Context) (any, string, error) { return "fine", "ok", nil })
	}()
	select {
	case r := <-done:
		if r.Status != "ok" || r.Data != "fine" {
			t.Fatalf("r = %+v", r)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("the area is wedged after a panic")
	}
}
