package app

import (
	"os"
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

func TestToUnraidSharesFullestFirst(t *testing.T) {
	v, _ := toUnraidShares(unraidFixture(t, "shares"))
	if v[0].Name != "media" || v[0].Tone != "bad" {
		t.Fatalf("first = %+v", v[0])
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
