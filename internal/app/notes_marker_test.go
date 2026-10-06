package app

import "testing"

// A notes widget somebody removed must not come back on the next start: the
// migration's marker survives a settings save.
func TestNotesMarkerSurvivesASettingsSave(t *testing.T) {
	h := newTestHandlers(t)
	fs, ok := h.store.(*FileStore)
	if !ok {
		t.Skip("not a file store")
	}
	if !fs.setMigrationMarker("notesWidgetSeeded") {
		t.Fatal("marker not written")
	}
	if err := fs.SaveSettings(fs.GetSettings()); err != nil {
		t.Fatal(err)
	}
	if !fs.migrationMarkerSet("notesWidgetSeeded") {
		t.Error("a settings save dropped the notes marker")
	}
}
