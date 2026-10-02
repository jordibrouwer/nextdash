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

func TestBuildUnraidQueryNoEmptySelections(t *testing.T) {
	s := fixtureSchema(t)
	// Empty out types that make selections optional or test fallback
	s["UPSBattery"] = []string{}
	s["UPSPower"] = []string{}
	s["InfoOs"] = []string{}
	delete(s, "ParityCheck")

	for _, area := range []string{"array", "parity", "shares", "vms", "ups", "notifications", "info"} {
		q, ok := buildUnraidQuery(area, s)

		// array, info and parity should fail (parityCheckStatus, os are essential)
		if area == "array" || area == "info" || area == "parity" {
			if ok {
				t.Fatalf("%s should return ok=false when essential fields are missing, got: %s", area, q)
			}
			continue
		}

		// Others should pass
		if !ok {
			t.Fatalf("%s returned ok=false unexpectedly: %s", area, q)
		}

		// No empty selections in any query
		if strings.Contains(q, "{ }") || strings.Contains(q, "{  }") {
			t.Fatalf("%s has empty selection set: %s", area, q)
		}
	}
}

func TestBuildUnraidQueryNotificationFilter(t *testing.T) {
	s := fixtureSchema(t)
	// Test with only limit
	s["NotificationFilter"] = []string{"limit"}
	q, ok := buildUnraidQuery("notifications", s)
	if !ok {
		t.Fatalf("notifications with limit should work")
	}
	if !strings.Contains(q, "limit: 20") {
		t.Fatalf("query should have limit: 20, got %s", q)
	}
	if strings.Contains(q, "type:") {
		t.Fatalf("query should not have type: when NotificationFilter lacks it, got %s", q)
	}
	if strings.Contains(q, "offset:") {
		t.Fatalf("query should not have offset: when NotificationFilter lacks it, got %s", q)
	}
}
