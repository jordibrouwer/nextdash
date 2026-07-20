package main

import (
	"net/http"
	"os"
	"regexp"
	"strings"
)

// detectImageType reads the first 512 bytes of data and returns the actual MIME type.
// Falls back to the client-supplied fallback only if no magic bytes matched.
func detectImageType(data []byte) string {
	if len(data) >= 4 {
		switch {
		case data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4E && data[3] == 0x47:
			return "image/png"
		case data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF:
			return "image/jpeg"
		case len(data) >= 6 && (string(data[:6]) == "GIF87a" || string(data[:6]) == "GIF89a"):
			return "image/gif"
		case data[0] == 0x00 && data[1] == 0x00 && (data[2] == 0x01 || data[2] == 0x02) && data[3] == 0x00:
			return "image/x-icon"
		case len(data) >= 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WEBP":
			return "image/webp"
		}
	}
	// SVG is text-based — check for XML/SVG markers
	sniff := strings.ToLower(strings.TrimSpace(string(data[:min(len(data), 512)])))
	if strings.HasPrefix(sniff, "<svg") || strings.Contains(sniff, "<svg ") ||
		(strings.HasPrefix(sniff, "<?xml") && strings.Contains(sniff, "<svg")) {
		return "image/svg+xml"
	}
	return ""
}

// detectFontType identifies font uploads by magic bytes (WOFF/WOFF2/sfnt).
func detectFontType(data []byte) string {
	if len(data) < 4 {
		return ""
	}
	switch string(data[:4]) {
	case "wOFF":
		return "font/woff"
	case "wOF2":
		return "font/woff2"
	case "OTTO":
		return "font/otf"
	case "true", "typ1":
		return "font/ttf"
	}
	if data[0] == 0x00 && data[1] == 0x01 && data[2] == 0x00 && data[3] == 0x00 {
		return "font/ttf"
	}
	return ""
}

func fontExtensionFromDetectedType(contentType string) string {
	switch contentType {
	case "font/woff":
		return ".woff"
	case "font/woff2":
		return ".woff2"
	case "font/ttf":
		return ".ttf"
	case "font/otf":
		return ".otf"
	default:
		return ""
	}
}

// svgScriptPattern matches <script> blocks, SVG event-handler attributes, and javascript: hrefs.
// Separate alternatives for double/single quoted and unquoted attribute values ensure the full
// value is consumed regardless of nested quotes inside the value.
var svgScriptPattern = regexp.MustCompile(
	`(?i)` +
		`(<script[\s\S]*?</script>)` + // <script>...</script>
		`|(<script[^>]*/>)` + // self-closing <script/>
		`|(\bon\w+\s*=\s*"[^"]*")` + // on*="..." (double-quoted, may contain single quotes)
		`|(\bon\w+\s*=\s*'[^']*')` + // on*='...' (single-quoted, may contain double quotes)
		`|(\bon\w+\s*=\s*[^\s>]*)` + // on*=value (unquoted)
		`|(javascript\s*:)`, // javascript: in href/src
)

var svgForeignObjectPattern = regexp.MustCompile(`(?i)<foreignObject[\s\S]*?</foreignObject>`)
var svgDataHrefPattern = regexp.MustCompile(`(?i)\b(?:xlink:)?href\s*=\s*(?:"data:[^"]*"|'data:[^']*'|data:[^\s>]*)`)

// sanitizeSVGContent removes <script> elements and event-handler attributes from SVG.
func sanitizeSVGContent(data []byte) []byte {
	out := svgScriptPattern.ReplaceAll(data, nil)
	out = svgForeignObjectPattern.ReplaceAll(out, nil)
	out = svgDataHrefPattern.ReplaceAll(out, nil)
	return out
}

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

func sanitizeColorTheme(c ColorTheme) ColorTheme {
	c.Light = sanitizeThemeColors(c.Light)
	c.Dark = sanitizeThemeColors(c.Dark)
	if c.BuiltIn != nil {
		for id, tc := range c.BuiltIn {
			c.BuiltIn[id] = sanitizeThemeColors(tc)
		}
	}
	if c.Custom != nil {
		for id, tc := range c.Custom {
			c.Custom[id] = sanitizeThemeColors(tc)
		}
	}
	return c
}

const jsonBodyLimit = 4 << 20 // 4 MB for JSON endpoints

func contentSecurityPolicy() string {
	if strings.EqualFold(strings.TrimSpace(os.Getenv("NEXTDASH_CSP")), "off") {
		return ""
	}
	return strings.Join([]string{
		"default-src 'self'",
		"base-uri 'self'",
		"form-action 'self'",
		"frame-ancestors 'self'",
		"object-src 'none'",
		"script-src 'self' https://cdnjs.cloudflare.com https://stats.nextdash.cc",
		"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
		"img-src 'self' data: blob: https: http:",
		"font-src 'self' data: https://fonts.gstatic.com",
		"connect-src 'self' https://api.open-meteo.com https://geocoding-api.open-meteo.com https://stats.nextdash.cc",
		"manifest-src 'self'",
		"child-src 'self' blob:",
		"worker-src 'self' blob:",
	}, "; ")
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "SAMEORIGIN")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		if csp := contentSecurityPolicy(); csp != "" {
			w.Header().Set("Content-Security-Policy", csp)
		}
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
		logAuthDenied(r, "missing_or_invalid_write_token")
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return false
	}
	return true
}
