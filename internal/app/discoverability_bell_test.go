package app

import "testing"

// Bell marks survive saving and reading, and a copy from the read cache shares
// nothing with the original.
func TestDiscoverabilityBellRoundTrip(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())
	store := NewStore()

	settings := store.GetSettings()
	settings.DiscoverabilityState = &DiscoverabilityState{
		Bell: map[string]BellRecord{
			"tag-review": {
				Read: &BellMark{Count: 12, IDs: []string{"a", "b"}},
				No:   &BellMark{Count: 3, Forever: true},
			},
		},
		TipCardShownAt: 1700000000000,
	}
	if err := store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}

	got := store.GetSettings().DiscoverabilityState
	rec := got.Bell["tag-review"]
	if got.TipCardShownAt != 1700000000000 || rec.Read == nil || rec.Read.Count != 12 ||
		len(rec.Read.IDs) != 2 || rec.No == nil || rec.No.Count != 3 || !rec.No.Forever {
		t.Fatalf("round trip lost data: %+v", got)
	}

	// Change the copy; a second read must not see it.
	rec.Read.IDs[0] = "changed"
	rec.Read.Count = 99
	rec.No.Count = 99
	got.Bell["intruder"] = BellRecord{}
	again := store.GetSettings().DiscoverabilityState
	r2 := again.Bell["tag-review"]
	if r2.Read.IDs[0] != "a" || r2.Read.Count != 12 || r2.No.Count != 3 {
		t.Errorf("copy shares marks with the cache: %+v", r2)
	}
	if _, ok := again.Bell["intruder"]; ok {
		t.Error("copy shares the map with the cache")
	}
}
