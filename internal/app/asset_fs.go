package app

import "io/fs"

// assetFS is the shipped copy of static/, templates/ and locales/.
//
// The concrete value in production is the embed.FS declared in the root
// package, which is where the //go:embed directive has to live: embed patterns
// resolve relative to the file that carries them and cannot climb out with
// "..", so the directive must sit beside the directories it names.
//
// It is an interface rather than embed.FS so the test suite can supply the same
// tree read from disk. Under `go test` nothing calls Run, so a concrete
// embed.FS field would sit at its zero value and every read through it would
// fail — which is not a behaviour worth reproducing in tests, because in
// production the field is never empty.
//
// ReadFile and Open are the whole surface: template parsing goes through
// fs.ParseFS and the static handler through fs.Sub, both of which need only
// fs.FS.
type assetFS interface {
	fs.FS
	ReadFile(name string) ([]byte, error)
}
