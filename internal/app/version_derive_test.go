package app

import (
	"os/exec"
	"strings"
	"testing"
)

// The Docker build stamps VERSION from scripts/version-from-index.sh, which
// the Makefile's up/build/build-clean targets export before invoking `docker
// compose` (docker-compose.yml and docker-compose.prod.yml interpolate it
// into the image build's --build-arg — see the Makefile's comment above
// `build`). That script is the actual derivation, so this test runs it and
// checks its output against static/data/whats-new/index.json[0].tag rather
// than reimplementing the script's parsing here.
//
// readLatestReleaseTag (release_version.go) reads the same field for the same
// reason — this test's "want" side is exactly that function, not a second
// parser that could disagree with it.
func TestBuildVersionDerivationMatchesWhatsNewIndex(t *testing.T) {
	want := readLatestReleaseTag()
	if want == "" {
		t.Fatal("readLatestReleaseTag() returned empty — could not read static/data/whats-new/index.json[0].tag")
	}

	script := repoFile(t, "scripts", "version-from-index.sh")
	out, err := exec.Command(script).CombinedOutput()
	if err != nil {
		t.Fatalf("scripts/version-from-index.sh failed: %v\n%s", err, out)
	}
	got := strings.TrimSpace(string(out))

	if got != want {
		t.Errorf("scripts/version-from-index.sh derived VERSION=%q, but index.json[0].tag is %q — the Docker build would stamp a version the docs do not claim",
			got, want)
	}
}
