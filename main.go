// Command nextdash is the dashboard server.
//
// This file exists only to carry the embed directive and hand it to the
// application package. //go:embed patterns are resolved relative to the
// directory of the file that declares them and cannot climb out of it with
// "..", so the directive has to sit next to static/, templates/ and locales/ —
// which is the repository root. Everything else lives in internal/app.
package main

import (
	"embed"

	"github.com/jordibrouwer/nextDash/internal/app"
)

//go:embed static/* templates/* locales/*
var embeddedFiles embed.FS

func main() {
	app.Run(embeddedFiles)
}
