package app

import "testing"

// The pace of the arrivals (views rising in, the dashboard's categories
// coming back) is one setting with three steps; the middle one is the
// default, for a fresh install and for one that never chose.
func TestAnimationSpeedDefaultsToNormal(t *testing.T) {
	for name, seed := range map[string]map[string]any{
		"never answered": {"currentPage": 1},
		"unknown value":  {"currentPage": 1, "animationSpeed": "warp"},
	} {
		t.Run(name, func(t *testing.T) {
			t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
			t.Chdir(t.TempDir())
			writeSurfaceSettingsFile(t, seed)

			if got := NewStore().GetSettings().AnimationSpeed; got != "normal" {
				t.Fatalf("animationSpeed = %q, want normal", got)
			}
		})
	}

	t.Run("fresh install", func(t *testing.T) {
		t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
		t.Chdir(t.TempDir())
		if got := NewStore().GetSettings().AnimationSpeed; got != "normal" {
			t.Fatalf("animationSpeed = %q, want normal", got)
		}
	})
}

func TestAChosenAnimationSpeedIsKept(t *testing.T) {
	for _, speed := range []string{"slow", "fast"} {
		t.Run(speed, func(t *testing.T) {
			t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
			t.Chdir(t.TempDir())
			writeSurfaceSettingsFile(t, map[string]any{"currentPage": 1, "animationSpeed": speed})

			if got := NewStore().GetSettings().AnimationSpeed; got != speed {
				t.Fatalf("animationSpeed = %q, want %s", got, speed)
			}
		})
	}
}

// Animations in views is its own switch beside the site-wide one: on for a
// fresh install and for one that never answered, off only when chosen.
func TestViewAnimationsAreOnUnlessTurnedOff(t *testing.T) {
	t.Run("fresh install", func(t *testing.T) {
		t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
		t.Chdir(t.TempDir())
		if !NewStore().GetSettings().ViewAnimationsEnabled {
			t.Fatal("fresh install: viewAnimationsEnabled is false")
		}
	})
	t.Run("never answered", func(t *testing.T) {
		t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
		t.Chdir(t.TempDir())
		writeSurfaceSettingsFile(t, map[string]any{"currentPage": 1})
		if !NewStore().GetSettings().ViewAnimationsEnabled {
			t.Fatal("existing install: viewAnimationsEnabled is false")
		}
	})
	t.Run("turned off", func(t *testing.T) {
		t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
		t.Chdir(t.TempDir())
		writeSurfaceSettingsFile(t, map[string]any{"currentPage": 1, "viewAnimationsEnabled": false})
		if NewStore().GetSettings().ViewAnimationsEnabled {
			t.Fatal("viewAnimationsEnabled is true after turning it off")
		}
	})
}
