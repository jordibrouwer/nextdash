package app

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"
)

/*
The Unraid API's answer, turned into what a tile draws.

Every unit and judgement is made here, once: Unraid counts disk and share sizes
in kilobytes, a sleeping disk has no temperature, and "is this a problem" is a
rule the watcher and the tiles must agree on. The browser does no arithmetic.
*/

const (
	// unraidHotC and unraidHotSSDC are the warning temperatures when a disk
	// has none of its own: Unraid's 45 °C for spinning disks, and 60 °C for
	// SSDs and NVMe, which run warmer and for which 45 °C is ordinary (an
	// NVMe cache read 45-46 °C on a real, healthy server).
	unraidHotC         = 45
	unraidHotSSDC      = 60
	unraidFullPct      = 90
	unraidShareWarnPct = 85
	unraidShareBadPct  = 93
)

type UnraidDiskView struct {
	Name       string  `json:"name"`
	Group      string  `json:"group"` // parity | array | cache
	Status     string  `json:"status"`
	TempC      *int    `json:"tempC,omitempty"`
	Errors     int64   `json:"errors"`
	UsedPct    float64 `json:"usedPct"`
	FreeBytes  int64   `json:"freeBytes"`
	TotalBytes int64   `json:"totalBytes"`
	Asleep     bool    `json:"asleep"`
	Tone       string  `json:"tone"`              // good | warn | bad | off
	Problem    string  `json:"problem,omitempty"` // errors | disabled | missing | hot | full
}

type UnraidArrayView struct {
	State        string           `json:"state"`
	Started      bool             `json:"started"`
	UsedBytes    int64            `json:"usedBytes"`
	FreeBytes    int64            `json:"freeBytes"`
	TotalBytes   int64            `json:"totalBytes"`
	UsedPct      float64          `json:"usedPct"`
	ProblemDisks int              `json:"problemDisks"`
	Spinning     int              `json:"spinning"`
	DiskCount    int              `json:"diskCount"`
	Disks        []UnraidDiskView `json:"disks"`
}

type UnraidParityRun struct {
	Date        string `json:"date"`
	DurationSec int64  `json:"durationSec"`
	Speed       string `json:"speed"`
	Status      string `json:"status"`
	Errors      int64  `json:"errors"`
}

type UnraidParityView struct {
	Running  bool              `json:"running"`
	Paused   bool              `json:"paused"`
	Progress int               `json:"progress"`
	Speed    string            `json:"speed"`
	Errors   int64             `json:"errors"`
	LeftSec  int64             `json:"leftSec"`
	Last     *UnraidParityRun  `json:"last,omitempty"`
	History  []UnraidParityRun `json:"history"`
}

/*
UnraidSharePool is one place shares live, and the shares that live there.

Unraid does not report what a share holds: a share's used and free are those
of where it lives -- the array, a cache pool, or both when it overflows from
one to the other. Listed per share that was the same figure eighteen times
(44 % on a real server), so the shares are grouped by place and the place
carries the figure.
*/
type UnraidSharePool struct {
	Name       string   `json:"name"` // "array", the pool's name, "array + <pool>", or "other"
	Kind       string   `json:"kind"` // array | pool | both | other
	UsedPct    float64  `json:"usedPct"`
	FreeBytes  int64    `json:"freeBytes"`
	TotalBytes int64    `json:"totalBytes"`
	Tone       string   `json:"tone"`
	Shares     []string `json:"shares"`
}

type UnraidVMView struct {
	Name  string `json:"name"`
	State string `json:"state"` // running | paused | stopped | crashed
	Tone  string `json:"tone"`
}

type UnraidUPSView struct {
	Name       string `json:"name"`
	Model      string `json:"model"`
	OnBattery  bool   `json:"onBattery"`
	Charge     int    `json:"charge"`
	RuntimeSec int64  `json:"runtimeSec"`
	LoadPct    int    `json:"loadPct"`
	Watts      int    `json:"watts"`
	Tone       string `json:"tone"`
	None       bool   `json:"none,omitempty"` // the server reports no UPS at all
}

