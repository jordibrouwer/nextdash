package app

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func unraidTestServer(t *testing.T, status int, body string) (UnraidServer, *[]string) {
	t.Helper()
	var seen []string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r.URL.Path, r.Header.Get("x-api-key"), r.Method)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(ts.Close)
	return UnraidServer{ID: "s", BaseURL: ts.URL, Enabled: true}, &seen
}

func TestUnraidQueryPostsWithTheKey(t *testing.T) {
	srv, seen := unraidTestServer(t, 200, `{"data":{"array":{"state":"STARTED"}}}`)
	data, errs, err := unraidQuery(context.Background(), srv, "k1", "# area: array\n{ array { state } }", true)
	if err != nil || len(errs) != 0 {
		t.Fatalf("err=%v errs=%v", err, errs)
	}
	if !strings.Contains(string(data), "STARTED") {
		t.Fatalf("data = %s", data)
	}
	if (*seen)[0] != "/graphql" || (*seen)[1] != "k1" || (*seen)[2] != "POST" {
		t.Fatalf("request = %v", *seen)
	}
}

func TestUnraidQueryKeepsDataBesideAForbiddenField(t *testing.T) {
	srv, _ := unraidTestServer(t, 200, `{"data":{"vms":null,"array":{"state":"STARTED"}},
	  "errors":[{"message":"Forbidden resource","path":["vms"],"extensions":{"code":"FORBIDDEN"}}]}`)
	data, errs, err := unraidQuery(context.Background(), srv, "k", "{ x }", true)
	if err != nil || len(errs) != 1 || !errs[0].Forbidden() || errs[0].Path[0] != "vms" {
		t.Fatalf("err=%v errs=%+v", err, errs)
	}
	if !strings.Contains(string(data), "STARTED") {
		t.Fatal("lost the rest of the data")
	}
}

func TestUnraidQueryNamesAValidationFailure(t *testing.T) {
	srv, _ := unraidTestServer(t, 400, `{"errors":[{"message":"Cannot query field \"upsDevices\" on type \"Query\".","extensions":{"code":"GRAPHQL_VALIDATION_FAILED"}}]}`)
	_, _, err := unraidQuery(context.Background(), srv, "k", "{ x }", true)
	var v unraidValidationError
	if !errors.As(err, &v) {
		t.Fatalf("want validation error, got %v", err)
	}
}

func TestUnraidQueryStatusErrors(t *testing.T) {
	for status, want := range map[int]error{401: errUnraidUnauthorized, 403: errUnraidUnauthorized, 429: errUnraidRateLimited, 404: errUnraidNoAPI} {
		srv, _ := unraidTestServer(t, status, `{}`)
		if _, _, err := unraidQuery(context.Background(), srv, "k", "{ x }", true); !errors.Is(err, want) {
			t.Fatalf("%d: got %v", status, err)
		}
	}
}

func TestUnraidQueryNeverEchoesTheKey(t *testing.T) {
	srv, _ := unraidTestServer(t, 500, `boom secret-key-123`)
	_, _, err := unraidQuery(context.Background(), srv, "secret-key-123", "{ x }", true)
	if err == nil || strings.Contains(err.Error(), "secret-key-123") {
		t.Fatalf("err = %v", err)
	}
}

func TestUnraidQueryFixtureMode(t *testing.T) {
	t.Setenv("NEXTDASH_UNRAID_FIXTURE", "testdata/unraid")
	data, _, err := unraidQuery(context.Background(), UnraidServer{BaseURL: "http://nowhere"}, "", "# area: vms\n{ vms { domains { name } } }", true)
	if err != nil || !strings.Contains(string(data), "home-assistant") {
		t.Fatalf("err=%v data=%s", err, data)
	}
}
