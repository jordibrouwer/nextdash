package app

import (
	"os"
	"path/filepath"
	"testing"
)

// The Inbox view's settings read as the view was before it had any: a fresh
// install and an older file both get the defaults, and a value the view does
// not know goes back to its default.
func TestInboxViewSettingsDefaults(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())
	check := func(label string, s Settings) {
		t.Helper()
		if s.InboxViewFilter != "last" || s.InboxViewSort != "last" || s.InboxViewAddress != "domain" ||
			s.InboxViewRail != "open" || s.InboxViewPanelWidth != "normal" || s.InboxViewClick != "panel" ||
			s.InboxViewDblClick != "open" || s.InboxViewBadgeCounts != "unread" || s.InboxViewKeyLegend != "below" {
			t.Fatalf("%s: %+v", label, s)
		}
		if !s.InboxViewUnreadMark || !s.InboxViewCloseOutside || !s.InboxViewBadge {
			t.Fatalf("%s: a switch that defaults on is off", label)
		}
	}
	check("fresh", NewStore().GetSettings())

	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)
	if err := os.WriteFile(filepath.Join(dir, "settings.json"), []byte(`{"theme":"x","inboxViewSort":"sideways"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	check("older file", NewStore().GetSettings())
}

func TestInboxViewSettingsKeepChoices(t *testing.T) {
	s := Settings{InboxViewFilter: "unread", InboxViewSort: "domain", InboxViewAddress: "hidden", InboxViewKeyLegend: "off", InboxViewDblClick: "note"}
	clampInboxViewSettings(&s)
	if s.InboxViewFilter != "unread" || s.InboxViewSort != "domain" || s.InboxViewAddress != "hidden" ||
		s.InboxViewKeyLegend != "off" || s.InboxViewDblClick != "note" {
		t.Fatalf("a known choice was dropped: %+v", s)
	}
}
