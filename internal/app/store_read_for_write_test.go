package app

import (
	"os"
	"testing"
)

// unreadable makes path unreadable for the rest of the test, or skips when the
// process can read it anyway (root).
func unreadable(t *testing.T, path string) {
	t.Helper()
	if err := os.Chmod(path, 0); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(path, 0o600) })
	if _, err := os.ReadFile(path); err == nil {
		t.Skip("the file is still readable (running as root?)")
	}
}

func readable(t *testing.T, path string) {
	t.Helper()
	if err := os.Chmod(path, 0o600); err != nil {
		t.Fatal(err)
	}
}

// A push store that cannot be read makes no new keys: new keys, written with
// the empty list it was read as, dropped every subscribed device.
func TestPushKeysAreNotRemadeOverAnUnreadableStore(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	before, err := ensureVAPIDKeys()
	if err != nil {
		t.Fatal(err)
	}
	if err := savePushSubscription(PushSubscription{Endpoint: "https://push.example/a", P256dh: "p", Auth: "a"}); err != nil {
		t.Fatal(err)
	}
	unreadable(t, pushSubscriptionsFilePath())
	if _, err := ensureVAPIDKeys(); err == nil {
		t.Fatal("keys were handed out from a store that could not be read")
	}
	if err := savePushSubscription(PushSubscription{Endpoint: "https://push.example/b", P256dh: "p", Auth: "a"}); err == nil {
		t.Fatal("a subscription was saved over a store that could not be read")
	}
	readable(t, pushSubscriptionsFilePath())
	after, err := ensureVAPIDKeys()
	if err != nil {
		t.Fatal(err)
	}
	if after.PublicKey != before.PublicKey {
		t.Fatal("the keys were replaced")
	}
	if n := len(listPushSubscriptions()); n != 1 {
		t.Fatalf("%d subscriptions, want the one saved before", n)
	}
}
