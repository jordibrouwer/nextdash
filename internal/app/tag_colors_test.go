package app

import (
	"reflect"
	"testing"
)

func TestSanitizeTagColorsKeepsOnlyPaletteNames(t *testing.T) {
	got := sanitizeTagColors(map[string]string{
		"Docker": "Blue", " dev ": "green", "bad": "#ff0000", "": "red", "x": "javascript:1",
	})
	want := map[string]string{"docker": "blue", "dev": "green"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
}

func TestSanitizeTagColorsIsNilWhenNothingIsLeft(t *testing.T) {
	if got := sanitizeTagColors(map[string]string{"a": "nope"}); got != nil {
		t.Errorf("got %v, want nil", got)
	}
}

func TestSanitizeTagColorsCapsTheMap(t *testing.T) {
	in := map[string]string{}
	for i := 0; i < tagColorMaxEntries+50; i++ {
		in[string(rune('a'+i%26))+string(rune('a'+i/26%26))+string(rune('a'+i/676))] = "red"
	}
	if got := len(sanitizeTagColors(in)); got != tagColorMaxEntries {
		t.Errorf("entries = %d, want %d", got, tagColorMaxEntries)
	}
}

// When there are too many, the same ones are kept every time.
func TestSanitizeTagColorsKeepsTheSameOnesWhenCapped(t *testing.T) {
	in := map[string]string{}
	for i := 0; i < tagColorMaxEntries+30; i++ {
		in[string(rune('a'+i%26))+string(rune('a'+i/26%26))+string(rune('a'+i/676))] = "red"
	}
	first := sanitizeTagColors(in)
	for run := 0; run < 5; run++ {
		if !reflect.DeepEqual(first, sanitizeTagColors(in)) {
			t.Fatal("two runs kept different tags")
		}
	}
}
