package app

import (
	"context"
	"encoding/json"
	"errors"
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

// unraidSelection is one field of a built query and what it selects.
type unraidSelection struct {
	name     string
	children []unraidSelection
}

// parseUnraidSelections reads a built query's selection tree: names and
// braces, with arguments in parentheses skipped (they hold braces of their own).
func parseUnraidSelections(t *testing.T, query string) []unraidSelection {
	t.Helper()
	var lines []string
	for _, l := range strings.Split(query, "\n") {
		if !strings.HasPrefix(strings.TrimSpace(l), "#") {
			lines = append(lines, l)
		}
	}
	src := strings.Join(lines, " ")
	var toks []string
	for i := 0; i < len(src); {
		c := src[i]
		switch {
		case c == ' ' || c == '\t' || c == '\n' || c == ',':
			i++
		case c == '(':
			depth := 0
			for ; i < len(src); i++ {
				if src[i] == '(' {
					depth++
				} else if src[i] == ')' {
					depth--
					if depth == 0 {
						i++
						break
					}
				}
			}
		case c == '{' || c == '}':
			toks = append(toks, string(c))
			i++
		default:
			j := i
			for j < len(src) && strings.IndexByte(" \t\n,{}()", src[j]) < 0 {
				j++
			}
			toks = append(toks, src[i:j])
			i = j
		}
	}
	pos := 0
	var parse func() []unraidSelection
	parse = func() []unraidSelection {
		if pos >= len(toks) || toks[pos] != "{" {
			t.Fatalf("expected { at token %d in %q", pos, query)
		}
		pos++
		var out []unraidSelection
		for pos < len(toks) && toks[pos] != "}" {
			s := unraidSelection{name: toks[pos]}
			pos++
			if pos < len(toks) && toks[pos] == "{" {
				s.children = parse()
				if len(s.children) == 0 {
					t.Fatalf("%s has an empty selection in %q", s.name, query)
				}
			}
			out = append(out, s)
		}
		if pos >= len(toks) {
			t.Fatalf("unbalanced braces in %q", query)
		}
		pos++
		return out
	}
	sels := parse()
	if pos != len(toks) {
		t.Fatalf("trailing tokens after the query in %q", query)
	}
	return sels
}

// The object fields the queries descend into, and the type each one is.
// A field not listed here (core, kilobytes, overview, unread) is a type the
// introspection does not ask about; its children are not checked.
var unraidFieldTypes = map[string]string{
	"array": "UnraidArray", "parities": "ArrayDisk", "disks": "ArrayDisk", "caches": "ArrayDisk",
	"parityCheckStatus": "ParityCheck", "parityHistory": "ParityCheck", "capacity": "ArrayCapacity",
	"shares": "Share", "vms": "Vms", "domains": "VmDomain", "upsDevices": "UPSDevice",
	"battery": "UPSBattery", "power": "UPSPower", "notifications": "Notifications", "list": "Notification",
	"info": "Info", "os": "InfoOs", "versions": "InfoVersions", "me": "UserAccount",
}

func checkUnraidSelections(t *testing.T, s unraidSchema, typ, area string, sels []unraidSelection) {
	t.Helper()
	for _, sel := range sels {
		if !s.has(typ, sel.name) {
			t.Errorf("%s: %s has no field %q", area, typ, sel.name)
			continue
		}
		if len(sel.children) == 0 {
			continue
		}
		if child, ok := unraidFieldTypes[sel.name]; ok {
			checkUnraidSelections(t, s, child, area, sel.children)
		}
	}
}

// Every field of every built query exists on its parent type: GraphQL refuses
// a whole query for one field in the wrong place.
func TestBuildUnraidQueryShapeMatchesTheSchema(t *testing.T) {
	full := fixtureSchema(t)
	trimmed := fixtureSchema(t)
	trimmed["UnraidArray"] = []string{"state", "disks", "parityCheckStatus"} // no parities, caches or capacity
	for name, s := range map[string]unraidSchema{"full": full, "trimmed": trimmed} {
		for _, area := range []string{"array", "parity", "shares", "vms", "ups", "notifications", "info"} {
			q, ok := buildUnraidQuery(area, s)
			if !ok {
				t.Fatalf("%s/%s: not built", name, area)
			}
			checkUnraidSelections(t, s, "Query", name+"/"+area, parseUnraidSelections(t, q))
		}
	}
}

// The live answer: one aliased __type per type, an input type with
// inputFields, and a type the server does not have as null.
func TestParseUnraidIntrospectionAliased(t *testing.T) {
	raw := json.RawMessage(`{
	  "t0":{"name":"Query","fields":[{"name":"array"},{"name":"me"}],"inputFields":null},
	  "t1":{"name":"NotificationFilter","fields":null,"inputFields":[{"name":"type"},{"name":"limit"}]},
	  "t2":{"name":"ArrayDisk","fields":[{"name":"name"},{"name":"temp"}],"inputFields":null},
	  "t3":null}`)
	s, err := parseUnraidIntrospection(raw)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range [][2]string{{"Query", "array"}, {"Query", "me"}, {"NotificationFilter", "limit"}, {"NotificationFilter", "type"}, {"ArrayDisk", "temp"}} {
		if !s.has(c[0], c[1]) {
			t.Errorf("%s.%s missing from %v", c[0], c[1], s)
		}
	}
	if len(s) != 3 {
		t.Fatalf("types = %v", s)
	}
	if _, err := parseUnraidIntrospection(json.RawMessage(`{"t0":null}`)); !errors.Is(err, errUnraidNoAPI) {
		t.Fatalf("no Query type: err = %v", err)
	}
}
