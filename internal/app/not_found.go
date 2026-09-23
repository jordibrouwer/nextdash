package app

import (
	"html/template"
	"net/http"
	"strings"
)

/*
A mistyped address gets a page, not Go's default.

No NotFoundHandler was registered, so anything the router did not match fell
through to net/http's own "404 page not found": plain text, on a white page,
with no way back -- in an app whose whole business is addresses people keep, and
which is therefore mistyped and stale-bookmarked more than most.

Deliberately standalone. It shares the capture page's shape rather than the
dashboard template: a 404 must still answer when the store cannot be read or the
templates fail to parse, which is exactly when the dashboard's own machinery is
the wrong thing to lean on. Colours come from the system palette so it sits
right in either scheme without reading a theme.
*/
var notFoundPage = template.Must(template.New("notfound").Parse(`<!DOCTYPE html>
<html lang="{{.Lang}}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{.Heading}}</title>
<style>
 :root { color-scheme: light dark; }
 body { font: 16px/1.5 system-ui, sans-serif; margin: 0; display: grid; place-items: center;
        min-height: 100vh; background: Canvas; color: CanvasText; }
 main { max-width: 32rem; padding: 2rem; text-align: center; }
 h1 { font-size: 1.15rem; margin: 0 0 .35rem; }
 p { margin: 0 0 1rem; opacity: .8; word-break: break-word; }
 a { color: inherit; }
</style></head>
<body><main>
 <h1>{{.Heading}}</h1>
 <p>{{.Detail}}</p>
 <p><a href="/">{{.Back}}</a></p>
</main></body></html>`))

type notFoundContent struct {
	Lang    string
	Heading string
	Detail  string
	Back    string
}

/*
NotFoundHandler answers whatever the router did not match.

An /api/ path keeps a plain answer: what is on the other end is a fetch, and a
page of HTML where JSON was expected is harder to read than the one line it
replaces.
*/
func (h *Handlers) NotFoundHandler(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}

	lang := strings.TrimSpace(h.store.GetSettings().Language)
	if lang == "" {
		lang = "en"
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNotFound)
	_ = notFoundPage.Execute(w, notFoundContent{
		Lang:    lang,
		Heading: h.text("others.notFoundHeading", "Nothing here"),
		Detail:  h.text("others.notFoundDetail", "That address is not part of nextDash."),
		Back:    h.text("others.notFoundBack", "Back to the dashboard"),
	})
}
