package app

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func askWidgetAction(t *testing.T, h *Handlers, widgetType WidgetType, body map[string]any, token string) *httptest.ResponseRecorder {
	t.Helper()
	raw, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/api/widgets/"+string(widgetType)+"/action", bytes.NewReader(raw))
	if token != "" {
		req.Header.Set("X-NextDash-Token", token)
	}
	rec := httptest.NewRecorder()
	h.widgetActionHandler(widgetType)(rec, req)
	return rec
}

// Home Assistant switched before the setting existed: absent stays on, an
// explicit false turns the buttons and the route off.
func TestHomeAssistantActionsSwitchOff(t *testing.T) {
	mediaForgetAll()
	h := newTestHandlers(t)
	fake := newFakeHomeAssistant(t)
	haTestPage(t, h, fake)
	widget := Widget{ID: haTestWidget, Type: WidgetTypeHomeAssistant, Title: "House",
		Config: haTestConfig(fake, map[string]any{"actions": false})}
	if err := h.store.SavePageBlocks(1, []Widget{widget}, nil); err != nil {
		t.Fatal(err)
	}
	if askHAWidget(t, h, "").Controls {
		t.Errorf("buttons shown while actions are off")
	}
	before := fake.count("POST /api/services/")
	rec := askWidgetAction(t, h, WidgetTypeHomeAssistant, map[string]any{"pageId": 1, "id": haTestWidget, "action": "toggle", "target": "light.ceiling"}, "")
	if rec.Code != http.StatusForbidden {
		t.Errorf("actions off: %d", rec.Code)
	}
	if fake.count("POST /api/services/") != before {
		t.Errorf("a switched-off widget still reached Home Assistant")
	}
}

// The action must match the entity's domain: a light is toggled, not run.
func TestHomeAssistantActionMustFitTheDomain(t *testing.T) {
	mediaForgetAll()
	h := newTestHandlers(t)
	fake := newFakeHomeAssistant(t)
	haTestPage(t, h, fake)
	body := map[string]any{"pageId": 1, "id": haTestWidget, "action": "run", "target": "light.ceiling"}
	if rec := askWidgetAction(t, h, WidgetTypeHomeAssistant, body, ""); rec.Code != http.StatusForbidden {
		t.Errorf("run on a light: %d", rec.Code)
	}
	body["action"] = "delete"
	if rec := askWidgetAction(t, h, WidgetTypeHomeAssistant, body, ""); rec.Code != http.StatusBadRequest {
		t.Errorf("unknown action: %d", rec.Code)
	}
	body["action"] = "toggle"
	if rec := askWidgetAction(t, h, WidgetTypeHomeAssistant, body, ""); rec.Code != http.StatusOK {
		t.Errorf("toggle: %d %s", rec.Code, rec.Body.String())
	}
}

// Without a check of its own, an action only reaches lines the tile was
// shown, and a widget that never chose is off.
func TestWidgetActionOnlyOnShownLines(t *testing.T) {
	mediaForgetAll()
	h := newTestHandlers(t)
	// A real type, so the store keeps the widget; the table entry is the test's.
	const kind = WidgetTypeSeerr
	var ran []string
	previous, had := widgetActions[kind]
	widgetActions[kind] = widgetActionType{
		Service: "test-action",
		Answer: func(context.Context, *Handlers, int, Widget) MediaResult {
			return MediaResult{Items: []MediaItem{{ID: "r1"}, {ID: "r2"}}}
		},
		Actions: map[string]widgetAction{"approve": {Run: func(_ context.Context, _ *Handlers, req widgetActionRequest) (any, error) {
			ran = append(ran, req.Target)
			return nil, nil
		}}},
	}
	t.Cleanup(func() {
		if had {
			widgetActions[kind] = previous
		} else {
			delete(widgetActions, kind)
		}
	})

	save := func(config map[string]any) {
		t.Helper()
		if err := h.store.SavePageBlocks(1, []Widget{{ID: "w_act", Type: kind, Title: "Requests", Config: config}}, nil); err != nil {
			t.Fatal(err)
		}
	}
	body := func(target string) map[string]any {
		return map[string]any{"pageId": 1, "id": "w_act", "action": "approve", "target": target}
	}

	save(map[string]any{})
	if rec := askWidgetAction(t, h, kind, body("r1"), ""); rec.Code != http.StatusForbidden {
		t.Errorf("never chosen: %d", rec.Code)
	}
	save(map[string]any{"actions": true})
	t.Setenv("NEXTDASH_WRITE_TOKEN", "tok")
	if rec := askWidgetAction(t, h, kind, body("r1"), ""); rec.Code != http.StatusUnauthorized {
		t.Errorf("without the token: %d", rec.Code)
	}
	if rec := askWidgetAction(t, h, kind, body("r9"), "tok"); rec.Code != http.StatusForbidden {
		t.Errorf("a line the tile never showed: %d", rec.Code)
	}
	if rec := askWidgetAction(t, h, kind, body(""), "tok"); rec.Code != http.StatusForbidden {
		t.Errorf("no target: %d", rec.Code)
	}
	if rec := askWidgetAction(t, h, kind, body("r2"), "tok"); rec.Code != http.StatusOK {
		t.Errorf("a shown line: %d %s", rec.Code, rec.Body.String())
	}
	if len(ran) != 1 || ran[0] != "r2" {
		t.Errorf("ran %v, want only r2", ran)
	}
}
