package app

import (
	"fmt"
	"strings"
	"testing"
)

func TestHomeAssistantWidgetConfig(t *testing.T) {
	entities := []any{"light.living_room", `light.x"}}{{ states`, "sensor.temp", "light.living_room", "Scene.Upper"}
	for i := 0; i < 70; i++ {
		entities = append(entities, fmt.Sprintf("sensor.extra_%d", i))
	}
	clean := sanitizeWidgetConfig(WidgetTypeHomeAssistant, map[string]any{
		"server": "http://ha.lan:8123", "credentialId": "widget:w_000000000009",
		"entities": entities, "groupBy": "domain", "showLastChanged": true,
		"layout": "grid", "ttl": float64(5),
	})
	list, _ := clean["entities"].([]string)
	if len(list) != homeAssistantMaxEntities {
		t.Fatalf("%d entities kept, want %d", len(list), homeAssistantMaxEntities)
	}
	if list[0] != "light.living_room" || list[1] != "sensor.temp" || list[2] != "sensor.extra_0" {
		t.Errorf("order, dedupe or validation: %v", list[:3])
	}
	for _, id := range list {
		if strings.ContainsAny(id, `"{} `) || id != strings.ToLower(id) {
			t.Errorf("an invalid id survived: %q", id)
		}
	}
	if clean["groupBy"] != "domain" || clean["showLastChanged"] != true || clean["layout"] != nil || clean["ttl"] != 15 {
		t.Errorf("fields: %#v", clean)
	}
	for _, key := range []string{"server", "credentialId", "entities"} {
		if !withheldWidgetKeys[WidgetTypeHomeAssistant][key] {
			t.Errorf("%s is handed to a tokenless reader", key)
		}
	}
}

// A page template carries the address as a variable and leaves the entities at
// home: they are ids in one house.
func TestHomeAssistantTravelsWithoutItsEntities(t *testing.T) {
	h := newTestHandlers(t)
	if err := h.store.SavePage(Page{ID: 7, Name: "Home"}); err != nil {
		t.Fatal(err)
	}
	if err := h.store.SavePageOrder(append(h.store.GetPageOrder(), 7)); err != nil {
		t.Fatal(err)
	}
	widget := Widget{ID: "w_dddddddddddd", Type: WidgetTypeHomeAssistant, Title: "House", Config: map[string]any{
		"server": "http://192.168.1.40:8123", "entities": []any{"light.secret_room"},
		"credentialId": "widget:w_dddddddddddd", "groupBy": "domain"}}
	if err := h.store.SavePageBlocks(7, []Widget{widget}, nil); err != nil {
		t.Fatal(err)
	}
	_, raw := exportTemplate(t, h, 7, TemplateExportOptions{})
	text := string(raw)
	for _, leak := range []string{"192.168.1.40", "secret_room", "widget:w_dddddddddddd"} {
		if strings.Contains(text, leak) {
			t.Errorf("the template carries %q", leak)
		}
	}
	if !strings.Contains(text, `"groupBy": "domain"`) {
		t.Errorf("the template lost groupBy:\n%s", text)
	}
}
