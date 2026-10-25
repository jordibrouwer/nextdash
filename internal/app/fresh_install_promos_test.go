package app

import "testing"

// A fresh install is walked through setup by the start guide, which has the
// dashboard tour as a step. So the automatic tour that covers the same ground
// starts answered.
func TestFreshInstallStartsWithTheGuideOverlapAnswered(t *testing.T) {
	got := gridSettings(t, nil)
	state := got.DiscoverabilityState
	if state == nil {
		t.Fatal("no discoverability state on a fresh install")
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