type UnraidNotificationView struct {
	ID         string `json:"id"`
	Subject    string `json:"subject"`
	Importance string `json:"importance"` // alert | warning | info
	Link       string `json:"link,omitempty"`
	At         int64  `json:"at"` // unix ms
}

type UnraidNotificationsView struct {
	Alerts   int                      `json:"alerts"`
	Warnings int                      `json:"warnings"`
	Items    []UnraidNotificationView `json:"items"`
}

type UnraidInfoView struct {
	Name   string   `json:"name"`
	Unraid string   `json:"unraid"`
	API    string   `json:"api"`
	Roles  []string `json:"roles,omitempty"`
}

func unraidInt(v any) int64 {
	switch x := v.(type) {
	case float64:
		if math.IsNaN(x) {
			return 0
		}
		return int64(x)
	case string:
		n, _ := strconv.ParseInt(strings.TrimSpace(x), 10, 64)
		return n
	case json.Number:
		n, _ := x.Int64()
		return n
	}
	return 0
}

func kbToBytes(kb int64) int64 { return kb * 1024 }

func unraidPct(used, total int64) float64 {
	if total <= 0 {
		return 0
	}
	return math.Round(float64(used)*1000/float64(total)) / 10
}

type rawUnraidDisk struct {
	Name       string `json:"name"`
	Status     string `json:"status"`
	Temp       any    `json:"temp"`
	NumErrors  any    `json:"numErrors"`
	FsSize     any    `json:"fsSize"`
	FsUsed     any    `json:"fsUsed"`
	FsFree     any    `json:"fsFree"`
	IsSpinning *bool  `json:"isSpinning"`
	Warning    any    `json:"warning"`
	Rotational *bool  `json:"rotational"`
}

// hotAt is the temperature this disk warns at: its own threshold when it has
// one, else the default for its kind.
func (r rawUnraidDisk) hotAt() int {
	if w := unraidInt(r.Warning); w > 0 {
		return int(w)
	}
	if r.Rotational != nil && !*r.Rotational {
		return unraidHotSSDC
	}
	return unraidHotC
}

func toUnraidDisk(r rawUnraidDisk, group string) UnraidDiskView {
	d := UnraidDiskView{Name: r.Name, Group: group, Status: r.Status, Errors: unraidInt(r.NumErrors)}
	d.TotalBytes = kbToBytes(unraidInt(r.FsSize))
	d.FreeBytes = kbToBytes(unraidInt(r.FsFree))
	d.UsedPct = unraidPct(kbToBytes(unraidInt(r.FsUsed)), d.TotalBytes)
	if t, ok := r.Temp.(float64); ok && !math.IsNaN(t) && t > 0 {
		c := int(t)
		d.TempC = &c
	}
	d.Asleep = r.IsSpinning != nil && !*r.IsSpinning
	switch {
	case r.Status == "DISK_NP_MISSING":
		d.Tone, d.Problem = "bad", "missing"
	// Every other state but OK (disabled, emulated, invalid, wrong, new, and
	// any Unraid adds later) needs looking at; empty is a schema without status.
	case r.Status != "" && r.Status != "DISK_OK" && r.Status != "DISK_NP":
		d.Tone, d.Problem = "bad", "disabled"
	case d.Errors > 0:
		d.Tone, d.Problem = "bad", "errors"
	case d.TempC != nil && *d.TempC >= r.hotAt():
		d.Tone, d.Problem = "warn", "hot"
	case d.UsedPct >= unraidFullPct:
		d.Tone, d.Problem = "warn", "full"
	case d.Asleep:
		d.Tone = "off"
	default:
		d.Tone = "good"
	}
	return d
}

