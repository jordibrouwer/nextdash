package app

import (
	"os"
	"strings"
	"testing"
)

// The Docker build stamps the version with `go build -ldflags -X <path>.buildVersion=...`,
// where <path> is this package's full import path. The linker does not complain
// about a variable it cannot find: the build succeeds, the flag does nothing,
// and /version reports "dev" forever. Moving or renaming this package breaks the
// stamp exactly that quietly, which is what this test is here to make loud.
func TestBuildVersionLdflagPathMatchesPackage(t *testing.T) {
	const pkgPath = "github.com/jordibrouwer/nextDash/internal/app"

	dockerfile, err := os.ReadFile(repoFile(t, "Dockerfile"))
	if err != nil {
		t.Fatalf("read Dockerfile: %v", err)
	}
	body := string(dockerfile)

	for _, name := range []string{"buildVersion", "buildCommit"} {
		want := "-X " + pkgPath + "." + name + "="
		if !strings.Contains(body, want) {
			t.Errorf("Dockerfile does not stamp %s through this package.\n"+
				"  want a flag containing: %s\n"+
				"  Update the -ldflags line to match the package's import path.", name, want)
		}
	}

	// A leftover `-X main.buildVersion=` would also silently do nothing, since
	// these variables no longer live in package main.
	if strings.Contains(body, "-X main.build") {
		t.Error("Dockerfile still stamps -X main.build…, but buildVersion and buildCommit live in " + pkgPath)
	}
}
