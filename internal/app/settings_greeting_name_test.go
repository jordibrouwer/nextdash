package app

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestGreetingNameIsTrimmedAndCapped(t *testing.T) {
	s := Settings{GreetingName: "  Jordi \n"}
	clampBookmarkSettings(&s)
	if s.GreetingName != "Jordi" {
		t.Fatalf("greetingName = %q, want %q", s.GreetingName, "Jordi")
	}

	s = Settings{GreetingName: strings.Repeat("é", 100)}
	clampBookmarkSettings(&s)
	if n := utf8.RuneCountInString(s.GreetingName); n != maxGreetingNameRunes {
		t.Fatalf("greetingName kept %d runes, want %d", n, maxGreetingNameRunes)
	}
	if !utf8.ValidString(s.GreetingName) {
		t.Fatal("greetingName was cut inside a rune")
	}
}
