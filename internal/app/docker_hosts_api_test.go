package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func hostsCall(t *testing.T, router http.Handler, method, path, body string, token string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if token != "" {
		req.Header.Set("X-NextDash-Token", token)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func TestDockerHostsAPIWritesNeedTheToken(t *testing.T) {
	hostsTestDir(t)
	t.Setenv("NEXTDASH_WRITE_TOKEN", "tok")
	router := newDockerTestRouter(dockerTestHandlers(t))
	add := `{"name":"pi","kind":"tcp","address":"10.0.0.2:2375"}`
	for _, c := range []struct{ method, path string }{
		{"POST", "/api/docker/hosts"}, {"PUT", "/api/docker/hosts/d_x"},
		{"DELETE", "/api/docker/hosts/d_x"}, {"POST", "/api/docker/hosts/test"},
	} {
		if rec := hostsCall(t, router, c.method, c.path, add, ""); rec.Code != http.StatusUnauthorized {
			t.Errorf("%s %s without token = %d", c.method, c.path, rec.Code)
		}
	}
	if rec := hostsCall(t, router, "GET", "/api/docker/hosts", "", ""); rec.Code != http.StatusOK {
		t.Errorf("list = %d", rec.Code)
	}
	if rec := hostsCall(t, router, "POST", "/api/docker/hosts", add, "tok"); rec.Code != http.StatusOK {
		t.Errorf("add with token = %d %s", rec.Code, rec.Body)
	}
}

func TestDockerHostsAPINeverReturnsCertificates(t *testing.T) {
	hostsTestDir(t)
	pki := newDockerTestPKI(t)
	router := newDockerTestRouter(dockerTestHandlers(t))
	body, _ := json.Marshal(map[string]any{"name": "nas", "kind": "tls", "address": "10.0.0.5:2376",
		"ca": pki.CA, "cert": pki.Cert, "key": pki.Key})
	if rec := hostsCall(t, router, "POST", "/api/docker/hosts", string(body), ""); rec.Code != http.StatusOK || strings.Contains(rec.Body.String(), "BEGIN") {
		t.Fatalf("add: %d %s", rec.Code, rec.Body)
	}
	rec := hostsCall(t, router, "GET", "/api/docker/hosts", "", "")
	if strings.Contains(rec.Body.String(), "BEGIN") || strings.Contains(rec.Body.String(), "PRIVATE") {
		t.Fatalf("list leaked key material: %s", rec.Body)
	}
	var out struct {
		Hosts []dockerHostView `json:"hosts"`
		Max   int              `json:"max"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if len(out.Hosts) != 1 || !out.Hosts[0].HasCA || !out.Hosts[0].HasCert || !out.Hosts[0].HasKey || out.Max != 4 {
		t.Fatalf("view = %+v", out)
	}
}

func TestDockerHostsAPIEditAndRemove(t *testing.T) {
	hostsTestDir(t)
	router := newDockerTestRouter(dockerTestHandlers(t))
	rec := hostsCall(t, router, "POST", "/api/docker/hosts", `{"name":"pi","kind":"tcp","address":"10.0.0.2:2375"}`, "")
	var added dockerHostView
	_ = json.Unmarshal(rec.Body.Bytes(), &added)
	rec = hostsCall(t, router, "PUT", "/api/docker/hosts/"+added.ID, `{"name":"pi","kind":"tcp","address":"10.0.0.2:2375","allowActions":true}`, "")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"allowActions":true`) {
		t.Fatalf("edit: %d %s", rec.Code, rec.Body)
	}
	if rec = hostsCall(t, router, "PUT", "/api/docker/hosts/d_nope", `{"name":"x","kind":"tcp","address":"h:1"}`, ""); rec.Code != http.StatusNotFound {
		t.Errorf("edit unknown = %d", rec.Code)
	}
	if rec = hostsCall(t, router, "DELETE", "/api/docker/hosts/"+added.ID, "", ""); rec.Code != http.StatusOK {
		t.Fatalf("remove: %d", rec.Code)
	}
	if rec = hostsCall(t, router, "DELETE", "/api/docker/hosts/"+added.ID, "", ""); rec.Code != http.StatusNotFound {
		t.Errorf("remove twice = %d", rec.Code)
	}
}

func TestDockerHostTestReportsWhyItFailed(t *testing.T) {
	hostsTestDir(t)
	router := newDockerTestRouter(dockerTestHandlers(t))
	probe := func(body string) dockerHostProbe {
		rec := hostsCall(t, router, "POST", "/api/docker/hosts/test", body, "")
		var out dockerHostProbe
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		return out
	}

	f, addr := startFakeDockerTCP(t)
	_ = f
	if got := probe(`{"kind":"tcp","address":"` + addr + `"}`); !got.OK {
		t.Errorf("tcp daemon: %+v", got)
	}
	if got := probe(`{"kind":"tcp","address":"127.0.0.1:1"}`); got.OK || got.Reason != "refused" {
		t.Errorf("closed port: %+v", got)
	}
	// An https client against a plain daemon.
	if got := probe(`{"kind":"tls","address":"` + addr + `"}`); got.OK || got.Reason != "wrong-protocol" {
		t.Errorf("tls against tcp: %+v", got)
	}

	_, tlsAddr, pki := startFakeDockerTLS(t, true)
	caOnly, _ := json.Marshal(map[string]any{"kind": "tls", "address": tlsAddr, "ca": pki.CA})
	if got := probe(string(caOnly)); got.OK || got.Reason != "tls-rejected" {
		t.Errorf("no client cert: %+v", got)
	}
	full, _ := json.Marshal(map[string]any{"kind": "tls", "address": tlsAddr, "ca": pki.CA, "cert": pki.Cert, "key": pki.Key})
	if got := probe(string(full)); !got.OK {
		t.Errorf("with client cert: %+v", got)
	}
	other := newDockerTestPKI(t)
	wrongCA, _ := json.Marshal(map[string]any{"kind": "tls", "address": tlsAddr, "ca": other.CA})
	if got := probe(string(wrongCA)); got.OK || got.Reason != "tls-untrusted" {
		t.Errorf("wrong CA: %+v", got)
	}
}

func TestDockerHostTestUsesStoredCertsForASavedHost(t *testing.T) {
	hostsTestDir(t)
	router := newDockerTestRouter(dockerTestHandlers(t))
	_, addr, pki := startFakeDockerTLS(t, true)
	body, _ := json.Marshal(map[string]any{"name": "nas", "kind": "tls", "address": addr, "ca": pki.CA, "cert": pki.Cert, "key": pki.Key})
	rec := hostsCall(t, router, "POST", "/api/docker/hosts", string(body), "")
	var h dockerHostView
	_ = json.Unmarshal(rec.Body.Bytes(), &h)
	rec = hostsCall(t, router, "POST", "/api/docker/hosts/test", `{"id":"`+h.ID+`"}`, "")
	if !strings.Contains(rec.Body.String(), `"ok":true`) {
		t.Fatalf("saved host test: %s", rec.Body)
	}
}

func TestHostProbeFlagsAProxyThatRefusesTheContainerList(t *testing.T) {
	hostsTestDir(t)
	router := newDockerTestRouter(dockerTestHandlers(t))
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/_ping" {
			_, _ = w.Write([]byte("OK"))
			return
		}
		w.WriteHeader(http.StatusForbidden)
	}))
	defer srv.Close()
	rec := hostsCall(t, router, "POST", "/api/docker/hosts/test", `{"kind":"tcp","address":"`+strings.TrimPrefix(srv.URL, "http://")+`"}`, "")
	var got dockerHostProbe
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if got.OK || got.Reason != "containers-denied" {
		t.Fatalf("probe = %+v", got)
	}
}
