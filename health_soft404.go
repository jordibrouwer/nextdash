package main

import "strings"

// softNotFoundEnabled reads the setting. Off leaves every check exactly as it
// was, body read included.
func softNotFoundEnabled(s Settings) bool {
	return s.DetectSoftNotFound
}

// A page can be gone while answering 200.
//
// It is the most common shape of link rot on a site that is otherwise alive: a
// CMS that serves its "page not found" template with a success code, a docs
// site that swallowed a moved article, a shop that shows "this product is no
// longer available". The check sees a healthy response and the row stays green,
// which is exactly the case a rot report exists to catch.
//
// Detection reads the body, which is why it is a choice rather than a default —
// see Settings.DetectSoftNotFound. It is judged on the title first, since a
// template's title is where the site says what happened, and only then on the
// opening of the body, so an article *about* 404s is not condemned by a mention
// halfway down the page.

// softNotFoundTitlePhrases are matched against the page title, lowercased.
var softNotFoundTitlePhrases = []string{
	"404",
	"not found",
	"page not found",
	"page doesn't exist",
	"page does not exist",
	"no longer available",
	"no longer exists",
	"nothing here",
	"page removed",
	"content unavailable",
	"page unavailable",
	"error 404",
	"niet gevonden",
	"pagina niet gevonden",
	"seite nicht gefunden",
	"nicht gefunden",
	"page introuvable",
	"pagina non trovata",
	"página no encontrada",
}

// softNotFoundBodyPhrases are matched against the opening of the body, where a
// not-found template puts its sentence. Deliberately narrower than the title
// list: these have to be phrases a working page would not open with.
var softNotFoundBodyPhrases = []string{
	"page not found",
	"page could not be found",
	"page you requested was not found",
	"page you are looking for",
	"this page no longer exists",
	"deze pagina bestaat niet",
	"pagina niet gevonden",
	"seite wurde nicht gefunden",
	"cette page n'existe pas",
}

// softNotFoundBodyWindow is how much of the body counts as "the opening". A
// not-found template says so above the fold; an article that mentions 404 in
// passing usually does not.
const softNotFoundBodyWindow = 1200

// softNotFoundReason returns the sentence to record, or "" when the page looks
// like a page. Title and body are as fetched; both are matched lowercased.
func softNotFoundReason(title, body string) string {
	lowerTitle := strings.ToLower(strings.TrimSpace(title))
	for _, phrase := range softNotFoundTitlePhrases {
		if lowerTitle != "" && strings.Contains(lowerTitle, phrase) {
			return "Page says it does not exist"
		}
	}

	opening := body
	if len(opening) > softNotFoundBodyWindow {
		opening = opening[:softNotFoundBodyWindow]
	}
	lowerBody := strings.ToLower(opening)
	for _, phrase := range softNotFoundBodyPhrases {
		if strings.Contains(lowerBody, phrase) {
			return "Page says it does not exist"
		}
	}
	return ""
}
