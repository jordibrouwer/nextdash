package app

import (
	"os"
	"strings"
	"testing"
)

func unraidFixture(t *testing.T, name string) []byte {
	t.Helper()
	raw, err := os.ReadFile("testdata/unraid/" + name + ".json")
	if err != nil {
		t.Fatal(err)
	}
	data, _, err := decodeUnraidAnswer(200, raw)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestToUnraidArray(t *testing.T) {
	v, err := toUnraidArray(unraidFixture(t, "array"))
	if err != nil {
		t.Fatal(err)
	}
	if !v.Started || v.DiskCount != 11 || v.Spinning != 9 {
		t.Fatalf("started=%v count=%d spinning=%d", v.Started, v.DiskCount, v.Spinning)
	}
	if v.TotalBytes != 131533373440*1024 {
		t.Fatalf("total = %d (kilobytes not converted?)", v.TotalBytes)
	}
	byName := map[string]UnraidDiskView{}
	for _, d := range v.Disks {
		byName[d.Name] = d
	}
	cases := []struct{ name, tone, problem, group string }{
		{"disk1", "good", "", "array"},
		{"disk3", "warn", "hot", "array"},
		{"disk5", "bad", "errors", "array"},
		{"disk6", "off", "", "array"},
		{"parity", "good", "", "parity"},
		{"cache", "good", "", "cache"},
	}
	for _, c := range cases {
		d := byName[c.name]
		if d.Tone != c.tone || d.Problem != c.problem || d.Group != c.group {
			t.Errorf("%s: tone=%s problem=%s group=%s", c.name, d.Tone, d.Problem, d.Group)
		}
	}
	if byName["disk6"].TempC != nil || !byName["disk6"].Asleep {
		t.Error("an asleep disk has no temperature and is not an error")
	}
	if v.ProblemDisks != 2 {
		t.Errorf("problem disks = %d", v.ProblemDisks)
	}
}

func TestToUnraidArraySumsCapacityWithoutKilobytes(t *testing.T) {
	raw := []byte(`{"array":{"state":"STARTED","parities":[],"caches":[],"disks":[
	  {"name":"disk1","status":"DISK_OK","fsSize":"100","fsUsed":"40","fsFree":"60","isSpinning":true,"type":"DATA"},
	  {"name":"disk2","status":"DISK_OK","fsSize":"100","fsUsed":"60","fsFree":"40","isSpinning":true,"type":"DATA"}]}}`)
	v, err := toUnraidArray(raw)
	if err != nil || v.TotalBytes != 200*1024 || v.UsedPct != 50 {
		t.Fatalf("v=%+v err=%v", v, err)
	}
}

func TestToUnraidArrayDisabledDisk(t *testing.T) {
	raw := []byte(`{"array":{"state":"STARTED","parities":[],"caches":[],"disks":[
	  {"name":"disk4","status":"DISK_DSBL","temp":30,"numErrors":"0","fsSize":"10","fsUsed":"1","fsFree":"9","isSpinning":true,"type":"DATA"}]}}`)
	v, _ := toUnraidArray(raw)
	if v.Disks[0].Tone != "bad" || v.Disks[0].Problem != "disabled" {
		t.Fatalf("%+v", v.Disks[0])
	}
}

func TestToUnraidParityRunning(t *testing.T) {
	v, err := toUnraidParity(unraidFixture(t, "parity"))
	if err != nil || !v.Running || v.Progress != 43 || len(v.History) != 4 || v.Last == nil || v.Last.Errors != 0 {
		t.Fatalf("v=%+v err=%v", v, err)
	}
	if v.LeftSec <= 0 {
		t.Fatalf("time left not worked out: %d", v.LeftSec)
	}
}

// Shares are grouped by where they live, since Unraid reports each share's
// used and free as those of that place.
func TestToUnraidSharesByPlace(t *testing.T) {
	v, err := toUnraidShares(unraidFixture(t, "shares"))
	if err != nil {
		t.Fatal(err)
	}
	got := map[string][]string{}
	var order []string
	for _, p := range v {
		got[p.Name] = p.Shares
		order = append(order, p.Name)
	}
	if strings.Join(order, ",") != "array,array + cache,cache" {
		t.Fatalf("order = %v", order)
	}
	if strings.Join(got["array"], ",") != "backups,media" || strings.Join(got["cache"], ",") != "appdata,system" ||
		strings.Join(got["array + cache"], ",") != "isos" {
		t.Fatalf("pools = %v", got)
	}
	if v[0].UsedPct != 71.4 {
		t.Fatalf("array used = %v", v[0].UsedPct)
	}
}

// A real Unraid 7.3.2 server: twenty-six shares, one array and two NVMe cache
// devices (the second reports no figures of its own), read a moment apart
// from the array's own capacity.
func TestToUnraidSharesRecordedServer(t *testing.T) {
	v, err := toUnraidShares(unraidFixture(t, "recorded-shares"))
	if err != nil {
		t.Fatal(err)
	}
	total := 0
	for _, p := range v {
		if p.Kind == "other" {
			t.Fatalf("a share was not placed: %+v", p)
		}
		total += len(p.Shares)
	}
	if len(v) != 3 || total != 26 {
		t.Fatalf("%d places, %d shares: %+v", len(v), total, v)
	}
}

func TestToUnraidVMsAndUPSAndNotifications(t *testing.T) {
	vms, _ := toUnraidVMs(unraidFixture(t, "vms"))
	if vms[0].State != "running" || vms[1].State != "paused" || vms[2].State != "stopped" {
		t.Fatalf("vms = %+v", vms)
	}
	ups, _ := toUnraidUPS(unraidFixture(t, "ups"))
	if ups.OnBattery || ups.Charge != 100 || ups.RuntimeSec != 3240 || ups.Watts != 112 {
		t.Fatalf("ups = %+v", ups)
	}
	n, _ := toUnraidNotifications(unraidFixture(t, "notifications"))
	if n.Alerts != 1 || n.Warnings != 2 || n.Items[0].Importance != "alert" || n.Items[0].At == 0 {
		t.Fatalf("n = %+v", n)
	}
}

func TestToUnraidNotificationLinksOnly(t *testing.T) {
	cases := []struct {
		input    *string
		expected string
		name     string
	}{
		{ptr("/Main"), "/Main", "plain path"},
		{ptr("//evil.com"), "", "protocol-relative dropped"},
		{ptr("/\\evil.com"), "", "backslash-trick dropped"},
		{ptr("https://evil.com"), "", "absolute URL dropped"},
		{nil, "", "null link"},
	}
	for _, c := range cases {
		raw := []byte(`{"notifications":{"overview":{"unread":{"alert":"0","warning":"0"}},"list":[{"id":"1","subject":"test","importance":"info","timestamp":"2026-10-02T12:00:00Z","link":` + linkJSON(c.input) + `}]}}`)
		v, _ := toUnraidNotifications(raw)
		if len(v.Items) > 0 && v.Items[0].Link != c.expected {
			t.Errorf("%s: got %q, want %q", c.name, v.Items[0].Link, c.expected)
		}
	}
}

func ptr(s string) *string { return &s }

func linkJSON(s *string) string {
	if s == nil {
		return "null"
	}
	// Escape for JSON
	escaped := strings.ReplaceAll(strings.ReplaceAll(strings.ReplaceAll(*s, "\\", "\\\\"), "\"", "\\\""), "/", "\\/")
	return "\"" + escaped + "\""
}

// Any state but DISK_OK is a disk to look at: Unraid has more than the four
// names the model knew (emulated, new, ...), and an unknown one must not pass
// as fine. An empty slot (DISK_NP) is no disk at all.
func TestToUnraidArrayUnknownDiskStatusIsRed(t *testing.T) {
	raw := []byte(`{"array":{"state":"STARTED","parities":[],"caches":[],"disks":[
	  {"name":"disk1","status":"DISK_EMULATED","temp":30,"numErrors":"0","fsSize":"10","fsUsed":"1","fsFree":"9","isSpinning":true},
	  {"name":"disk2","status":"DISK_NP_MISSING","numErrors":"0","isSpinning":false},
	  {"name":"disk3","status":"DISK_OK","temp":30,"numErrors":"0","fsSize":"10","fsUsed":"1","fsFree":"9","isSpinning":true},
	  {"name":"disk4","status":"DISK_NP"}]}}`)
	v, _ := toUnraidArray(raw)
	if len(v.Disks) != 3 {
		t.Fatalf("disks = %+v", v.Disks)
	}
	want := [][2]string{{"bad", "disabled"}, {"bad", "missing"}, {"good", ""}}
	for i, w := range want {
		if v.Disks[i].Tone != w[0] || v.Disks[i].Problem != w[1] {
			t.Errorf("%s: tone=%s problem=%s, want %v", v.Disks[i].Name, v.Disks[i].Tone, v.Disks[i].Problem, w)
		}
	}
	if v.ProblemDisks != 2 {
		t.Fatalf("problem disks = %d", v.ProblemDisks)
	}
}

// A server without a UPS reads fine: it has none, which is not "this
// version lacks it".
func TestToUnraidUPSWithoutADevice(t *testing.T) {
	v, err := toUnraidUPS([]byte(`{"upsDevices":[]}`))
	if err != nil || !v.None {
		t.Fatalf("v=%+v err=%v", v, err)
	}
	r := composeUnraidOverviewFrom([]unraidAreaResult{{Area: "ups", Status: "ok", Data: v, FetchedAt: 1, LastOkAt: 1}})
	if o, ok := r.Data.(UnraidOverviewView); !ok || o.UPS != nil {
		t.Fatalf("the overview drew a UPS row for none: %+v", r)
	}
}

// A disk is hot at its own warning temperature, else at 45 °C when it spins
// and 60 °C when it is an SSD or NVMe: a real server's NVMe cache sat at
// 45-46 °C and was reported as a problem.
func TestUnraidDiskHotThreshold(t *testing.T) {
	yes, no := true, false
	cases := []struct {
		name    string
		temp    float64
		warning any
		rot     *bool
		hot     bool
	}{
		{"nvme at 46", 46, nil, &no, false},
		{"nvme at 61", 61, nil, &no, true},
		{"hdd at 46", 46, nil, &yes, true},
		{"hdd at 48 with its own 50", 48, 50.0, &yes, false},
		{"unknown kind at 45", 45, nil, nil, true},
	}
	for _, c := range cases {
		d := toUnraidDisk(rawUnraidDisk{Name: "x", Status: "DISK_OK", Temp: c.temp, Warning: c.warning, Rotational: c.rot}, "cache")
		if got := d.Problem == "hot"; got != c.hot {
			t.Errorf("%s: hot = %v, want %v", c.name, got, c.hot)
		}
	}
}

// The array as a real, healthy Unraid 7.3 server answered it (recorded with
// scripts/unraid-record.py): sizes as JSON numbers, sleeping disks without a
// temperature, two NVMe cache devices at 45-46 °C. Nothing is a problem.
func TestToUnraidArrayRecordedHealthyServer(t *testing.T) {
	v, err := toUnraidArray(unraidFixture(t, "recorded-array"))
	if err != nil {
		t.Fatal(err)
	}
	if !v.Started || v.ProblemDisks != 0 {
		t.Fatalf("started=%v problemDisks=%d (%+v)", v.Started, v.ProblemDisks, v.Disks)
	}
	if v.TotalBytes != 36003715240*1024 {
		t.Fatalf("total = %d", v.TotalBytes)
	}
}
