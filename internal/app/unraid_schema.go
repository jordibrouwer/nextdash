package app

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"
)

/*
What this Unraid server's API knows, asked once a day.

The API releases often and GraphQL refuses a whole query for one field it does
not know. So each query is built from the fields the schema actually has: a
field that is missing is left out, and an area that cannot be drawn without it
is reported as unsupported instead of breaking the rest.
*/

type unraidSchema map[string][]string

func (s unraidSchema) has(typ, field string) bool {
	for _, f := range s[typ] {
		if f == field {
			return true
		}
	}
	return false
}

var unraidSchemaTypes = []string{
	"Query", "UnraidArray", "ArrayCapacity", "ArrayDisk", "ParityCheck", "Share", "VmDomain",
	"UPSDevice", "UPSBattery", "UPSPower", "Notifications", "Notification", "NotificationFilter",
	"Info", "InfoOs", "InfoVersions", "UserAccount",
}

const unraidSchemaTTL = 24 * time.Hour

type unraidSchemaEntry struct {
	schema unraidSchema
	at     time.Time
}

var (
	unraidSchemaMu    sync.Mutex
	unraidSchemaCache = map[string]unraidSchemaEntry{}
)

func forgetUnraidSchema(serverID string) {
	unraidSchemaMu.Lock()
	delete(unraidSchemaCache, serverID)
	unraidSchemaMu.Unlock()
}

func loadUnraidSchema(ctx context.Context, srv UnraidServer, key string, allowLocal bool) (unraidSchema, error) {
	unraidSchemaMu.Lock()
	if e, ok := unraidSchemaCache[srv.ID]; ok && time.Since(e.at) < unraidSchemaTTL {
		unraidSchemaMu.Unlock()
		return e.schema, nil
	}
	unraidSchemaMu.Unlock()

	var b strings.Builder
	b.WriteString("# area: introspection\n{\n")
	for i, typ := range unraidSchemaTypes {
		// Input types list inputFields, object types list fields; asking both is harmless.
		fmt.Fprintf(&b, "  t%d: __type(name: %q) { name fields { name } inputFields { name } }\n", i, typ)
	}
	b.WriteString("}")
	data, _, err := unraidQuery(ctx, srv, key, b.String(), allowLocal)
	if err != nil {
		return nil, err
	}
	schema, err := parseUnraidIntrospection(data)
	if err != nil {
		return nil, err
	}
	unraidSchemaMu.Lock()
	unraidSchemaCache[srv.ID] = unraidSchemaEntry{schema: schema, at: time.Now()}
	unraidSchemaMu.Unlock()
	return schema, nil
}

// parseUnraidIntrospection accepts the live aliased answer, and the fixture
// form {"Type": ["field", ...]} that testdata/unraid/introspection.json stores.
func parseUnraidIntrospection(data json.RawMessage) (unraidSchema, error) {
	var flat unraidSchema
	if json.Unmarshal(data, &flat) == nil && len(flat) > 0 && flat["Query"] != nil {
		return flat, nil
	}
	var aliased map[string]*struct {
		Name        string                  `json:"name"`
		Fields      []struct{ Name string } `json:"fields"`
		InputFields []struct{ Name string } `json:"inputFields"`
	}
	if err := json.Unmarshal(data, &aliased); err != nil {
		return nil, fmt.Errorf("unraid: the schema could not be read")
	}
	out := unraidSchema{}
	for _, t := range aliased {
		if t == nil {
			continue
		}
		for _, f := range append(t.Fields, t.InputFields...) {
			out[t.Name] = append(out[t.Name], f.Name)
		}
	}
	if len(out["Query"]) == 0 {
		return nil, errUnraidNoAPI
	}
	return out, nil
}

// pick keeps the wanted fields the type has, in the order asked.
func (s unraidSchema) pick(typ string, wanted ...string) string {
	var got []string
	for _, f := range wanted {
		if s.has(typ, f) {
			got = append(got, f)
		}
	}
	return strings.Join(got, " ")
}

// sel wraps a selection with a name and braces, or returns empty if fields is empty.
func sel(name, fields string) string {
	if strings.TrimSpace(fields) == "" {
		return ""
	}
	return name + " { " + fields + " }"
}

func (s unraidSchema) diskFields() string {
	return s.pick("ArrayDisk", "name", "status", "temp", "numErrors", "fsSize", "fsUsed", "fsFree", "isSpinning", "type")
}

func (s unraidSchema) parityFields() string {
	return s.pick("ParityCheck", "status", "running", "paused", "progress", "speed", "errors", "date", "duration", "correcting")
}

