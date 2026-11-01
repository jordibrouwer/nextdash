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

// The secret stores refuse a save over a file they could not read, instead of
// keeping only the entry being saved.
func TestSecretStoresDoNotSaveOverAnUnreadableFile(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())

	if err := saveHealthCredential("a", HealthCredential{Label: "A", Headers: map[string]string{"X-Key": "1"}}); err != nil {
		t.Fatal(err)
	}
	unreadable(t, healthCredentialFilePath())
	if err := saveHealthCredential("b", HealthCredential{Label: "B", Headers: map[string]string{"X-Key": "2"}}); err == nil {
		t.Error("credential saved over an unreadable file")
	}
	readable(t, healthCredentialFilePath())
	if _, ok := lookupHealthCredential("a"); !ok {
		t.Error("credential a was lost")
	}

	if _, err := saveWebhookEndpoint("one", WebhookEndpoint{URL: "https://hooks.example/1", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	unreadable(t, webhookFilePath())
	if _, err := saveWebhookEndpoint("two", WebhookEndpoint{URL: "https://hooks.example/2", Enabled: true}); err == nil {
		t.Error("webhook saved over an unreadable file")
	}
	readable(t, webhookFilePath())
	if _, ok := lookupWebhookEndpoint("one"); !ok {
		t.Error("webhook one was lost")
	}

	if err := saveAIKey(aiProviderAnthropic, "sk-a"); err != nil {
		t.Fatal(err)
	}
	if err := saveAIKey(aiProviderOpenAI, "sk-o"); err != nil {
		t.Fatal(err)
	}
	unreadable(t, aiSecretsFilePath())
	if err := saveAIKey(aiProviderOpenAI, ""); err == nil {
		t.Error("an AI key was cleared from an unreadable file")
	}
	readable(t, aiSecretsFilePath())
	if aiKeyFor(aiProviderAnthropic) != "sk-a" {
		t.Error("the other provider's key was lost")
	}

	if err := saveUnraidAPIKey("tower", "k1"); err != nil {
		t.Fatal(err)
	}
	unreadable(t, unraidSecretsFilePath())
	if err := saveUnraidAPIKey("backup", "k2"); err == nil {
		t.Error("Unraid key saved over an unreadable file")
	}
	readable(t, unraidSecretsFilePath())
	if unraidAPIKey("tower") != "k1" {
		t.Error("the Unraid key for tower was lost")
	}
}

// A status token file that cannot be read makes no new link: the new token
// stopped every copy of the old link while nothing said why.
func TestStatusLinkIsNotReplacedOverAnUnreadableFile(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	before, err := ensureStatusToken()
	if err != nil {
		t.Fatal(err)
	}
	unreadable(t, statusSecretsFilePath())
	if _, err := ensureStatusToken(); err == nil {
		t.Fatal("a link was handed out from a token file that could not be read")
	}
	readable(t, statusSecretsFilePath())
	if after := readStatusToken(); after != before {
		t.Fatal("the status link was replaced")
	}
}

// A Glances save over a config file that cannot be read is refused: read as
// defaults, it kept only the default first host and the one it changed.
func TestGlancesSaveDoesNotDropHostsOverAnUnreadableFile(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	main := loadGlancesConfig()
	main.Server = "http://tower.lan:61208"
	if _, err := saveGlancesConfig(main, nil); err != nil {
		t.Fatal(err)
	}
	nas, err := glancesAddHost("NAS")
	if err != nil {
		t.Fatal(err)
	}
	unreadable(t, glancesConfigPath())
	nas.Server = "http://nas.lan:61208"
	if _, err := saveGlancesConfig(nas, nil); err == nil {
		t.Error("a host was saved over a config file that could not be read")
	}
	if _, err := glancesAddHost("Pi"); err == nil {
		t.Error("a host was added over a config file that could not be read")
	}
	readable(t, glancesConfigPath())
	configs := glancesHostConfigs()
	if len(configs) != 2 || configs[0].Server != "http://tower.lan:61208" {
		t.Fatalf("hosts after the refused saves: %+v", configs)
	}
}
