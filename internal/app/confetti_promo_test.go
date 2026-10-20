package app

import "testing"

func hasConfettiPromo(s Settings) bool {
	if s.DiscoverabilityState == nil {
		return false
	}
	for _, id := range s.DiscoverabilityState.SeenSettingPromos {
		if id == confettiThemePromoID {
			return true
		}
	}
	return false
}

// The invitation to try Confetti is for installs that already existed. A fresh
// install starts on Confetti and is not asked.
func TestConfettiInvitationIsNotForAFreshInstall(t *testing.T) {
	if got := gridSettings(t, nil); !hasConfettiPromo(got) {
		t.Errorf("a fresh install has not answered the Confetti invitation: %+v", got.DiscoverabilityState)
	}
}

func TestConfettiInvitationStaysOpenForAnExistingInstall(t *testing.T) {
	got := gridSettings(t, gridFile(map[string]any{"theme": "slate-dark"}))
	if hasConfettiPromo(got) {
		t.Error("an existing install was marked as having answered the invitation")
	}
}

// A fresh install is walked through setup by the start guide, which asks for
// the weather and offers the theme studio itself, and has the dashboard tour as
// a step. So the corner cards and the automatic tour that cover the same ground
// start answered.
func TestFreshInstallStartsWithTheGuideOverlapAnswered(t *testing.T) {
	got := gridSettings(t, nil)
	state := got.DiscoverabilityState
	if state == nil {
		t.Fatal("no discoverability state on a fresh install")
	}
	for _, id := range []string{"confetti-theme-try-v1", "clock-weather-v1", "theme-browser-try-v1"} {
		found := false
		for _, seen := range state.SeenSettingPromos {
			found = found || seen == id
		}
		if !found {
			t.Errorf("promo %s is not answered on a fresh install", id)
		}
	}
	tour := false
	for _, tip := range state.SeenTips {
		tour = tour || tip == "dashboardTutorialV3"
	}
	if !tour {
		t.Error("the dashboard tour would start by itself on a fresh install")
	}
}

func TestExistingInstallKeepsItsCornerCards(t *testing.T) {
	got := gridSettings(t, gridFile(map[string]any{"theme": "slate-dark"}))
	if got.DiscoverabilityState != nil && len(got.DiscoverabilityState.SeenSettingPromos) > 0 {
		t.Errorf("an existing install was marked as having answered: %+v", got.DiscoverabilityState)
	}
}

// The guide keeps which steps are done, and when it was finished, in the
// install's settings.
func TestQuickStartKeepsGuideProgress(t *testing.T) {
	got := gridSettings(t, gridFile(map[string]any{"quickStart": map[string]any{
		"stepsDone": []string{"tour", "import"}, "completedAt": 1760000000,
	}}))
	if len(got.QuickStart.StepsDone) != 2 || got.QuickStart.CompletedAt != 1760000000 {
		t.Errorf("guide progress was not kept: %+v", got.QuickStart)
	}
}
