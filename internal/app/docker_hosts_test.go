package app

import (
	"context"
	"os"
	"strings"
	"testing"
)

func hostsTestDir(t *testing.T) {
	t.Helper()
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
}

func strp(s string) *string { return &s }

func TestDockerHostValidation(t *testing.T) {
	hostsTestDir(t)
	bad := map[string]DockerHost{
		"no name":      {Name: " ", Kind: "tcp", Address: "10.0.0.2:2375"},
		"reserved":     {Name: "Local", Kind: "tcp", Address: "10.0.0.2:2375"},
		"reserved all": {Name: "ALL", Kind: "tcp", Address: "10.0.0.2:2375"},
		"long":         {Name: strings.Repeat("é", 65), Kind: "tcp", Address: "10.0.0.2:2375"},
		"unix kind":    {Name: "x", Kind: "unix", Address: "/var/run/docker.sock"},
		"no port":      {Name: "x", Kind: "tcp", Address: "10.0.0.2"},
		"url":          {Name: "x", Kind: "tcp", Address: "http://10.0.0.2:2375"},
		"port range":   {Name: "x", Kind: "tcp", Address: "10.0.0.2:99999"},
	}
	for label, h := range bad {
		if _, err := addDockerHost(h, dockerHostSecretUpdate{}); err == nil {
			t.Errorf("%s: accepted %+v", label, h)
		}
	}
	if _, err := addDockerHost(DockerHost{Name: "pi", Kind: "tcp", Address: "10.0.0.2:2375"}, dockerHostSecretUpdate{}); err != nil {
		t.Fatal(err)
	}
	if _, err := addDockerHost(DockerHost{Name: "PI", Kind: "tcp", Address: "10.0.0.3:2375"}, dockerHostSecretUpdate{}); err == nil {
		t.Error("a name differing only in case was accepted")
	}
}

func TestDockerHostLimitIsFourRemote(t *testing.T) {
	hostsTestDir(t)
	for i := 0; i < dockerMaxRemoteHosts; i++ {
		name := string(rune('a' + i))
		if _, err := addDockerHost(DockerHost{Name: name, Kind: "tcp", Address: "10.0.0.2:2375"}, dockerHostSecretUpdate{}); err != nil {
			t.Fatalf("host %d: %v", i, err)
		}
	}
	if _, err := addDockerHost(DockerHost{Name: "extra", Kind: "tcp", Address: "10.0.0.2:2375"}, dockerHostSecretUpdate{}); err == nil {
		t.Fatal("a fifth remote host was accepted")
	}
}

func TestDockerHostSecretsStayApartAndPrivate(t *testing.T) {
	hostsTestDir(t)
	pki := newDockerTestPKI(t)
	h, err := addDockerHost(DockerHost{Name: "nas", Kind: "tls", Address: "10.0.0.5:2376"},
		dockerHostSecretUpdate{CA: &pki.CA, Cert: &pki.Cert, Key: &pki.Key})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(h.ID, "d_") || len(h.ID) != 14 {
		t.Errorf("id = %q", h.ID)
	}
	raw, _ := os.ReadFile(dockerHostsFilePath())
	if strings.Contains(string(raw), "BEGIN") {
		t.Error("certificate material ended up in docker-hosts.json")
	}
	info, err := os.Stat(dockerSecretsFilePath())
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatalf("secrets file: %v %v", info, err)
	}
	if readDockerHostSecret(h.ID).Key != strings.TrimSpace(pki.Key) {
		t.Error("key not stored")
	}
}

func TestDockerHostBadPEMIsRefusedAtOnce(t *testing.T) {
	hostsTestDir(t)
	if _, err := addDockerHost(DockerHost{Name: "nas", Kind: "tls", Address: "10.0.0.5:2376"},
		dockerHostSecretUpdate{CA: strp("not a pem")}); err == nil {
		t.Fatal("a CA that is not PEM was stored")
	}
	if len(listDockerHosts()) != 0 {
		t.Error("a refused host was kept")
	}
}

func TestRemoveDockerHostCleansUp(t *testing.T) {
	hostsTestDir(t)
	f, addr, pki := startFakeDockerTLS(t, true)
	f.add(fakeContainer{ID: strings.Repeat("c", 64), Name: "web", State: "running"})
	h, err := addDockerHost(DockerHost{Name: "nas", Kind: "tls", Address: addr},
		dockerHostSecretUpdate{CA: &pki.CA, Cert: &pki.Cert, Key: &pki.Key})
	if err != nil {
		t.Fatal(err)
	}
	api, reason := dockerHostAPI(h.ID)
	if api == nil {
		t.Fatalf("no api: %s", reason)
	}
	if list, err := api.listContainers(context.Background()); err != nil || len(list) != 1 {
		t.Fatalf("list = %+v, %v", list, err)
	}
	first := api.client
	if err := removeDockerHost(h.ID); err != nil {
		t.Fatal(err)
	}
	if _, ok := findDockerHost(h.ID); ok {
		t.Error("host still listed")
	}
	if len(readDockerSecrets().Hosts) != 0 {
		t.Error("certificates still stored")
	}
	if _, err := os.Stat(dockerSecretsFilePath()); !os.IsNotExist(err) {
		t.Error("an empty secrets file was left behind")
	}
	if _, reason := dockerHostAPI(h.ID); reason != reasonUnknownDockerHost {
		t.Errorf("reason after removal = %q", reason)
	}
	if dockerClientFor(dockerEndpointOf(h, dockerHostSecret{CA: pki.CA, Cert: pki.Cert, Key: pki.Key})) == first {
		t.Error("the removed host's client is still cached")
	}
}

