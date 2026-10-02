package app

import (
	"context"
	"errors"
	"sync"
	"time"
)

/*
One answer per area, shared by everyone viewing.

A dashboard open in three tabs with the overview and the array tile asks the
Unraid server once per area per floor, not once per tile per tab. A failed read
keeps the last good one, so a server that is rebooting shows its last state
with an age instead of an empty tile. After a 429 the area waits, doubling,
before it asks again.
*/

const (
	unraidFloor        = 30 * time.Second
	unraidBackoffMin   = 30 * time.Second
	unraidBackoffMax   = 10 * time.Minute
	unraidFetchTimeout = 15 * time.Second
)

type unraidAreaResult struct {
	Area      string `json:"area"`
	Status    string `json:"status"`
	Data      any    `json:"data,omitempty"`
	Error     string `json:"error,omitempty"`
	FetchedAt int64  `json:"fetchedAt,omitempty"`
	LastOkAt  int64  `json:"lastOkAt,omitempty"`
}

type unraidCacheEntry struct {
	result     unraidAreaResult
	at         time.Time
	backoff    time.Duration
	retryAfter time.Time
	inflight   *sync.WaitGroup
}

type unraidCache struct {
	mu      sync.Mutex
	entries map[string]*unraidCacheEntry
}

func newUnraidCache() *unraidCache { return &unraidCache{entries: map[string]*unraidCacheEntry{}} }

var (
	unraidAnswersMu sync.RWMutex
	unraidAnswers   = newUnraidCache()
)

func currentUnraidAnswers() *unraidCache {
	unraidAnswersMu.RLock()
	defer unraidAnswersMu.RUnlock()
	return unraidAnswers
}

// resetUnraidAnswers drops every cached answer: after a new address or key
// nothing cached is about the new server any more.
func resetUnraidAnswers() {
	unraidAnswersMu.Lock()
	unraidAnswers = newUnraidCache()
	unraidAnswersMu.Unlock()
}

type unraidFetch func(ctx context.Context) (data any, status string, err error)

func (c *unraidCache) get(ctx context.Context, area string, floor time.Duration, fetch unraidFetch) unraidAreaResult {
	c.mu.Lock()
	e := c.entries[area]
	if e == nil {
		e = &unraidCacheEntry{result: unraidAreaResult{Area: area}}
		c.entries[area] = e
	}
	if e.inflight != nil {
		wg := e.inflight
		c.mu.Unlock()
		wg.Wait()
		c.mu.Lock()
		defer c.mu.Unlock()
		return e.result
	}
	now := time.Now()
	if (!e.at.IsZero() && now.Sub(e.at) < floor) || now.Before(e.retryAfter) {
		defer c.mu.Unlock()
		return e.result
	}
	wg := &sync.WaitGroup{}
	wg.Add(1)
	e.inflight = wg
	c.mu.Unlock()

	// The leader fetches for everyone: its own tab closing must not turn the
	// shared answer into a failure for every other viewer.
	data, status, err := runUnraidFetch(ctx, fetch)

	c.mu.Lock()
	defer c.mu.Unlock()
	defer func() {
		e.inflight = nil
		wg.Done()
	}()
	e.at = time.Now()
	e.result.Area = area
	e.result.Status = status
	e.result.FetchedAt = e.at.UnixMilli()
	if err == nil && status == "ok" {
		e.result.Data = data
		e.result.Error = ""
		e.result.LastOkAt = e.result.FetchedAt
		e.backoff = 0
	} else {
		e.result.Error = ""
		if err != nil {
			e.result.Error = err.Error()
		}
		if errors.Is(err, errUnraidRateLimited) {
			if e.backoff == 0 {
				e.backoff = unraidBackoffMin
			} else if e.backoff < unraidBackoffMax {
				e.backoff *= 2
			}
			e.retryAfter = e.at.Add(e.backoff)
		}
		// An unreachable or unauthorized server keeps the last good data;
		// forbidden and unsupported carry none on purpose.
		if status != "unreachable" && status != "unauthorized" {
			e.result.Data = data
		}
	}
	return e.result
}

var errUnraidUnreadable = errors.New("unraid: the answer could not be read")

// runUnraidFetch runs fetch detached from the caller's cancellation, with its
// own deadline, and turns a panic into an answer so the area never wedges.
func runUnraidFetch(ctx context.Context, fetch unraidFetch) (data any, status string, err error) {
	fctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), unraidFetchTimeout)
	defer cancel()
	defer func() {
		if r := recover(); r != nil {
			logWarn("unraid", "reading an area panicked: %v", r)
			data, status, err = nil, "unsupported", errUnraidUnreadable
		}
	}()
	return fetch(fctx)
}
