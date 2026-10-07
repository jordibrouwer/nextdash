package app

import (
	"encoding/json"
	"reflect"
	"testing"
)

// Reset all promises a fresh install's look, so every answer it serves has to
// be what a fresh install stores. A field a fresh install leaves out (omitempty)
// counts as its empty value.
func TestLookDefaultsMatchAFreshInstall(t *testing.T) {
	h := newTestHandlers(t)
	raw, err := json.Marshal(h.store.GetSettings())
	if err != nil {
		t.Fatal(err)
	}
	var fresh map[string]any
	if err := json.Unmarshal(raw, &fresh); err != nil {
		t.Fatal(err)
	}

	raw, err = json.Marshal(lookDefaults())
	if err != nil {
		t.Fatal(err)
	}
	var served map[string]any
	if err := json.Unmarshal(raw, &served); err != nil {
		t.Fatal(err)
	}

	for key, want := range served {
		got, ok := fresh[key]
		if !ok {
			switch want.(type) {
			case map[string]any:
				got = map[string]any{}
			case bool:
				got = false
			case string:
				got = ""
			}
		}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%s: a fresh install has %v, Reset all serves %v", key, got, want)
		}
	}
}
