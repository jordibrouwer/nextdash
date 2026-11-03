package app

import (
	"net/http"
	"reflect"
	"testing"
)

// The members as strings, whether the widget was just sanitised ([]string) or
// came back off the wire ([]any).
func memberIDs(w Widget) []string {
	switch list := w.Config["members"].(type) {
	case []string:
		return list
	case []any:
		out := make([]string, 0, len(list))
		for _, item := range list {
			if id, ok := item.(string); ok {
				out = append(out, id)
			}
		}
		return out
	}
	return nil
}

// Members that are gone, are stacks, or are held by an earlier stack fall out;
// the rest keep the order the stack lists them in.
func TestPruneStackMembers(t *testing.T) {
	widgets := []Widget{
		{ID: "w_a", Type: WidgetTypeHealth},
		{ID: "w_b", Type: WidgetTypeUptime},
		{ID: "w_c", Type: WidgetTypeCPU},
		{ID: "w_s1", Type: WidgetTypeStack, Config: map[string]any{"members": []any{"w_c", "w_gone", "w_s2", "w_a", "w_c"}}},
		{ID: "w_s2", Type: WidgetTypeStack, Config: map[string]any{"members": []any{"w_a", "w_b"}}},
	}
	out := pruneStackMembers(widgets)
	if got := memberIDs(out[3]); !reflect.DeepEqual(got, []string{"w_c", "w_a"}) {
		t.Errorf("first stack = %v, want [w_c w_a]", got)
	}
	// w_a is the first stack's; only w_b is left for the second.
	if got := memberIDs(out[4]); !reflect.DeepEqual(got, []string{"w_b"}) {
		t.Errorf("second stack = %v, want [w_b]", got)
	}
	// The input is not edited in place.
	if _, ok := widgets[3].Config["members"].([]any); !ok {
		t.Error("the caller's widgets were changed")
	}
}

func TestPruneStackMembersCapsTheTabs(t *testing.T) {
	var widgets []Widget
	var ids []any
	for i := 0; i < 9; i++ {
		id := "w_m" + string(rune('a'+i))
		widgets = append(widgets, Widget{ID: id, Type: WidgetTypeHealth})
		ids = append(ids, id)
	}
	widgets = append(widgets, Widget{ID: "w_s", Type: WidgetTypeStack, Config: map[string]any{"members": ids}})
	out := pruneStackMembers(widgets)
	if got := len(memberIDs(out[len(out)-1])); got != widgetMaxStackMembers {
		t.Errorf("tabs = %d, want %d", got, widgetMaxStackMembers)
	}
}

// Deleting a member through an ordinary save takes it out of its stack too.
func TestSavingWithoutAMemberLeavesTheStackWithoutIt(t *testing.T) {
	h := newTestHandlers(t)
	saved := callBlocks(t, h, http.MethodPut, `{"widgets":[{"id":"w_aaaaaaaaaaaa","type":"health"},{"id":"w_bbbbbbbbbbbb","type":"uptime"},
		{"id":"w_cccccccccccc","type":"stack","config":{"members":["w_aaaaaaaaaaaa","w_bbbbbbbbbbbb"]}}]}`)
	if got := memberIDs(saved.Widgets[2]); len(got) != 2 {
		t.Fatalf("members = %v", got)
	}
	again := callBlocks(t, h, http.MethodPut, `{"widgets":[{"id":"w_aaaaaaaaaaaa","type":"health"},
		{"id":"w_cccccccccccc","type":"stack","config":{"members":["w_aaaaaaaaaaaa","w_bbbbbbbbbbbb"]}}]}`)
	if got := memberIDs(again.Widgets[1]); !reflect.DeepEqual(got, []string{"w_aaaaaaaaaaaa"}) {
		t.Errorf("members after deleting one = %v", got)
	}
}

// A copy of a stack starts empty: a widget lives in one stack at most.
func TestDuplicateStackStartsEmpty(t *testing.T) {
	h := newTestHandlers(t)
	callBlocks(t, h, http.MethodPut, `{"widgets":[{"id":"w_aaaaaaaaaaaa","type":"health"},
		{"id":"w_cccccccccccc","type":"stack","config":{"members":["w_aaaaaaaaaaaa"]}}]}`)
	code, out := duplicate(t, h, "w_cccccccccccc", ``)
	if code != http.StatusOK {
		t.Fatalf("duplicate = %d", code)
	}
	var copied *Widget
	for i := range out.Widgets {
		if out.Widgets[i].ID == out.ID {
			copied = &out.Widgets[i]
		}
	}
	if copied == nil || len(memberIDs(*copied)) != 0 {
		t.Errorf("copy = %+v, want no members", copied)
	}
	if got := memberIDs(out.Widgets[1]); len(got) != 1 {
		t.Errorf("the original stack lost its member: %v", got)
	}
}