func toUnraidArray(data json.RawMessage) (UnraidArrayView, error) {
	var raw struct {
		Array struct {
			State    string `json:"state"`
			Capacity *struct {
				Kilobytes *struct{ Free, Used, Total any } `json:"kilobytes"`
			} `json:"capacity"`
			Parities []rawUnraidDisk `json:"parities"`
			Disks    []rawUnraidDisk `json:"disks"`
			Caches   []rawUnraidDisk `json:"caches"`
		} `json:"array"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return UnraidArrayView{}, fmt.Errorf("unraid: array answer unreadable")
	}
	a := raw.Array
	v := UnraidArrayView{State: a.State, Started: a.State == "STARTED"}
	add := func(list []rawUnraidDisk, group string) {
		for _, r := range list {
			if r.Status == "DISK_NP" { // an empty slot, not a disk
				continue
			}
			d := toUnraidDisk(r, group)
			v.Disks = append(v.Disks, d)
			v.DiskCount++
			if !d.Asleep {
				v.Spinning++
			}
			if d.Problem == "errors" || d.Problem == "disabled" || d.Problem == "missing" || d.Problem == "hot" {
				v.ProblemDisks++
			}
			if group == "array" && (a.Capacity == nil || a.Capacity.Kilobytes == nil) {
				v.TotalBytes += d.TotalBytes
				v.FreeBytes += d.FreeBytes
			}
		}
	}
	add(a.Parities, "parity")
	add(a.Disks, "array")
	add(a.Caches, "cache")
	if a.Capacity != nil && a.Capacity.Kilobytes != nil {
		v.TotalBytes = kbToBytes(unraidInt(a.Capacity.Kilobytes.Total))
		v.FreeBytes = kbToBytes(unraidInt(a.Capacity.Kilobytes.Free))
	}
	v.UsedBytes = v.TotalBytes - v.FreeBytes
	v.UsedPct = unraidPct(v.UsedBytes, v.TotalBytes)
	return v, nil
}

type rawUnraidParity struct {
	Status   string `json:"status"`
	Running  bool   `json:"running"`
	Paused   bool   `json:"paused"`
	Progress any    `json:"progress"`
	Speed    string `json:"speed"`
	Errors   any    `json:"errors"`
	Date     string `json:"date"`
	Duration any    `json:"duration"`
}

func toUnraidParity(data json.RawMessage) (UnraidParityView, error) {
	var raw struct {
		Array struct {
			ParityCheckStatus rawUnraidParity `json:"parityCheckStatus"`
		} `json:"array"`
		ParityHistory []rawUnraidParity `json:"parityHistory"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return UnraidParityView{}, fmt.Errorf("unraid: parity answer unreadable")
	}
	s := raw.Array.ParityCheckStatus
	// A paused check is still under way: the API leaves running null and
	// says PAUSED in the status, and reading that as done sent the finished
	// alert at the pause.
	v := UnraidParityView{Running: s.Running || s.Status == "RUNNING" || s.Status == "PAUSED", Paused: s.Paused || s.Status == "PAUSED",
		Progress: int(unraidInt(s.Progress)), Speed: s.Speed, Errors: unraidInt(s.Errors)}
	if v.Running && v.Progress > 0 && v.Progress < 100 {
		elapsed := unraidInt(s.Duration)
		v.LeftSec = elapsed * int64(100-v.Progress) / int64(v.Progress)
	}
	for _, h := range raw.ParityHistory {
		v.History = append(v.History, UnraidParityRun{Date: h.Date, DurationSec: unraidInt(h.Duration),
			Speed: h.Speed, Status: strings.ToLower(h.Status), Errors: unraidInt(h.Errors)})
	}
	sort.SliceStable(v.History, func(i, j int) bool { return v.History[i].Date > v.History[j].Date })
	if len(v.History) > 5 {
		v.History = v.History[:5]
	}
	if len(v.History) > 0 {
		last := v.History[0]
		v.Last = &last
	} else if !v.Running && s.Date != "" {
		v.Last = &UnraidParityRun{Date: s.Date, DurationSec: unraidInt(s.Duration), Speed: s.Speed,
			Status: strings.ToLower(s.Status), Errors: v.Errors}
	}
	return v, nil
}

