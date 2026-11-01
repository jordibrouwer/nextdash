package app

import (
	"strings"
	"testing"
)

func TestFeedNewsWidgetTypeIsRegistered(t *testing.T) {
	if _, ok := knownWidgetTypes[WidgetTypeFeedNews]; !ok {
		t.Error("WidgetTypeFeedNews not accepted as a valid widget type")
	}
	if !strings.Contains(strings.Join(widgetTypeNames(), ","), "rss,feed-news") {
		t.Error("widgetTypeNames() does not list feed-news beside rss")
	}
}

// The layout survives a save, and only the three the tile knows.
func TestFeedNewsWidgetKeepsItsLayout(t *testing.T) {
	for _, layout := range []string{"list", "headlines", "chips"} {
		clean := sanitizeWidgetConfig(WidgetTypeFeedNews, map[string]any{"layout": layout})
		if clean["layout"] != layout {
			t.Errorf("layout %q was dropped: %v", layout, clean)
		}
	}
	if got := sanitizeWidgetConfig(WidgetTypeFeedNews, map[string]any{"layout": "sideways"}); got["layout"] != nil {
		t.Errorf("an unknown layout was kept: %v", got)
	}
}
