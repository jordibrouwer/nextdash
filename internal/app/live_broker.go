package app

import (
	"sync"
	"time"
)

/*
The live channel's broker: a ping that says "this changed, ask again".

Events carry no data. The browser answers a ping with the request it already
makes (the health badge, the net-check rows), so the bell and the badge keep
reading from one source and cannot disagree.

Publish coalesces per event name: the first publish in a window starts a
trailing timer, and every publish until it fires is folded into one delivery.
A monitor round writes many samples and invalidates the report from many
places; the browser should hear it once.

A subscriber that has not read its last ping already knows something changed,
so a full channel drops the new ping instead of blocking Publish.
*/

// liveCoalesce is the trailing window events are folded into.
var liveCoalesce = time.Second

// liveMaxSubscribers caps open streams. Home installs sit far below it; each
// stream holds one connection and one goroutine.
var liveMaxSubscribers = 32

type liveBroker struct {
	mu      sync.Mutex
	subs    map[chan string]struct{}
	pending map[string]bool
	timer   *time.Timer
}

func newLiveBroker() *liveBroker {
	return &liveBroker{
		subs:    map[chan string]struct{}{},
		pending: map[string]bool{},
	}
}

// Subscribe returns a channel of event names and a cancel func that must be
// called once. ok is false when the cap is reached.
func (b *liveBroker) Subscribe() (ch <-chan string, cancel func(), ok bool) {
	if b == nil {
		return nil, func() {}, false
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if len(b.subs) >= liveMaxSubscribers {
		return nil, func() {}, false
	}
	c := make(chan string, 4)
	b.subs[c] = struct{}{}
	return c, func() {
		b.mu.Lock()
		delete(b.subs, c)
		b.mu.Unlock()
	}, true
}

// Publish folds ev into the next delivery. Safe on a nil broker.
func (b *liveBroker) Publish(ev string) {
	if b == nil {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if len(b.subs) == 0 {
		return
	}
	b.pending[ev] = true
	if b.timer != nil {
		return
	}
	b.timer = time.AfterFunc(liveCoalesce, b.flush)
}

func (b *liveBroker) flush() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.timer = nil
	events := b.pending
	b.pending = map[string]bool{}
	for ev := range events {
		for c := range b.subs {
			select {
			case c <- ev:
			default: // a ping is already waiting for this subscriber
			}
		}
	}
}

// subscribers reports the open stream count, for tests.
func (b *liveBroker) subscribers() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.subs)
}