// unraidSamePlace says whether two used/free readings in KB are the same
// place: the share list and the array are read a moment apart, and a busy
// disk moves a few megabytes in between (1.2 MB on a real server).
func unraidSamePlace(used, free, pUsed, pFree int64) bool {
	total := pUsed + pFree
	if total <= 0 {
		return false
	}
	slack := total / 500 // 0.2 %
	abs := func(n int64) int64 {
		if n < 0 {
			return -n
		}
		return n
	}
	return abs(used-pUsed) <= slack && abs(free-pFree) <= slack
}

func toUnraidShares(data json.RawMessage) ([]UnraidSharePool, error) {
	var raw struct {
		Shares []struct {
			Name       string `json:"name"`
			Used, Free any
		} `json:"shares"`
		Array *struct {
			Capacity *struct {
				Kilobytes *struct{ Free, Used any } `json:"kilobytes"`
			} `json:"capacity"`
			Caches []struct {
				Name           string `json:"name"`
				FsUsed, FsFree any
			} `json:"caches"`
		} `json:"array"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("unraid: shares answer unreadable")
	}

	type place struct {
		name, kind string
		used, free int64
	}
	var places []place
	var array *place
	if raw.Array != nil && raw.Array.Capacity != nil && raw.Array.Capacity.Kilobytes != nil {
		k := raw.Array.Capacity.Kilobytes
		array = &place{name: "array", kind: "array", used: unraidInt(k.Used), free: unraidInt(k.Free)}
		places = append(places, *array)
	}
	if raw.Array != nil {
		for _, c := range raw.Array.Caches {
			// A pool's first device carries the pool's figures; the others
			// of a multi-device pool report none.
			if c.FsUsed == nil || c.FsFree == nil {
				continue
			}
			pool := place{name: c.Name, kind: "pool", used: unraidInt(c.FsUsed), free: unraidInt(c.FsFree)}
			places = append(places, pool)
			if array != nil {
				places = append(places, place{name: "array + " + c.Name, kind: "both",
					used: array.used + pool.used, free: array.free + pool.free})
			}
		}
	}

	byKey := map[string]*UnraidSharePool{}
	var order []string
	for _, sh := range raw.Shares {
		used, free := unraidInt(sh.Used), unraidInt(sh.Free)
		key, name, kind := "", "other", "other"
		for _, p := range places {
			if unraidSamePlace(used, free, p.used, p.free) {
				key, name, kind = p.name, p.name, p.kind
				break
			}
		}
		if key == "" {
			key = fmt.Sprintf("other:%d/%d", used, free)
		}
		pool := byKey[key]
		if pool == nil {
			total := kbToBytes(used + free)
			pool = &UnraidSharePool{Name: name, Kind: kind, FreeBytes: kbToBytes(free), TotalBytes: total,
				UsedPct: unraidPct(kbToBytes(used), total), Tone: "good"}
			switch {
			case pool.UsedPct >= unraidShareBadPct:
				pool.Tone = "bad"
			case pool.UsedPct >= unraidShareWarnPct:
				pool.Tone = "warn"
			}
			byKey[key] = pool
			order = append(order, key)
		}
		pool.Shares = append(pool.Shares, sh.Name)
	}

	rank := map[string]int{"array": 0, "both": 1, "pool": 2, "other": 3}
	out := make([]UnraidSharePool, 0, len(order))
	for _, k := range order {
		p := byKey[k]
		sort.Strings(p.Shares)
		out = append(out, *p)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if rank[out[i].Kind] != rank[out[j].Kind] {
			return rank[out[i].Kind] < rank[out[j].Kind]
		}
		return out[i].Name < out[j].Name
	})
	return out, nil
}

func toUnraidVMs(data json.RawMessage) ([]UnraidVMView, error) {
	var raw struct {
		VMs struct {
			Domains []struct{ Name, State string } `json:"domains"`
		} `json:"vms"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("unraid: VM answer unreadable")
	}
	out := []UnraidVMView{}
	for _, d := range raw.VMs.Domains {
		v := UnraidVMView{Name: d.Name}
		switch d.State {
		case "RUNNING", "IDLE":
			v.State, v.Tone = "running", "good"
		case "PAUSED", "PMSUSPENDED":
			v.State, v.Tone = "paused", "warn"
		case "CRASHED":
			v.State, v.Tone = "crashed", "bad"
		default:
			v.State, v.Tone = "stopped", "off"
		}
		out = append(out, v)
	}
	return out, nil
}

