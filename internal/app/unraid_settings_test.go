package app

import (
	"os"
	"path/filepath"
	"testing"
)

func TestNormalizeUnraidSettingsKeepsOneCleanServer(t *testing.T) {
	s := Settings{UnraidServers: []UnraidServer{
		{ID: "", Name: "  tower ", BaseURL: " http://192.168.1.10/ ", Enabled: true},
		{ID: "x", BaseURL: "http://second", Enabled: true},
	}}
	normalizeUnraidSettings(&s)
	if len(s.UnraidServers) != 1 {
		t.Fatalf("want one server, got %d", len(s.UnraidServers))
	}
	got := s.UnraidServers[0]
	if got.ID == "" || got.Name != "tower" || got.BaseURL != "http://192.168.1.10" {
		t.Fatalf("not normalised: %+v", got)
	}
}

func TestNormalizeUnraidSettingsDropsABadAddress(t *testing.T) {
	s := Settings{UnraidServers: []UnraidServer{{ID: "a", BaseURL: "ftp://tower", Enabled: true}}}
	normalizeUnraidSettings(&s)
	if s.UnraidServers[0].BaseURL != "" {
		t.Fatalf("ftp kept: %q", s.UnraidServers[0].BaseURL)
	}
}

func TestUnraidKeyLivesInItsOwnFileAt0600(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)
	if err := saveUnraidAPIKey("srv1", " abc123 "); err != nil {
		t.Fatal(err)
	}
	if got := unraidAPIKey("srv1"); got != "abc123" {
		t.Fatalf("key = %q", got)
	}
	info, err := os.Stat(filepath.Join(dir, "unraid-secrets.json"))
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("mode = %v, err = %v", info.Mode().Perm(), err)
	}
	if err := saveUnraidAPIKey("srv1", ""); err != nil {
		t.Fatal(err)
	}
	if unraidAPIKey("srv1") != "" {
		t.Fatal("empty key should remove it")
	}
}

func TestUnraidSecretsAreABackupSecret(t *testing.T) {
	if p, ok := dataFilePolicyOf("unraid-secrets.json"); !ok || p != dataSecret {
		t.Fatalf("policy = %v, %v", p, ok)
	}
}
