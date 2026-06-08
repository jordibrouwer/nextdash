package main

import (
	"net/http"
	"os"
	"regexp"
	"strings"
)

// validCSSColor matches safe CSS color values: hex, rgb/rgba, hsl/hsla, named colors,
// and CSS keywords. Rejects anything containing url(), expression(), or unbalanced chars.
var validCSSColor = regexp.MustCompile(
	`(?i)^(` +
		`#[0-9a-f]{3,8}` + // hex
		`|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(\s*,\s*[\d.]+)?\s*\)` + // rgb/rgba
		`|rgba?\(\s*\d{1,3}%\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%(\s*,\s*[\d.]+)?\s*\)` + // rgb% variant
		`|hsla?\(\s*[\d.]+\s*,\s*[\d.]+%\s*,\s*[\d.]+%(\s*,\s*[\d.]+)?\s*\)` + // hsl/hsla
		`|[a-z]+` + // named colors / keywords (transparent, none, inherit, etc.)
		`)$`,
)

// sanitizeCSSColor returns the color value if it is a safe CSS color expression,
// or "transparent" as a safe fallback if not.
func sanitizeCSSColor(value string) string {
	v := strings.TrimSpace(value)
	if validCSSColor.MatchString(v) {
		return v
	}
	return "transparent"
}

// validCSSIdent matches safe CSS identifiers (theme IDs used in attribute selectors).
var validCSSIdent = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

// sanitizeCSSIdent returns the identifier if it is safe for use inside a CSS attribute selector,
// or returns an empty string so callers can skip the rule.
func sanitizeCSSIdent(value string) string {
	v := strings.TrimSpace(value)
	if validCSSIdent.MatchString(v) {
		return v
	}
	return ""
}

// sanitizeThemeColors returns a copy of tc with every color field run through sanitizeCSSColor.
func sanitizeThemeColors(tc ThemeColors) ThemeColors {
	return ThemeColors{
		Name:                tc.Name,
		TextPrimary:         sanitizeCSSColor(tc.TextPrimary),
		TextSecondary:       sanitizeCSSColor(tc.TextSecondary),
		TextTertiary:        sanitizeCSSColor(tc.TextTertiary),
		BackgroundPrimary:   sanitizeCSSColor(tc.BackgroundPrimary),
		BackgroundSecondary: sanitizeCSSColor(tc.BackgroundSecondary),
		BackgroundDots:      sanitizeCSSColor(tc.BackgroundDots),
		BackgroundModal:     sanitizeCSSColor(tc.BackgroundModal),
		BorderPrimary:       sanitizeCSSColor(tc.BorderPrimary),
		BorderSecondary:     sanitizeCSSColor(tc.BorderSecondary),
		AccentSuccess:       sanitizeCSSColor(tc.AccentSuccess),
		AccentWarning:       sanitizeCSSColor(tc.AccentWarning),
		AccentError:         sanitizeCSSColor(tc.AccentError),
	}
}

const jsonBodyLimit = 4 << 20 // 4 MB for JSON endpoints

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "SAMEORIGIN")
		// Apply body size limit to non-multipart requests so JSON endpoints
		// cannot be fed unlimited data. File upload and backup handlers set
		// their own limits via ParseMultipartForm and are excluded here.
		if !strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/") {
			r.Body = http.MaxBytesReader(w, r.Body, jsonBodyLimit)
		}
		next.ServeHTTP(w, r)
	})
}

func writeAccessToken() string {
	return strings.TrimSpace(os.Getenv("NEXTDASH_WRITE_TOKEN"))
}

func (h *Handlers) requireWriteAccess(w http.ResponseWriter, r *http.Request) bool {
	token := writeAccessToken()
	if token == "" {
		return true
	}
	if r.Header.Get("X-NextDash-Token") != token {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return false
	}
	return true
}
