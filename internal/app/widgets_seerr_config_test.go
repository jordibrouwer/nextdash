package app

import (
	"strings"
	"testing"
)

func TestSeerrWidgetConfig(t *testing.T) {
	clean := sanitizeWidgetConfig(WidgetTypeSeerr, map[string]any{
		"server": "http://seerr.lan:5055", "credentialId": "widget:w_000000000009",
		"status": "pending", "requestedBy": "3", "mediaType": "tv",
		"layout": "carousel", "rows": float64(99),
	})
	if clean["status"] != "pending" || clean["requestedBy"] != "3" || clean["mediaType"] != "tv" {
		t.Errorf("kept: %#v", clean)
	}
	if clean["layout"] != nil || clean["rows"] != widgetMaxRows {
		t.Errorf("narrowed: %#v", clean)
	}
	for _, key := range []string{"server", "credentialId", "requestedBy"} {
		if !withheldWidgetKeys[WidgetTypeSeerr][key] {
			t.Errorf("%s is handed to a tokenless reader", key)
		}
	}
}

// A page template carries the address as a variable and leaves the chosen
// requester at home: a Seerr user id names nobody on another server.
func TestSeerrWidgetTravelsWithoutItsRequester(t *testing.T) {
	h := newTestHandlers(t)
	if err := h.store.SavePage(Page{ID: 7, Name: "Requests"}); err != nil {
		t.Fatal(err)
	}
	if err := h.store.SavePageOrder(append(h.store.GetPageOrder(), 7)); err != nil {
		t.Fatal(err)
	}
	widget := Widget{ID: "w_dddddddddddd", Type: WidgetTypeSeerr, Title: "Requests", Config: map[string]any{
		"server": "http://192.168.1.40:5055", "requestedBy": "3", "credentialId": "widget:w_dddddddddddd", "status": "pending"}}
	if err := h.store.SavePageBlocks(7, []Widget{widget}, nil); err != nil {
		t.Fatal(err)
	}
	_, raw := exportTemplate(t, h, 7, TemplateExportOptions{})
	text := string(raw)
	for _, leak := range []string{"192.168.1.40", `"requestedBy"`, "widget:w_dddddddddddd"} {
		if strings.Contains(text, leak) {
			t.Errorf("the template carries %q", leak)
		}
	}
	if !strings.Contains(text, `"status": "pending"`) {
		t.Errorf("the template lost the status filter:\n%s", text)
	}
}
