package app

import (
	"encoding/json"
	"strings"
	"sync"
)

/*
Reading one translated string on the server.

Almost everything the reader sees is drawn by the browser, which fetches the
locale file and looks strings up itself. Two surfaces cannot: the capture page
at /add answers a bookmarklet with HTML and no scripts, and a 404 is served
before any of the app exists. Both were English whatever the install's language
was -- in a product that holds six locales in exact parity and validates them
three ways.

This is deliberately small: a flattened map per language, a dotted key, and the
English text as the fallback for anything missing. It is not a translation
framework; the browser already has one.
*/

var (
	localeTextMu    sync.RWMutex
	localeTextCache = map[string]map[string]string{}
)

// flattenLocale turns the nested file into "section.key" -> text, which is how
// every caller already writes a key.
func flattenLocale(raw json.RawMessage, prefix string, out map[string]string) {
	var branch map[string]json.RawMessage
	if err := json.Unmarshal(raw, &branch); err == nil {
		for key, value := range branch {
			name := key
			if prefix != "" {
				name = prefix + "." + key
			}
			flattenLocale(value, name, out)
		}
		return
	}
	var leaf string
	if err := json.Unmarshal(raw, &leaf); err == nil && prefix != "" {
		out[prefix] = leaf
	}
}

func localeStrings(files assetFS, lang string) map[string]string {
	lang = strings.ToLower(strings.TrimSpace(lang))
	if lang == "" {
		lang = "en"
	}

	localeTextMu.RLock()
	cached, ok := localeTextCache[lang]
	localeTextMu.RUnlock()
	if ok {
		return cached
	}

	out := map[string]string{}
	if raw, err := readLocaleFile(files, lang+".json"); err == nil {
		flattenLocale(raw, "", out)
	}

	localeTextMu.Lock()
	localeTextCache[lang] = out
	localeTextMu.Unlock()
	return out
}

/*
localeText answers in the install's language, or in English, or with the
fallback the caller wrote.

The fallback is the English text spelled out at the call site rather than a bare
key, so a missing translation degrades to a sentence rather than to
"capture.savedHeading".
*/
func localeText(files assetFS, lang, key, fallback string) string {
	if text := strings.TrimSpace(localeStrings(files, lang)[key]); text != "" {
		return text
	}
	if lang != "en" {
		if text := strings.TrimSpace(localeStrings(files, "en")[key]); text != "" {
			return text
		}
	}
	return fallback
}

// text reads a string in the language this install is set to.
func (h *Handlers) text(key, fallback string) string {
	return localeText(h.files, h.store.GetSettings().Language, key, fallback)
}