func (s unraidSchema) capacityFields() string {
	if s.has("ArrayCapacity", "kilobytes") {
		return "capacity { kilobytes { free used total } }"
	}
	return "" // summed from the data disks in unraid_model.go
}

func (s unraidSchema) buildNotificationFilter() string {
	var parts []string
	if s.has("NotificationFilter", "type") {
		parts = append(parts, "type: UNREAD")
	}
	if s.has("NotificationFilter", "offset") {
		parts = append(parts, "offset: 0")
	}
	if s.has("NotificationFilter", "limit") {
		parts = append(parts, "limit: 20")
	}
	return strings.Join(parts, ", ")
}

func buildUnraidQuery(area string, s unraidSchema) (string, bool) {
	q := func(body string) (string, bool) { return "# area: " + area + "\n{ " + body + " }", true }
	switch area {
	case "array":
		if !s.has("Query", "array") || !s.has("ArrayDisk", "name") {
			return "", false
		}
		d := s.diskFields()
		if d == "" {
			return "", false // disks are essential
		}
		pf := s.parityFields()
		if pf == "" {
			return "", false // parityCheckStatus is essential
		}
		var parts []string
		parts = append(parts, s.pick("UnraidArray", "state"))
		if cap := s.capacityFields(); cap != "" {
			parts = append(parts, cap)
		}
		parts = append(parts, sel("parities", pf))
		parts = append(parts, sel("disks", d))
		parts = append(parts, sel("caches", d))
		parts = append(parts, sel("parityCheckStatus", pf))
		body := sel("array", strings.TrimSpace(strings.Join(parts, " ")))
		return q(body)
	case "parity":
		if !s.has("UnraidArray", "parityCheckStatus") {
			return "", false
		}
		pf := s.parityFields()
		if pf == "" {
			return "", false // parityCheckStatus is essential
		}
		var parts []string
		parts = append(parts, sel("parityCheckStatus", pf))
		if s.has("Query", "parityHistory") {
			if ph := s.pick("ParityCheck", "date", "duration", "speed", "status", "errors"); ph != "" {
				parts = append(parts, sel("parityHistory", ph))
			}
		}
		body := sel("array", strings.TrimSpace(strings.Join(parts, " ")))
		return q(body)
	case "shares":
		if !s.has("Query", "shares") {
			return "", false
		}
		sh := s.pick("Share", "name", "used", "free", "size", "cache")
		if sh == "" {
			return "", false // shares are essential
		}
		return q(sel("shares", sh))
	case "vms":
		if !s.has("Query", "vms") || !s.has("VmDomain", "state") {
			return "", false
		}
		vd := s.pick("VmDomain", "name", "state")
		if vd == "" {
			return "", false // domains are essential
		}
		return q(sel("vms", sel("domains", vd)))
	case "ups":
		if !s.has("Query", "upsDevices") {
			return "", false
		}
		ud := s.pick("UPSDevice", "name", "model", "status")
		ub := s.pick("UPSBattery", "chargeLevel", "estimatedRuntime")
		up := s.pick("UPSPower", "loadPercentage", "currentPower")
		if ud == "" && ub == "" && up == "" {
			return "", false // need at least something
		}
		var parts []string
		if ud != "" {
			parts = append(parts, ud)
		}
		if ub != "" {
			parts = append(parts, sel("battery", ub))
		}
		if up != "" {
			parts = append(parts, sel("power", up))
		}
		return q(sel("upsDevices", strings.TrimSpace(strings.Join(parts, " "))))
	case "notifications":
		if !s.has("Query", "notifications") {
			return "", false
		}
		filt := s.buildNotificationFilter()
		if filt == "" {
			return "", false // need at least limit
		}
		nf := s.pick("Notification", "id", "title", "subject", "description", "importance", "link", "timestamp")
		if nf == "" {
			return "", false // notification fields are essential
		}
		return q("notifications { overview { unread { info warning alert total } } list(filter: { " + filt + " }) { " + nf + " } }")
	case "info":
		iof := s.pick("InfoOs", "hostname", "release", "uptime")
		if iof == "" {
			return "", false // os is essential
		}
		var infoParts []string
		infoParts = append(infoParts, sel("os", iof))
		switch {
		case s.has("InfoVersions", "core"):
			infoParts = append(infoParts, "versions { core { unraid api } }")
		case s.has("InfoVersions", "unraid"):
			infoParts = append(infoParts, "versions { unraid api }")
		}
		if s.has("Query", "me") && s.has("UserAccount", "roles") {
			infoParts = append(infoParts, "me { roles }")
		}
		return q(sel("info", strings.TrimSpace(strings.Join(infoParts, " "))))
	}
	return "", false
}
