package app

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDockerViewCarriesAppIcon(t *testing.T) {
	h := newTestHandlers(t)
	useIconSetsFixture(t)
	h.wireDockerSettings()
	t.Cleanup(func() { dockerSettingsFrom.Store(nil) })

	row := func(image, name string) dockerViewContainer {
		return toDockerView(dockerContainerSummary{ID: "abcdef0123456789", Names: []string{"/" + name}, Image: image}, "")
	}
	v := row("lscr.io/linuxserver/sonarr", "sonarr")
	if v.Icon == nil || v.Icon.Name != "sonarr" || v.Icon.Dark != "/data/icon-sets/dashboard-icons/sonarr-dark.svg" || v.IconOverride != "" {
		t.Fatalf("automatic: %+v %q", v.Icon, v.IconOverride)
	}
	if v := row("jgeusebroek/spotweb", "spotweb"); v.Icon != nil {
		t.Fatalf("no match should carry no icon: %+v", v.Icon)
	}
	self := toDockerView(dockerContainerSummary{ID: "abcdef0123456789", Names: []string{"/NextDash"}, Image: "ghcr.io/jordibrouwer/nextdash"}, "abcdef0123456789")
	if self.Icon == nil || self.Icon.Base != "/static/nextdash-logo.png" {
		t.Fatalf("self: %+v", self.Icon)
	}

	s := h.store.GetSettings()
	s.DockerContainerIcons = map[string]string{"sonarr": "letter", "radarr": "my-radarr.svg", "bad": "../x.svg", "word": "rainbow"}
	if err := h.store.SaveSettings(s); err != nil {
		t.Fatal(err)
	}
	if got := h.store.GetSettings().DockerContainerIcons; len(got) != 2 || got["bad"] != "" || got["word"] != "" {
		t.Fatalf("normalised: %v", got)
	}
	if v := row("lscr.io/linuxserver/sonarr", "sonarr"); v.Icon != nil || v.IconOverride != "letter" {
		t.Fatalf("letter: %+v %q", v.Icon, v.IconOverride)
	}
	if v := row("lscr.io/linuxserver/radarr", "radarr"); v.Icon != nil || v.IconOverride != "my-radarr.svg" {
		t.Fatalf("chosen file: %+v %q", v.Icon, v.IconOverride)
	}
}

// A file a container's override names survives the bookmark that had it
// letting it go.
func TestRemoveUnusedIconKeepsContainerOverride(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)
	fs := NewStore().(*FileStore)
	s := fs.GetSettings()
	s.DockerContainerIcons = map[string]string{"radarr": "radarr.svg"}
	if err := fs.SaveSettings(s); err != nil {
		t.Fatal(err)
	}
	_ = os.MkdirAll(filepath.Join(dir, "icons"), 0o755)
	for _, n := range []string{"radarr.svg", "loose.svg"} {
		_ = os.WriteFile(filepath.Join(dir, "icons", n), []byte("<svg/>"), 0o644)
	}
	fs.removeUnusedIconFiles([]string{"radarr.svg", "loose.svg"})
	if _, err := os.Stat(filepath.Join(dir, "icons", "radarr.svg")); err != nil {
		t.Fatal("the override's file was removed")
	}
	if _, err := os.Stat(filepath.Join(dir, "icons", "loose.svg")); err == nil {
		t.Fatal("an unreferenced file was kept")
	}
}
