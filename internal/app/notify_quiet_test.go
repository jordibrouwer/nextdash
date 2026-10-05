package app

import (
	"context"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

// 02:00 UTC on a Monday, inside a 22:00-07:00 window.
var quietNight = time.Date(2026, 10, 5, 2, 0, 0, 0, time.UTC)

const quietSettings = `{"quietHoursEnabled":true,"maintenanceTimeZone":"UTC",
	"quietHours":[{"start":"22:00","end":"07:00"}]`

func quietHandlers(t *testing.T, extra string) *Handlers {
	t.Helper()
	t.Chdir(t.TempDir())
	h, dir := healthRecheckTestHandlers(t, quietSettings+extra+`}`)
	// The monitor the tests open alerts for: reminders go only for a bookmark
	// that is still monitored and not muted.
	page := `{"id":1,"name":"Page 1","bookmarks":[{"name":"wiki","url":"https://wiki.example/","monitor":true}]}`
	if err := os.WriteFile(filepath.Join(dir, "bookmarks-1.json"), []byte(page), 0o644); err != nil {
		t.Fatal(err)
	}
	quietClock = func() time.Time { return quietNight }
	t.Cleanup(func() { quietClock = time.Now })
	return h
}

func downNotice(name string) monitorNotification {
	return monitorNotification{Event: "down", Name: name, URL: "https://" + name + ".example/", Status: "offline", At: quietNight.UnixMilli(), Failures: 3}
}

func TestQuietHoursOnlyHoldInsideTheWindow(t *testing.T) {
	h := quietHandlers(t, "")
	s := h.store.GetSettings()
	if !quietNow(s, quietNight) {
		t.Fatal("02:00 is inside 22:00-07:00")
	}
	for _, at := range []time.Time{quietNight.Add(5 * time.Hour), quietNight.Add(-10 * time.Hour)} {
		if quietNow(s, at) {
			t.Errorf("%s is outside the window", at.Format("15:04"))
		}
	}
	if end := quietEndsAt(s, quietNight); end.Hour() != 7 || end.Minute() != 0 {
		t.Errorf("window ends at %s, want 07:00", end.Format("15:04"))
	}
	off, _ := healthRecheckTestHandlers(t, `{"quietHoursEnabled":false,"quietHours":[{"start":"22:00","end":"07:00"}]}`)
	if quietNow(off.store.GetSettings(), quietNight) {
		t.Error("switched off, the hours still held")
	}
}

func TestQuietGateHoldsADownAndLetsAnExpiredCertificateThrough(t *testing.T) {
	h := quietHandlers(t, "")
	cert := monitorNotification{Event: "cert-expiring", Name: "a.example", DaysLeft: 0, At: quietNight.UnixMilli()}
	soon := monitorNotification{Event: "cert-expiring", Name: "b.example", DaysLeft: 9, At: quietNight.UnixMilli()}

	pass := h.quietGate(noticeSourceMonitor, []monitorNotification{downNotice("wiki"), cert, soon}, collapseMonitorNotifications)
	if len(pass) != 1 || pass[0].Name != "a.example" {
		t.Fatalf("passed %+v, want only the expired certificate", pass)
	}
	held := readHeldFile().Held
	if len(held) != 2 {
		t.Fatalf("held %d notices, want the down and the certificate that is not expired yet", len(held))
	}
}

func TestQuietGateLetsAMassOutagePassOnlyWhenAllowed(t *testing.T) {
	burst := []monitorNotification{downNotice("a"), downNotice("b"), downNotice("c"), downNotice("d")}

	h := quietHandlers(t, "")
	if pass := h.quietGate(noticeSourceMonitor, burst, collapseMonitorNotifications); len(pass) != 4 {
		t.Errorf("a burst passed as %d notices, want all four to reach the collapse", len(pass))
	}
	if held := readHeldFile().Held; len(held) != 0 {
		t.Errorf("a mass outage was held: %d", len(held))
	}

	h = quietHandlers(t, `,"quietHoursAllow":[]`)
	if pass := h.quietGate(noticeSourceMonitor, burst, collapseMonitorNotifications); len(pass) != 0 {
		t.Errorf("with nothing allowed the burst passed: %d", len(pass))
	}
	if held := readHeldFile().Held; len(held) != 4 {
		t.Errorf("held %d, want the four names kept for the summary", len(held))
	}
}

func TestQuietGateDoesNothingOutsideTheHours(t *testing.T) {
	h := quietHandlers(t, "")
	quietClock = func() time.Time { return quietNight.Add(9 * time.Hour) }
	in := []monitorNotification{downNotice("wiki")}
	if pass := h.quietGate(noticeSourceMonitor, in, collapseMonitorNotifications); len(pass) != 1 {
		t.Errorf("a notice at 11:00 was held")
	}
	if _, err := os.Stat(notifyHeldFilePath()); err == nil {
		t.Error("a file was written though nothing was held")
	}
}

func TestContainerCrashPassesOnlyWhenListed(t *testing.T) {
	crash := containerNotice("down", "plex", "plex stopped unexpectedly", "exit code 1", quietNight)

	h := quietHandlers(t, "")
	if pass := h.quietGate(noticeSourceContainer, []monitorNotification{crash}, collapseContainerNotices); len(pass) != 0 {
		t.Error("a container crash passed by default")
	}
	h = quietHandlers(t, `,"quietHoursAllow":["container-crash"]`)
	if pass := h.quietGate(noticeSourceContainer, []monitorNotification{crash}, collapseContainerNotices); len(pass) != 1 {
		t.Error("a listed container crash was held")
	}
}

func TestAFailedBackupBreaksTheQuietHoursAndASuccessDoesNot(t *testing.T) {
	h := quietHandlers(t, "")
	if h.quietGateBackup(monitorNotification{Event: "backup-failed", Source: noticeSourceBackup}) {
		t.Error("a failed backup was held")
	}
	if !h.quietGateBackup(monitorNotification{Event: "backup-ok", Source: noticeSourceBackup}) {
		t.Error("a successful backup was not held")
	}
}

func TestAllowListNilMeansDefaultsAndEmptyMeansNone(t *testing.T) {
	h, _ := healthRecheckTestHandlers(t, `{}`)
	if h.store.GetSettings().QuietHoursAllow != nil {
		t.Error("an absent list was filled in")
	}
	if set := quietAllowSet(h.store.GetSettings()); !set[quietKindCertExpired] || !set[quietKindMassOutage] || !set[quietKindBackupFailed] || set[quietKindContainerCrash] {
		t.Errorf("default set is wrong: %v", set)
	}
	h, _ = healthRecheckTestHandlers(t, `{"quietHoursAllow":[]}`)
	got := h.store.GetSettings().QuietHoursAllow
	if got == nil || len(got) != 0 {
		t.Errorf("an explicit empty list read back as %#v", got)
	}
}

func TestNormalizeQuietSettingsClampsAndDropsUnknownKinds(t *testing.T) {
	s := Settings{QuietHoursAllow: []string{"cert-expired", "nonsense", "cert-expired"}, RemindAfterMinutes: 1, RemindMax: 99}
	normalizeQuietSettings(&s)
	if len(s.QuietHoursAllow) != 1 || s.RemindAfterMinutes != minRemindAfterMinutes || s.RemindMax != maxRemindMax {
		t.Errorf("normalised to %+v", s)
	}
	z := Settings{}
	normalizeQuietSettings(&z)
	if z.RemindAfterMinutes != defaultRemindAfterMinutes || z.RemindMax != defaultRemindMax {
		t.Errorf("defaults are %d and %d", z.RemindAfterMinutes, z.RemindMax)
	}
}

func TestSummaryCountsTheLastEventPerName(t *testing.T) {
	held := []heldNotice{
		{Source: noticeSourceMonitor, Notice: downNotice("wiki")},
		{Source: noticeSourceMonitor, Notice: monitorNotification{Event: "up", Name: "wiki", URL: "https://wiki.example/"}},
		{Source: noticeSourceMonitor, Notice: downNotice("vault")},
		{Source: noticeSourceMonitor, Notice: downNotice("photos")},
		{Source: noticeSourceMonitor, Notice: monitorNotification{Event: "up", Name: "photos", URL: "https://photos.example/"}},
		{Source: noticeSourceMonitor, Notice: downNotice("photos")},
	}
	sum := summariseHeld(held)
	if strings.Join(sum.Still, ",") != "vault,photos" || strings.Join(sum.Recovered, ",") != "wiki" {
		t.Fatalf("still %v recovered %v", sum.Still, sum.Recovered)
	}
	n := quietDigestNotice(sum, quietNight)
	if !strings.Contains(n.Title, "2 still down") || !strings.Contains(n.Title, "1 recovered") {
		t.Errorf("title %q", n.Title)
	}
	if !strings.Contains(n.Error, "Still down: vault, photos.") || !strings.Contains(n.Error, "Recovered: wiki.") {
		t.Errorf("body %q", n.Error)
	}
}

func TestHeldFileSurvivesARestartAndIsBounded(t *testing.T) {
	h := quietHandlers(t, "")
	var many []monitorNotification
	for i := 0; i < quietHeldMax+30; i++ {
		many = append(many, downNotice("svc"+string(rune('a'+i%26))+string(rune('a'+i/26))))
	}
	h.holdNotices(noticeSourceMonitor, many, h.store.GetSettings(), quietNight)
	held := readHeldFile().Held
	if len(held) != quietHeldMax {
		t.Errorf("held %d, want it held at %d", len(held), quietHeldMax)
	}
}

func TestFlushingSendsOnceAndEmptiesTheFile(t *testing.T) {
	h := quietHandlers(t, "")
	h.holdNotices(noticeSourceMonitor, []monitorNotification{downNotice("wiki"), downNotice("vault")}, h.store.GetSettings(), quietNight)
	h.trackOpenAlerts(noticeSourceMonitor, []monitorNotification{downNotice("wiki")})

	morning := quietNight.Add(6 * time.Hour)
	h.flushHeld(context.Background(), morning)

	if _, err := os.Stat(notifyHeldFilePath()); err == nil {
		t.Error("the held file is still there after the summary")
	}
	open := readOpenFile().Open
	if len(open) != 1 || open[0].LastAt != morning.UnixMilli() {
		t.Errorf("a reported outage keeps its old reminder time: %+v", open)
	}
}

func TestRemindersWaitForTheirTurnAndStopAtTheLimit(t *testing.T) {
	h := quietHandlers(t, `,"remindersEnabled":true,"remindAfterMinutes":30,"remindMax":2`)
	// Outside the hours, so reminders may go.
	day := quietNight.Add(10 * time.Hour)
	quietClock = func() time.Time { return day }
	h.trackOpenAlerts(noticeSourceMonitor, []monitorNotification{{Event: "down", Name: "wiki", URL: "https://wiki.example/", At: day.UnixMilli()}})

	h.sendReminders(context.Background(), day.Add(10*time.Minute))
	if o := readOpenFile().Open; o[0].Count != 0 {
		t.Errorf("a reminder went after 10 minutes of 30: %+v", o)
	}
	h.sendReminders(context.Background(), day.Add(31*time.Minute))
	h.sendReminders(context.Background(), day.Add(62*time.Minute))
	h.sendReminders(context.Background(), day.Add(95*time.Minute))
	if o := readOpenFile().Open; o[0].Count != 2 {
		t.Errorf("count %d, want it stopped at the limit of 2", o[0].Count)
	}
}

func TestNoReminderInTheQuietHoursAndARecoveryClosesTheAlert(t *testing.T) {
	h := quietHandlers(t, `,"remindersEnabled":true,"remindAfterMinutes":5`)
	h.trackOpenAlerts(noticeSourceMonitor, []monitorNotification{downNotice("wiki")})
	h.sendReminders(context.Background(), quietNight.Add(2*time.Hour))
	if o := readOpenFile().Open; o[0].Count != 0 {
		t.Errorf("a reminder went in the quiet hours: %+v", o)
	}
	h.trackOpenAlerts(noticeSourceMonitor, []monitorNotification{{Event: "up", Name: "wiki", URL: "https://wiki.example/"}})
	if o := readOpenFile().Open; len(o) != 0 {
		t.Errorf("an up left the alert open: %+v", o)
	}
}

func TestReminderTitleSaysHowLong(t *testing.T) {
	alert := openAlert{Source: noticeSourceMonitor, Name: "Photo library", Since: quietNight.UnixMilli()}
	n := reminderNotice(alert, quietNight.Add(65*time.Minute))
	if !strings.Contains(n.Title, "Photo library is still down after 1h 5m") && !strings.Contains(n.Title, "after") {
		t.Errorf("title %q", n.Title)
	}
	if reminderNotice(openAlert{Source: noticeSourceContainer, Name: "plex", Since: 1}, quietNight).Event != "reminder" {
		t.Error("not a reminder")
	}
}

// Every place that talks to a sink has to have gone through the gate first. A
// fifth caller that does not would let a notice through the quiet hours, so the
// list of files that may call a sink is fixed here, and a new one is a decision.
func TestOnlyKnownFilesCallTheSinks(t *testing.T) {
	allowed := map[string]bool{
		"health_notify.go": true, "docker_notify.go": true, "unraid_notify.go": true,
		"push_triggers.go": true, "notify_quiet.go": true, "push_send.go": true,
		"push_handlers.go":         true, // the push test button
		"health_notify_presets.go": true,
	}
	call := regexp.MustCompile(`\.(postMonitorTarget|sendWebPushNotification)\(`)
	files, _ := filepath.Glob("*.go")
	for _, file := range files {
		if strings.HasSuffix(file, "_test.go") {
			continue
		}
		data, _ := os.ReadFile(file)
		if call.Match(data) && !allowed[file] {
			t.Errorf("%s calls a notification sink and is not on the list: add the quiet-hours gate (quietGate) before it, then list the file", file)
		}
	}
}

// The gate is only worth what is wired to it: each source's own dispatcher has
// to hold a notice in the quiet hours.
func TestEverySourceHoldsThroughItsOwnDispatcher(t *testing.T) {
	h := quietHandlers(t, "")
	ctx := context.Background()

	h.dispatchMonitorNotifications(ctx, []monitorNotification{downNotice("wiki")})
	h.dispatchContainerNotices(ctx, []monitorNotification{containerNotice("down", "plex", "plex is unhealthy", "its healthcheck is failing", quietNight)})
	h.dispatchUnraidNotices(ctx, []monitorNotification{{Event: "alert", Name: "Unraid", Title: "Disk 3 is hot", Source: noticeSourceUnraid, At: quietNight.UnixMilli()}})
	h.pushAutoBackupResult(ctx, nil)

	got := map[string]int{}
	for _, e := range readHeldFile().Held {
		got[e.Source]++
	}
	// The backup is only held when pushing backups is on, which the settings of
	// this test do not do; the other three do not depend on a sink being on.
	for _, source := range []string{noticeSourceMonitor, noticeSourceContainer, noticeSourceUnraid} {
		if got[source] != 1 {
			t.Errorf("%s: %d held, want 1 (all: %v)", source, got[source], got)
		}
	}
}

func TestABackupIsHeldWhenBackupPushIsOn(t *testing.T) {
	h := quietHandlers(t, `,"pushNotifyEnabled":true,"pushNotifyBackup":true`)
	h.pushAutoBackupResult(context.Background(), nil)
	held := readHeldFile().Held
	if len(held) != 1 || held[0].Source != noticeSourceBackup || !held[0].Push || held[0].Webhook {
		t.Fatalf("held %+v, want one backup notice that would only have pushed", held)
	}
}

// An alert for a bookmark muted, no longer monitored or deleted since it
// opened never gets its "up": the register lets it go instead of reminding.
func TestRemindersStopForWhatIsNoLongerWatched(t *testing.T) {
	h := quietHandlers(t, `,"remindersEnabled":true,"remindAfterMinutes":5`)
	day := quietNight.Add(10 * time.Hour)
	quietClock = func() time.Time { return day }
	h.trackOpenAlerts(noticeSourceMonitor, []monitorNotification{
		{Event: "down", Name: "wiki", URL: "https://wiki.example/", At: day.UnixMilli()},
		{Event: "down", Name: "gone", URL: "https://gone.example/", At: day.UnixMilli()},
	})
	h.sendReminders(context.Background(), day.Add(6*time.Minute))
	open := readOpenFile().Open
	if len(open) != 1 || open[0].Name != "wiki" || open[0].Count != 1 {
		t.Fatalf("open = %+v, want only wiki, reminded once", open)
	}

	bms := h.store.GetBookmarksByPage(1)
	bms[0].NotifyMuted = true
	if err := h.store.SaveBookmarksByPage(1, bms); err != nil {
		t.Fatal(err)
	}
	h.sendReminders(context.Background(), day.Add(12*time.Minute))
	if open := readOpenFile().Open; len(open) != 0 {
		t.Fatalf("a muted bookmark kept its alert: %+v", open)
	}
}
