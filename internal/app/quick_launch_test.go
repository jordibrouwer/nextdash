package app

import (
	"reflect"
	"strings"
	"testing"
)

// A settings file written before Quick launch existed answers neither switch,
// and both mean on. An explicit off stays off.
func TestQuickLaunchSwitchesAreOnForAnOldSettingsFile(t *testing.T) {
	h, _ := healthRecheckTestHandlers(t, `{}`)
	s := h.store.GetSettings()
	if !s.QuickLaunchButton || !s.QuickLaunchGesture {
		t.Fatalf("an old file must show the corner element and draw circles: button=%v gesture=%v", s.QuickLaunchButton, s.QuickLaunchGesture)
	}
	if s.QuickLaunchAutoClose != 5 {
		t.Fatalf("an old file closes after 5 seconds, got %d", s.QuickLaunchAutoClose)
	}
	if s.QuickLaunchTurns != 1.5 || s.QuickLaunchSource != quickLaunchSourceMix || s.QuickLaunchCount != 8 {
		t.Fatalf("defaults wrong: turns=%v source=%q count=%d", s.QuickLaunchTurns, s.QuickLaunchSource, s.QuickLaunchCount)
	}
	h2, _ := healthRecheckTestHandlers(t, `{"quickLaunchButton":false,"quickLaunchGesture":false,"quickLaunchAutoClose":0}`)
	s2 := h2.store.GetSettings()
	if s2.QuickLaunchButton || s2.QuickLaunchGesture {
		t.Fatal("an explicit off must stay off")
	}
	if s2.QuickLaunchAutoClose != 0 {
		t.Fatal("an explicit never (0) must stay never")
	}
}

func TestNormalizeQuickLaunchKeepsChoicesInsideWhatThePanelDraws(t *testing.T) {
	cases := []struct {
		name  string
		in    Settings
		turns float64
		count int
		src   string
	}{
		{"zero is the default", Settings{}, 1.5, 8, quickLaunchSourceMix},
		{"a twitch is raised to one", Settings{QuickLaunchTurns: 0.3, QuickLaunchCount: 6}, 1.5, 6, quickLaunchSourceMix},
		{"too many is three", Settings{QuickLaunchTurns: 9, QuickLaunchCount: 4, QuickLaunchSource: quickLaunchSourceTop}, 3, 4, quickLaunchSourceTop},
		{"snaps to halves", Settings{QuickLaunchTurns: 1.2}, 1, 8, quickLaunchSourceMix},
		{"snaps up at the midpoint", Settings{QuickLaunchTurns: 2.25}, 2.5, 8, quickLaunchSourceMix},
		{"an unknown close delay reads as the default", Settings{QuickLaunchTurns: 2, QuickLaunchAutoClose: 7}, 2, 8, quickLaunchSourceMix},
		{"an unknown count and source read as the default", Settings{QuickLaunchTurns: 2, QuickLaunchCount: 5, QuickLaunchSource: "nonsense"}, 2, 8, quickLaunchSourceMix},
	}
	for _, c := range cases {
		s := c.in
		normalizeQuickLaunch(&s)
		if c.name == "an unknown close delay reads as the default" && s.QuickLaunchAutoClose != 5 {
			t.Errorf("%s: got %d", c.name, s.QuickLaunchAutoClose)
		}
		if s.QuickLaunchTurns != c.turns || s.QuickLaunchCount != c.count || s.QuickLaunchSource != c.src {
			t.Errorf("%s: got turns=%v count=%d source=%q, want %v %d %q", c.name, s.QuickLaunchTurns, s.QuickLaunchCount, s.QuickLaunchSource, c.turns, c.count, c.src)
		}
	}
}

func TestCleanQuickLaunchURLsTrimsDedupesAndCaps(t *testing.T) {
	got := cleanQuickLaunchURLs([]string{" https://a.test ", "", "https://a.test", "https://b.test", strings.Repeat("x", 3000)}, 24)
	if !reflect.DeepEqual(got, []string{"https://a.test", "https://b.test"}) {
		t.Fatalf("got %v", got)
	}
	var many []string
	for i := 0; i < 30; i++ {
		many = append(many, "https://h"+string(rune('a'+i%26))+string(rune('a'+i/26))+".test")
	}
	capped := cleanQuickLaunchURLs(many, 24)
	if len(capped) != 24 || capped[len(capped)-1] != many[len(many)-1] {
		t.Fatalf("the newest 24 must stay, got %d ending %q", len(capped), capped[len(capped)-1])
	}
	if got := cleanQuickLaunchURLs(nil, 24); got == nil || len(got) != 0 {
		t.Fatalf("nil must come back as an empty list so the settings answer carries [] not null, got %#v", got)
	}
}
