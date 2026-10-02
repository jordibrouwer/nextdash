package app

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func fixtureSchema(t *testing.T) unraidSchema {
	t.Helper()
	raw, err := os.ReadFile("testdata/unraid/introspection.json")
	if err != nil {
		t.Fatal(err)
	}
	data, _, err := decodeUnraidAnswer(200, raw)
	if err != nil {
		t.Fatal(err)
	}
	var s unraidSchema
	if err := json.Unmarshal(data, &s); err != nil {
		t.Fatal(err)
	}
	return s
}

func TestBuildUnraidQueryUsesOnlyKnownFields(t *testing.T) {
	s := fixtureSchema(t)
	q, ok := buildUnraidQuery("array", s)
	if !ok || !strings.HasPrefix(q, "# area: array\n") {
		t.Fatalf("ok=%v q=%q", ok, q)
	}
	for _, want := range []string{"kilobytes", "numErrors", "isSpinning", "parityCheckStatus"} {
		if !strings.Contains(q, want) {
			t.Fatalf("missing %s in %s", want, q)
		}
	}
	delete(s, "UPSDevice")
	s["Query"] = []string{"array"}
	if _, ok := buildUnraidQuery("ups", s); ok {
		t.Fatal("ups without upsDevices should be unsupported")
	}
}

func TestBuildUnraidQueryFallsBackForAnOlderCapacity(t *testing.T) {
	s := fixtureSchema(t)
	s["ArrayCapacity"] = []string{"disks"}
	q, ok := buildUnraidQuery("array", s)
	if !ok || strings.Contains(q, "kilobytes") {
		t.Fatalf("ok=%v q=%s", ok, q)
	}
}

func TestBuildUnraidQueryVersionsShape(t *testing.T) {
	s := fixtureSchema(t)
	q, _ := buildUnraidQuery("info", s)
	if !strings.Contains(q, "core { unraid api }") {
		t.Fatalf("q = %s", q)
	}
	s["InfoVersions"] = []string{"unraid", "api"}
	q, _ = buildUnraidQuery("info", s)
	if !strings.Contains(q, "versions { unraid api }") {
		t.Fatalf("q = %s", q)
	}
}

func TestLoadUnraidSchemaFromFixture(t *testing.T) {
	t.Setenv("NEXTDASH_UNRAID_FIXTURE", "testdata/unraid")
	forgetUnraidSchema("fx")
	s, err := loadUnraidSchema(context.Background(), UnraidServer{ID: "fx", BaseURL: "http://nowhere"}, "", true)
	if err != nil {
		t.Fatal(err)
	}
	if !s.has("ArrayDisk", "numErrors") {
		t.Fatal("schema should have ArrayDisk.numErrors from fixture")
	}
}
