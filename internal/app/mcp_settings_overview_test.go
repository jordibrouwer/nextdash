package app

import (
	"encoding/json"
	"os"
	"reflect"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

/*
The settings overview's safety net. The tool is built from an allowlist; these
tests hold the allowlist to what it promises: every line answers, no secret
gets out however it is stored, and no line reads a field that looks like a
secret unless that field is one of the few reduced to a host or a yes/no.
*/

func turnOnSettingsOverview(t *testing.T, h *Handlers, on bool) {
	t.Helper()
	s := h.store.GetSettings()
	s.MCPSettingsOverview = on
	if err := h.store.SaveSettings(s); err != nil {
		t.Fatal(err)
	}
}

func overviewAt(tree map[string]any, path string) (any, bool) {
	var node any = tree
	for _, part := range strings.Split(path, ".") {
		m, ok := node.(map[string]any)
		if !ok {
			return nil, false
		}
		node, ok = m[part]
		if !ok {
			return nil, false
		}
	}
	return node, true
}

func mcpDeniedName(jsonName string) bool {
	lower := strings.ToLower(jsonName)
	for _, word := range mcpOverviewDeniedWords {
		if strings.Contains(lower, word) {
			return true
		}
	}
	return false
}

func settingsJSONNames() map[string]string {
	out := map[string]string{}
	typ := reflect.TypeOf(Settings{})
	for i := 0; i < typ.NumField(); i++ {
		f := typ.Field(i)
		name, _, _ := strings.Cut(f.Tag.Get("json"), ",")
		if name == "" {
			name = f.Name
		}
		out[f.Name] = name
	}
	return out
}

func TestSettingsOverviewEveryPathAnswers(t *testing.T) {
	h := newMCPHandlers(t)
	turnOnSettingsOverview(t, h, true)
	got := toolCall(t, h, "get_settings_overview", `{}`)
	if got["error"] != nil {
		t.Fatal(got["error"])
	}
	for _, entry := range mcpSettingsOverviewAllowlist {
		v, ok := overviewAt(got, entry.path)
		if !ok || v == nil {
			t.Errorf("%s gives no value on a default install", entry.path)
		}
	}
	pages, _ := overviewAt(got, "structure.pages")
	if len(asList(pages)) != len(h.store.GetPages()) {
		t.Errorf("pages = %v", pages)
	}
	if v, _ := overviewAt(got, "assistant.mcpSettingsOverview"); v != true {
		t.Errorf("its own switch reads %v", v)
	}
}

// Every field whose name looks like a secret gets a sentinel, whatever its
// type, and so do the maps that hold addresses and bookmark keys.
func stuffedSettings(t *testing.T, base Settings) (Settings, []string) {
	t.Helper()
	var sentinels []string
	next := func() string {
		s := "SECRET-" + strconv.Itoa(len(sentinels)+1) + "-X"
		sentinels = append(sentinels, s)
		return s
	}
	v := reflect.ValueOf(&base).Elem()
	typ := v.Type()
	stuffed := 0
	for i := 0; i < typ.NumField(); i++ {
		name, _, _ := strings.Cut(typ.Field(i).Tag.Get("json"), ",")
		if !mcpDeniedName(name) {
			continue
		}
		f := v.Field(i)
		switch f.Kind() {
		case reflect.String:
			f.SetString("https://user:" + next() + "@hooks.example/" + next() + "?token=" + next())
			stuffed++
		case reflect.Slice:
			if f.Type().Elem().Kind() == reflect.String {
				f.Set(reflect.ValueOf([]string{next()}))
				stuffed++
			}
		case reflect.Map:
			if f.Type().Key().Kind() == reflect.String && f.Type().Elem().Kind() == reflect.String {
				f.Set(reflect.ValueOf(map[string]string{"k": next()}))
				stuffed++
			}
		}
	}
	if stuffed < 10 {
		t.Fatalf("only %d secret-looking fields found; the name check is broken", stuffed)
	}
	base.MonitorNotifyPreset = "pushover"
	base.DockerWebUIs = map[string]string{"sonarr": "http://u:" + next() + "@host.lan:8989/x?t=" + next()}
	base.DockerHostAddress = "nas.lan"
	// The one secret-looking field that is read, reduced to its host.
	base.AIBaseURL = "http://u:" + next() + "@ai.lan:11434/v1?key=" + next()
	return base, sentinels
}

func TestSettingsOverviewCarriesNoSecrets(t *testing.T) {
	h := newMCPHandlers(t)
	page := h.store.GetPages()[0].ID
	if err := h.store.SaveBookmarksByPage(page, []Bookmark{
		{Name: "Linked app", URL: "https://app.example/?token=SECRET-BM-1", PageID: page},
	}); err != nil {
		t.Fatal(err)
	}
	s, sentinels := stuffedSettings(t, h.store.GetSettings())
	s.DockerBookmarkLinks = map[string]string{
		"app":   strconv.Itoa(page) + "::https://app.example/?token=SECRET-BM-1",
		"gone":  strconv.Itoa(page) + "::https://gone.example/?key=SECRET-BM-2",
		"never": "-",
	}
	sentinels = append(sentinels, "SECRET-BM-1", "SECRET-BM-2")

	// Built straight from the stuffed settings, so nothing the store would
	// normalise away on save can hide a leak.
	in := h.mcpOverviewInput()
	in.s = s
	raw, err := json.Marshal(buildSettingsOverview(in))
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	for _, secret := range append(sentinels, "SECRET", "hooks.example", "token=", "user:") {
		if strings.Contains(text, secret) {
			t.Errorf("the overview carries %q", secret)
		}
	}
	for _, want := range []string{`"host":"host.lan"`, `"host":"nas.lan"`, `"aiBaseURLHost":"ai.lan"`, `"bookmark":"Linked app"`, `"configured":true`, `"container":"never"`} {
		if !strings.Contains(text, want) {
			t.Errorf("the overview lacks %s: %s", want, text)
		}
	}

	// And through the tool, with what the store kept of the same settings.
	s.MCPSettingsOverview = true
	if err := h.store.SaveSettings(s); err != nil {
		t.Fatal(err)
	}
	wire := rawToolText(t, h, "get_settings_overview", `{}`)
	if !strings.Contains(wire, "structure") {
		t.Fatalf("the tool did not answer: %s", wire)
	}
	if strings.Contains(wire, "SECRET") {
		t.Errorf("the tool answer carries a sentinel: %s", wire)
	}
}

var overviewFieldRead = regexp.MustCompile(`\bin\.s\.([A-Z][A-Za-z0-9]*)`)
var overviewWholeRead = regexp.MustCompile(`([A-Za-z0-9_.]+)\(in\.s\)`)

func TestSettingsOverviewAllowlistReadsNoSecretLookingField(t *testing.T) {
	src, err := os.ReadFile("mcp_settings_overview.go")
	if err != nil {
		t.Fatal(err)
	}
	text := string(src)
	if strings.Contains(text, `"reflect"`) {
		t.Fatal("the overview must not reflect over Settings")
	}
	jsonNames := settingsJSONNames()
	read := map[string]bool{}
	for _, m := range overviewFieldRead.FindAllStringSubmatch(text, -1) {
		read[m[1]] = true
	}
	if len(read) < 30 {
		t.Fatalf("only %d fields found; the scan is broken", len(read))
	}
	for field := range read {
		jsonName, ok := jsonNames[field]
		if !ok {
			t.Errorf("%s is not a Settings field", field)
			continue
		}
		if mcpDeniedName(jsonName) || mcpDeniedName(field) {
			if _, reduced := mcpOverviewReducedFields[field]; !reduced {
				t.Errorf("the allowlist reads %s (%s), which looks like a secret and is not in the host-only/boolean list", field, jsonName)
			}
		}
	}
	for field := range mcpOverviewReducedFields {
		if _, ok := jsonNames[field]; !ok {
			t.Errorf("reduced field %s is not a Settings field", field)
		}
	}
	// Whole settings may go only to the function that turns the notify target
	// into a yes/no.
	for _, m := range overviewWholeRead.FindAllStringSubmatch(text, -1) {
		if m[1] != "monitorNotifyTarget" {
			t.Errorf("the whole settings are handed to %s", m[1])
		}
	}
	if !strings.Contains(text, "_, configured := monitorNotifyTarget(in.s)") {
		t.Error("the notify target is no longer discarded")
	}
}

func TestSettingsOverviewIsHiddenUntilItsSwitchIsOn(t *testing.T) {
	h := newMCPHandlers(t)
	s := h.store.GetSettings()
	s.MCPHealthInbox, s.MCPContainersRead, s.MCPBookmarksWrite = true, true, true
	if err := h.store.SaveSettings(s); err != nil {
		t.Fatal(err)
	}
	if mcpToolGroup("get_settings_overview") != mcpGroupSettingsOverview {
		t.Fatalf("group = %q", mcpToolGroup("get_settings_overview"))
	}
	has := func() bool {
		for _, n := range listedToolNames(t, h) {
			if n == "get_settings_overview" {
				return true
			}
		}
		return false
	}
	if has() {
		t.Error("listed with its switch off and every other group on")
	}
	_, resp := callMCP(t, h, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_settings_overview","arguments":{}}}`)
	if resp.Error == nil || resp.Error.Message != "Unknown tool: get_settings_overview" {
		t.Errorf("called with its switch off: %+v", resp)
	}
	for _, spec := range aiOfferedTools(h.store.GetSettings()) {
		if spec.Name == "get_settings_overview" {
			t.Error("the assistant is offered it with the switch off")
		}
	}

	turnOnSettingsOverview(t, h, true)
	if !has() {
		t.Error("missing with its switch on")
	}
	if got := toolCall(t, h, "get_settings_overview", `{}`); got["error"] != nil || got["structure"] == nil {
		t.Errorf("answer = %v", got)
	}
	if mcpToolIsWrite(mcpFindDefinition("get_settings_overview")) {
		t.Error("not marked read only")
	}
	if !mcpGroupEnabled(h.store.GetSettings(), mcpGroupSettingsOverview) || mcpGroupEnabled(Settings{}, mcpGroupSettingsOverview) {
		t.Error("the group switch does not follow the setting")
	}
	if (Settings{}).MCPSettingsOverview {
		t.Error("on by default")
	}
}

func TestHostOnlyDropsEverythingButTheHost(t *testing.T) {
	for in, want := range map[string]string{
		"":                                "",
		"nas.lan":                         "nas.lan",
		"192.168.1.5":                     "192.168.1.5",
		"http://u:pw@Host.LAN:8989/x?t=1": "host.lan",
		"https://ai.example/v1?key=abc":   "ai.example",
		"http://[IP]:8989/":               "[IP]",
		"[fd00::1]":                       "fd00::1",
	} {
		if got := mcpHostOnly(in); got != want {
			t.Errorf("mcpHostOnly(%q) = %q, want %q", in, got, want)
		}
	}
}