func TestGitHubTokenSaveKeepsHostSecrets(t *testing.T) {
	hostsTestDir(t)
	pki := newDockerTestPKI(t)
	h, err := addDockerHost(DockerHost{Name: "nas", Kind: "tls", Address: "10.0.0.5:2376"},
		dockerHostSecretUpdate{CA: &pki.CA})
	if err != nil {
		t.Fatal(err)
	}
	if err := saveDockerGitHubToken("ghp_x"); err != nil {
		t.Fatal(err)
	}
	if err := saveDockerGitHubToken(""); err != nil {
		t.Fatal(err)
	}
	if readDockerHostSecret(h.ID).CA == "" {
		t.Fatal("clearing the GitHub token wiped a host's certificate")
	}
}

func TestUpdateDockerHostKeepsCertsUnlessCleared(t *testing.T) {
	hostsTestDir(t)
	pki := newDockerTestPKI(t)
	h, _ := addDockerHost(DockerHost{Name: "nas", Kind: "tls", Address: "10.0.0.5:2376"},
		dockerHostSecretUpdate{CA: &pki.CA})
	if _, err := updateDockerHost(h.ID, DockerHost{Name: "nas2", Kind: "tls", Address: "10.0.0.6:2376", AllowActions: true}, dockerHostSecretUpdate{}); err != nil {
		t.Fatal(err)
	}
	if readDockerHostSecret(h.ID).CA == "" {
		t.Error("an edit without secrets dropped the CA")
	}
	got, _ := findDockerHost(h.ID)
	if got.Name != "nas2" || !got.AllowActions || got.Address != "10.0.0.6:2376" {
		t.Errorf("edit lost: %+v", got)
	}
	if _, err := updateDockerHost(h.ID, got, dockerHostSecretUpdate{CA: strp("")}); err != nil {
		t.Fatal(err)
	}
	if readDockerHostSecret(h.ID).CA != "" {
		t.Error("clearing the CA did nothing")
	}
}

func TestDockerHostAPILocalIsTheEnvSocket(t *testing.T) {
	hostsTestDir(t)
	startFakeDocker(t)
	for _, id := range []string{"", "local"} {
		api, reason := dockerHostAPI(id)
		if api == nil || reason != "" || api.endpoint.Kind != "unix" {
			t.Errorf("id %q: %+v %q", id, api, reason)
		}
	}
}

func TestTCPHostKeepsNoCertificates(t *testing.T) {
	hostsTestDir(t)
	pki := newDockerTestPKI(t)
	h, err := addDockerHost(DockerHost{Name: "pi", Kind: "tcp", Address: "10.0.0.2:2375"},
		dockerHostSecretUpdate{CA: &pki.CA, Cert: &pki.Cert, Key: &pki.Key})
	if err != nil {
		t.Fatal(err)
	}
	if readDockerHostSecret(h.ID) != (dockerHostSecret{}) {
		t.Error("a tcp host kept certificate material")
	}
}

func TestPruneDockerHostSecretsDropsOrphans(t *testing.T) {
	hostsTestDir(t)
	pki := newDockerTestPKI(t)
	keep, _ := addDockerHost(DockerHost{Name: "nas", Kind: "tls", Address: "10.0.0.5:2376"}, dockerHostSecretUpdate{CA: &pki.CA})
	gone, _ := addDockerHost(DockerHost{Name: "old", Kind: "tls", Address: "10.0.0.6:2376"}, dockerHostSecretUpdate{CA: &pki.CA})
	// A restore brought back a list without "old", and left its secret.
	if err := writeDockerHostsLocked([]DockerHost{keep}); err != nil {
		t.Fatal(err)
	}
	pruneDockerHostSecrets()
	if readDockerHostSecret(gone.ID) != (dockerHostSecret{}) {
		t.Error("the orphaned certificate stayed")
	}
	if readDockerHostSecret(keep.ID).CA == "" {
		t.Error("a live host lost its certificate")
	}
}

// A restored docker-hosts.json is not trusted: an id becomes part of a file
// name, so one that is not of the generated shape is dropped on read.
func TestHostsFileWithOddIDsIsNotTrusted(t *testing.T) {
	hostsTestDir(t)
	raw := `[{"id":"a/../../x","name":"evil","kind":"tcp","address":"h:1"},
	          {"id":"local","name":"local2","kind":"tcp","address":"h:1"},
	          {"id":"d_0123456789ab","name":"ok","kind":"tcp","address":"h:1"}]`
	if err := os.WriteFile(dockerHostsFilePath(), []byte(raw), 0600); err != nil {
		t.Fatal(err)
	}
	got := listDockerHosts()
	if len(got) != 1 || got[0].ID != "d_0123456789ab" {
		t.Fatalf("hosts = %+v", got)
	}
	if _, ok := findDockerHost("a/../../x"); ok {
		t.Error("an id with a path in it was found")
	}
}
