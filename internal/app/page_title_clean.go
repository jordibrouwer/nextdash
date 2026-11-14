package app

import (
	"net"
	"regexp"
	"strings"
)

/*
Page titles, cleaned.

A page behind a login answers with the title of its login page: "Login -
Radarr", "Aanmelden - Seerr", "Sign in | CrossWatch". A video or an article adds
the site's own name: "Some headline - YouTube". Both are boilerplate around the
part that says what the page is, and the preview card, the search results and
the name a form suggests all printed it as it came.

Two rules, both conservative. A login word in front goes, when something
remains behind it. The site's own name at the back goes, only when it is the
site's name: the publisher's og:site_name or the host's main label. "About us -
Radarr" keeps its "About us", and a tail that is half a headline stays.

The original is kept next to the clean title (BookmarkPreview.OriginalTitle) so
a form can offer it back. Health's drift detection compares raw titles over
time and does not use this.
*/

var (
	loginLeadSep = regexp.MustCompile(`(?i)^(?:log[\s-]?in|sign[\s-]?in|aanmelden|inloggen|anmelden|einloggen|connexion|se connecter|iniciar sesi[oó]n|登录|登入)\s*[-–—|:·]\s*(.+)$`)
	loginLeadTo  = regexp.MustCompile(`(?i)^(?:log[\s-]?in to|sign[\s-]?in to|aanmelden bij|inloggen bij|anmelden bei|connexion [àa]|iniciar sesi[oó]n en)\s+(.+)$`)
	loginOnly    = regexp.MustCompile(`(?i)^(?:log[\s-]?in|sign[\s-]?in|aanmelden|inloggen|anmelden|einloggen|connexion|iniciar sesi[oó]n|登录|登入)$`)
)

// titleTailSeparators are the joins a site puts between a title and its name.
var titleTailSeparators = []string{" - ", " – ", " — ", " | ", " · "}

// cleanPageTitle returns title without a leading login word and without the
// site's own name at the end. siteName may be empty; host is the page's host.
func cleanPageTitle(title, siteName, host string) string {
	t := strings.TrimSpace(title)
	if t == "" {
		return title
	}
	if loginOnly.MatchString(t) {
		return ""
	}
	if m := loginLeadSep.FindStringSubmatch(t); m != nil {
		t = strings.TrimSpace(m[1])
	} else if m := loginLeadTo.FindStringSubmatch(t); m != nil {
		t = strings.TrimSpace(m[1])
	}
	label := hostMainLabel(host)
	for _, sep := range titleTailSeparators {
		idx := strings.LastIndex(t, sep)
		if idx <= 0 {
			continue
		}
		head := strings.TrimSpace(t[:idx])
		tail := strings.TrimSpace(t[idx+len(sep):])
		if len([]rune(head)) < 2 || tail == "" {
			continue
		}
		if titleNameMatches(tail, siteName, label) {
			t = head
			break
		}
	}
	return t
}

// titleNameMatches is true when tail is the site's own name.
func titleNameMatches(tail, siteName, label string) bool {
	n := nameKey(tail)
	if n == "" {
		return false
	}
	if site := nameKey(siteName); site != "" && n == site {
		return true
	}
	return label != "" && n == label
}

// nameKey is a name as lowercase letters and digits only: "Ars Technica" and
// "arstechnica" compare equal.
func nameKey(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r > 127 {
			b.WriteRune(r)
		}
	}
	return b.String()
}

var secondLevelLabels = map[string]bool{"co": true, "com": true, "org": true, "net": true, "gov": true, "ac": true, "edu": true}

// hostMainLabel is the registrable label of a host: "www.youtube.com" gives
// "youtube", "news.bbc.co.uk" gives "bbc". An address or a one-label host
// gives "" because it carries no name.
func hostMainLabel(host string) string {
	h := strings.ToLower(strings.TrimSpace(host))
	if h == "" {
		return ""
	}
	if name, _, err := net.SplitHostPort(h); err == nil {
		h = name
	}
	if net.ParseIP(strings.Trim(h, "[]")) != nil {
		return ""
	}
	parts := strings.Split(h, ".")
	if len(parts) < 2 {
		return ""
	}
	i := len(parts) - 2
	if secondLevelLabels[parts[i]] && len(parts) >= 3 {
		i--
	}
	return nameKey(parts[i])
}

// applyTitleCleanup cleans a preview's title in place and keeps the original.
// Safe to call again: a preview that already carries an OriginalTitle was
// cleaned, and one whose title needed nothing is left as it is.
func applyTitleCleanup(p *BookmarkPreview) {
	if p.OriginalTitle != "" {
		return
	}
	cleaned := cleanPageTitle(p.Title, p.SiteName, p.Domain)
	if cleaned != p.Title {
		p.OriginalTitle = p.Title
		p.Title = cleaned
	}
}
