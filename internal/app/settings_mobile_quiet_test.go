package app

import "testing"

func TestHideToastsMobileDefaultsOn(t *testing.T) {
	h, _ := healthRecheckTestHandlers(t, `{}`)
	if !h.store.GetSettings().HideToastsMobile {
		t.Fatal("a settings file without the key must read as on")
	}
	h, _ = healthRecheckTestHandlers(t, `{"hideToastsMobile":false}`)
	if h.store.GetSettings().HideToastsMobile {
		t.Fatal("an explicit false must stay off")
	}
}

func TestHideCornerCardsMobileDefaultsOn(t *testing.T) {
	h, _ := healthRecheckTestHandlers(t, `{}`)
	if !h.store.GetSettings().HideCornerCardsMobile {
		t.Fatal("a settings file without the key must read as on")
	}
	h, _ = healthRecheckTestHandlers(t, `{"hideCornerCardsMobile":false}`)
	if h.store.GetSettings().HideCornerCardsMobile {
		t.Fatal("an explicit false must stay off")
	}
}