func toUnraidUPS(data json.RawMessage) (UnraidUPSView, error) {
	var raw struct {
		UPS []struct {
			Name, Model, Status string
			Battery             struct{ ChargeLevel, EstimatedRuntime any } `json:"battery"`
			Power               struct{ LoadPercentage, CurrentPower any }  `json:"power"`
		} `json:"upsDevices"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return UnraidUPSView{}, fmt.Errorf("unraid: UPS answer unreadable")
	}
	if len(raw.UPS) == 0 {
		return UnraidUPSView{None: true, Tone: "off"}, nil
	}
	u := raw.UPS[0]
	v := UnraidUPSView{Name: u.Name, Model: u.Model, Charge: int(unraidInt(u.Battery.ChargeLevel)),
		RuntimeSec: unraidInt(u.Battery.EstimatedRuntime), LoadPct: int(unraidInt(u.Power.LoadPercentage)),
		Watts: int(unraidInt(u.Power.CurrentPower)), Tone: "good"}
	status := strings.ToUpper(u.Status)
	v.OnBattery = strings.Contains(status, "BATTERY") || strings.Contains(status, "ONBATT") || status == "OB"
	if v.OnBattery || v.Charge < 50 {
		v.Tone = "warn"
	}
	if v.Charge < 20 {
		v.Tone = "bad"
	}
	return v, nil
}

func toUnraidNotifications(data json.RawMessage) (UnraidNotificationsView, error) {
	var raw struct {
		N struct {
			Overview struct {
				Unread struct{ Alert, Warning any } `json:"unread"`
			} `json:"overview"`
			List []struct {
				ID, Subject, Importance, Timestamp string
				Link                               *string
			} `json:"list"`
		} `json:"notifications"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return UnraidNotificationsView{}, fmt.Errorf("unraid: notifications answer unreadable")
	}
	v := UnraidNotificationsView{Alerts: int(unraidInt(raw.N.Overview.Unread.Alert)), Warnings: int(unraidInt(raw.N.Overview.Unread.Warning))}
	for _, n := range raw.N.List {
		item := UnraidNotificationView{ID: n.ID, Subject: n.Subject, Importance: strings.ToLower(n.Importance)}
		if n.Link != nil && strings.HasPrefix(*n.Link, "/") && (len(*n.Link) < 2 || ((*n.Link)[1] != '/' && (*n.Link)[1] != '\\')) {
			item.Link = *n.Link // only a path on the server itself; the browser prefixes the base URL
		}
		if t, err := time.Parse(time.RFC3339, n.Timestamp); err == nil {
			item.At = t.UnixMilli()
		}
		v.Items = append(v.Items, item)
	}
	sort.SliceStable(v.Items, func(i, j int) bool { return v.Items[i].At > v.Items[j].At })
	return v, nil
}

func toUnraidInfo(data json.RawMessage) (UnraidInfoView, error) {
	var raw struct {
		Info struct {
			OS struct {
				Hostname string `json:"hostname"`
			} `json:"os"`
			Versions struct {
				Unraid string `json:"unraid"`
				API    string `json:"api"`
				Core   *struct {
					Unraid string `json:"unraid"`
					API    string `json:"api"`
				} `json:"core"`
			} `json:"versions"`
		} `json:"info"`
		Me *struct {
			Roles []string `json:"roles"`
		} `json:"me"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return UnraidInfoView{}, fmt.Errorf("unraid: info answer unreadable")
	}
	v := UnraidInfoView{Name: raw.Info.OS.Hostname, Unraid: raw.Info.Versions.Unraid, API: raw.Info.Versions.API}
	if c := raw.Info.Versions.Core; c != nil {
		v.Unraid, v.API = c.Unraid, c.API
	}
	if raw.Me != nil {
		v.Roles = raw.Me.Roles
	}
	return v, nil
}
