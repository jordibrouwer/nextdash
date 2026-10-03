package app

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
)

func TestThemeMetaListsEveryBackdropRecipe(t *testing.T) {
	h := newTestHandlers(t)
	rec := httptest.NewRecorder()
	h.ThemeMeta(rec, httptest.NewRequest("GET", "/api/themes/meta", nil))
	var body struct {
		Backdrops []string `json:"backdrops"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if len(body.Backdrops) != len(themeBackdropRecipes) || len(body.Backdrops) != 26 {
		t.Fatalf("backdrops = %d, want 26", len(body.Backdrops))
	}
	if body.Backdrops[0] != "blooms" || body.Backdrops[25] != "chevron" {
		t.Fatalf("order changed: %v", body.Backdrops)
	}
}
