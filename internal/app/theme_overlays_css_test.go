package app

import (
	"os"
	"regexp"
	"sort"
	"strings"
	"testing"
)

var overlayMaterialBlock = regexp.MustCompile(`(?m)^html\[data-theme\] body\[data-material-style="signature"\]\[data-material="([a-z-]+)"\] \{\n((?:    .*\n)+)\}`)
var overlayMaterialAttr = regexp.MustCompile(`data-material="([a-z-]+)"\]`)

func overlayMaterials(t *testing.T, path string) []string {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, m := range overlayMaterialAttr.FindAllStringSubmatch(string(raw), -1) {
		if m[1] != "" {
			seen[m[1]] = true
		}
	}
	out := make([]string, 0, len(seen))
	for k := range seen {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// Every material the dashboard draws has a layer look, and none is invented for the overlays alone.
func TestOverlayCSSCoversTheSameMaterialsAsTheDashboard(t *testing.T) {
	got := overlayMaterials(t, "../../static/css/theme-overlays.css")
	want := overlayMaterials(t, "../../static/css/theme-signature.css")
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("overlay materials %v differ from dashboard materials %v", got, want)
	}
}

// Each material block sets the whole variable set, so a layer never falls back to another material's value.
func TestOverlayCSSMaterialBlocksSetEveryVariable(t *testing.T) {
	raw, err := os.ReadFile("../../static/css/theme-overlays.css")
	if err != nil {
		t.Fatal(err)
	}
	vars := []string{"--ov-radius", "--ov-alpha", "--ov-alpha-small", "--ov-fill", "--ov-fill-small", "--ov-image", "--ov-image-big", "--ov-edge", "--ov-edge-big", "--ov-cast", "--ov-blur", "--ov-rule", "--ov-hot", "--ov-r-control", "--ov-r-item", "--ov-head-transform"}
	blocks := overlayMaterialBlock.FindAllStringSubmatch(string(raw), -1)
	if len(blocks) != 12 {
		t.Fatalf("expected 12 material blocks, found %d", len(blocks))
	}
	for _, b := range blocks {
		for _, v := range vars {
			if !strings.Contains(b[2], "    "+v+":") {
				t.Errorf("material %s misses %s", b[1], v)
			}
		}
	}
}

func TestOverlayCSSDefinesTheLevelTokens(t *testing.T) {
	raw, err := os.ReadFile("../../static/css/theme-overlays.css")
	if err != nil {
		t.Fatal(err)
	}
	for _, v := range []string{"--ov-e2:", "--ov-e3:", "--ov-bar:", "--ov-scrim-3:", "--ov-scrim-4:", "--ov-lift-2:", "--ov-lift-3:", "--ov-lift-4:", "--ov-ease-in:", "--ov-ease-out:", "--ov-rise:"} {
		if !strings.Contains(string(raw), v) {
			t.Errorf("level token %s is not defined", v)
		}
	}
}

// The overlay sheet must win the cascade over the signature sheet and lose to reduced motion.
func TestOverlaySheetIsLinkedBetweenSignatureAndReducedMotion(t *testing.T) {
	raw, err := os.ReadFile("../../templates/dashboard.html")
	if err != nil {
		t.Fatal(err)
	}
	html := string(raw)
	sig := strings.Index(html, "css/theme-signature.css")
	ov := strings.Index(html, "css/theme-overlays.css")
	rm := strings.Index(html, "css/reduced-motion.css")
	if sig < 0 || ov < 0 || rm < 0 || !(sig < ov && ov < rm) {
		t.Fatalf("link order wrong: signature=%d overlays=%d reduced-motion=%d", sig, ov, rm)
	}
	if !strings.Contains(html, "js/overlay-layers.js") {
		t.Fatal("overlay-layers.js is not loaded")
	}
}
