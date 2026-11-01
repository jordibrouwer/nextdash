package app

import "testing"

func TestFeedWatchWindowDefaultsTo30(t *testing.T) {
	cases := map[string]int{
		`{}`:                               30,
		`{"feedWatchWindowMinutes":60}`:    60,
		`{"feedWatchWindowMinutes":15}`:    15,
		`{"feedWatchWindowMinutes":120}`:   120,
		`{"feedWatchWindowMinutes":45}`:    30,
		`{"feedWatchWindowMinutes":0}`:     30,
		`{"feedWatchWindowMinutes":99999}`: 30,
		`{"feedWatchWindowMinutes":-5}`:    30,
	}
	for body, want := range cases {
		h, _ := healthRecheckTestHandlers(t, body)
		if got := h.store.GetSettings().FeedWatchWindowMinutes; got != want {
			t.Errorf("%s -> %d, want %d", body, got, want)
		}
	}
}

func TestFeedWatchNewsViewDefaultsToPaper(t *testing.T) {
	cases := map[string]string{
		`{}`:                               "paper",
		`{"feedWatchNewsView":"wide"}`:     "wide",
		`{"feedWatchNewsView":"paper"}`:    "paper",
		`{"feedWatchNewsView":"single"}`:   "single",
		`{"feedWatchNewsView":"magazine"}`: "paper",
		`{"feedWatchNewsView":""}`:         "paper",
	}
	for body, want := range cases {
		h, _ := healthRecheckTestHandlers(t, body)
		if got := h.store.GetSettings().FeedWatchNewsView; got != want {
			t.Errorf("%s -> %q, want %q", body, got, want)
		}
	}
}
