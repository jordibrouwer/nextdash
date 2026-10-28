package app

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

/*
The demo's Glances: one monitored host, "Tower", that does not exist.

glancesGet answers from here instead of dialing, so the page, the sampler and
the dashboard widget run unchanged against a machine made of sums of sines.
Every reading is a function of the clock, so the week of history the seed
writes (seedDemoGlances) and the readings the sampler takes from then on are
one line. Nothing here reaches a network.
*/

const (
	demoGlancesServer = "http://tower.local:61208"
	demoGlancesName   = "Tower"
	demoGlancesCores  = 8
	demoGlancesDay    = 24 * time.Hour
)

// demoGlancesAnchor is when the seed ran: the disks fill from here, and the
// machine booted twelve days before it.
var demoGlancesAnchor atomic.Int64

func demoGlancesAnchorTime() time.Time {
	if ms := demoGlancesAnchor.Load(); ms > 0 {
		return time.UnixMilli(ms)
	}
	return time.Now()
}

// wave is a smooth wobble between -1 and 1 with its own period and phase, so
// two seeds never move together.
func demoWave(at time.Time, seed string, period time.Duration) float64 {
	sum := 0
	for _, c := range seed {
		sum = sum*31 + int(c)
	}
	phase := float64(sum%628) / 100
	return math.Sin(2*math.Pi*float64(at.UnixMilli())/float64(period.Milliseconds()) + phase)
}

func demoClamp(v, lo, hi float64) float64 { return math.Max(lo, math.Min(hi, v)) }

func demoRound(v float64, places int) float64 {
	p := math.Pow(10, float64(places))
	return math.Round(v*p) / p
}

// demoGlancesCPU is the processor's load: a slow swell through the working
// day, the minutes' wobble, and the parity check at three at night.
func demoGlancesCPU(at time.Time) float64 {
	u := at.UTC()
	hour := float64(u.Hour()) + float64(u.Minute())/60
	v := 11 + 6*demoWave(at, "cpu-a", 37*time.Minute) + 3*demoWave(at, "cpu-b", 4*time.Minute) +
		1.5*demoWave(at, "cpu-c", 23*time.Second) + 12*math.Max(0, math.Sin(2*math.Pi*(hour-9)/24))
	if hour >= 3 && hour < 3.25 {
		v += 38
	}
	return demoClamp(v, 1.5, 96)
}

func demoGlancesCore(at time.Time, i int) float64 {
	return demoClamp(demoGlancesCPU(at)+7*demoWave(at, "core"+strconv.Itoa(i), time.Duration(11+i)*time.Second), 0.5, 99)
}

func demoGlancesMem(at time.Time) float64 {
	return demoClamp(47+4*demoWave(at, "mem-a", 3*time.Hour)+1.2*demoWave(at, "mem-b", 9*time.Minute), 20, 90)
}

func demoGlancesSwap(at time.Time) float64 {
	return demoClamp(2.5+0.8*demoWave(at, "swap", 5*time.Hour), 0, 50)
}

func demoGlancesTotals() (mem, swap float64) { return 32 << 30, 8 << 30 }

func demoGlancesLoad(at time.Time) (l1, l5, l15 float64) {
	cpu := demoGlancesCPU(at)
	l1 = cpu / 100 * demoGlancesCores * 1.1
	l5 = l1*0.8 + 0.1*demoGlancesCores*demoClamp(demoWave(at, "l5", 2*time.Hour)+1, 0, 2)/2
	l15 = (l1 + l5) / 2.2
	return
}

// demoGlancesNet is the rate in and out of eth0 in bytes a second: a trickle
// with streams on top.
func demoGlancesNet(at time.Time) (rx, tx float64) {
	stream := math.Max(0, demoWave(at, "stream", 47*time.Minute)) * 6e6
	rx = 140e3 + 90e3*(1+demoWave(at, "rx", 3*time.Minute)) + math.Max(0, demoWave(at, "dl", 19*time.Minute)-0.4)*9e6
	tx = 60e3 + 40e3*(1+demoWave(at, "tx", 5*time.Minute)) + stream
	return math.Max(rx, 1e3), math.Max(tx, 1e3)
}

var demoGlancesDisks = []struct {
	Name, Mount string
	Size        float64 // bytes
	Percent     float64 // at the anchor
	Fill        float64 // percent a day
	Spin        bool    // an array disk, busy only now and then
}{
	{"nvme0n1p1", "/mnt/cache", 1e12, 41, 0.35, false},
	{"sdb1", "/mnt/disk1", 8e12, 71, 0.12, true},
	{"sdc1", "/mnt/disk2", 8e12, 64, 0.1, true},
	{"sdd1", "/mnt/disk3", 4e12, 83, 0.04, true},
}

func demoGlancesFSPercent(i int, at time.Time) float64 {
	d := demoGlancesDisks[i]
	days := float64(at.Sub(demoGlancesAnchorTime())) / float64(demoGlancesDay)
	return demoRound(demoClamp(d.Percent+d.Fill*days, 1, 99.5), 2)
}

// demoGlancesDiskRate is read and write in bytes a second for disk i.
func demoGlancesDiskRate(at time.Time, name string, spin bool) (read, write float64) {
	r := math.Max(0, demoWave(at, name+"r", 7*time.Minute)-0.2)
	w := math.Max(0, demoWave(at, name+"w", 11*time.Minute)-0.35)
	if spin {
		r, w = r*r*r, w*w
	}
	return r * 24e6, w * 6e6
}

func demoGlancesTemps(at time.Time) map[string]float64 {
	cpu := demoGlancesCPU(at)
	out := map[string]float64{
		"Package id 0":    41 + cpu*0.32 + 1.5*demoWave(at, "tp", 6*time.Minute),
		"nvme0 Composite": 38 + cpu*0.1 + 1.2*demoWave(at, "tn", 14*time.Minute),
	}
	for i, d := range []string{"sdb", "sdc", "sdd", "sde"} {
		out["/dev/"+d] = 33 + 1.2*float64(i) + 2*demoWave(at, d, 40*time.Minute) + math.Max(0, cpu-35)*0.05
	}
	return out
}

// demoGlancesReadings is one sampler beat's worth of series for a moment, with
// the names glancesSampleHost files them under.
func demoGlancesReadings(at time.Time) map[string]float64 {
	mem := demoGlancesMem(at)
	l1, l5, l15 := demoGlancesLoad(at)
	rx, tx := demoGlancesNet(at)
	used := mem - 11
	r := map[string]float64{
		"up": 1, "cpu": demoGlancesCPU(at), "mem": mem, "swap": demoGlancesSwap(at),
		"memc:used": used, "memc:free": 100 - mem,
		"load1": l1, "load5": l5, "load15": l15,
		"net:eth0:rx": rx, "net:eth0:tx": tx,
	}
	// The three parts of memory add up to a hundred.
	r["memc:cache"] = demoRound(100-r["memc:used"]-r["memc:free"], 2)
	for i := 0; i < demoGlancesCores; i++ {
		r["core:"+strconv.Itoa(i)] = demoGlancesCore(at, i)
	}
	for _, name := range []string{"nvme0n1", "sdb", "sdc", "sdd", "sde"} {
		rd, wr := demoGlancesDiskRate(at, name, name != "nvme0n1")
		r["disk:"+name+":read"], r["disk:"+name+":write"] = rd, wr
	}
	for label, v := range demoGlancesTemps(at) {
		r["temp:"+label] = v
	}
	for i, d := range demoGlancesDisks {
		r["fs:"+d.Mount] = demoGlancesFSPercent(i, at)
	}
	r["fs:/"] = 6.2
	return r
}

// ---- the answers ----

type demoRows = []map[string]any

var demoGlancesPlugins = []string{
	"alert", "containers", "core", "cpu", "diskio", "fs", "load", "mem", "memswap", "network",
	"percpu", "processcount", "processlist", "quicklook", "sensors", "smart", "system", "uptime",
}

type demoProc struct {
	pid                 int
	name, user, cmdline string
	cpu, mem            float64
	threads             int
}

var demoGlancesProcs = []demoProc{
	{1180, "jellyfin", "root", "/usr/lib/jellyfin/bin/jellyfin --datadir /config", 3.5, 1.9, 38},
	{2041, "immich-server", "root", "node dist/main", 5.2, 2.9, 22},
	{1764, "qbittorrent-nox", "root", "/usr/bin/qbittorrent-nox --webui-port=8080", 1.8, 0.7, 21},
	{980, "dockerd", "root", "/usr/bin/dockerd -p /var/run/dockerd.pid", 1.1, 0.5, 44},
	{1011, "containerd", "root", "/usr/bin/containerd", 0.5, 0.3, 36},
	{1892, "postgres", "root", "postgres: immich immich 172.18.0.5(41234) idle", 1.2, 0.6, 1},
	{1530, "homeassistant", "root", "python3 -m homeassistant --config /config", 2.7, 1.4, 28},
	{610, "shfs", "root", "/usr/local/bin/shfs /mnt/user -disks 15 -o default_permissions", 0.9, 0.2, 18},
	{702, "smbd", "root", "/usr/sbin/smbd -D", 0.4, 0.3, 1},
	{1604, "sonarr", "root", "/app/sonarr/bin/Sonarr -nobrowser -data=/config", 0.7, 0.9, 25},
	{1633, "radarr", "root", "/app/radarr/bin/Radarr -nobrowser -data=/config", 0.5, 0.9, 24},
	{1672, "prowlarr", "root", "/app/prowlarr/bin/Prowlarr -nobrowser -data=/config", 0.3, 0.5, 20},
	{1744, "uptime-kuma", "root", "node server/server.js", 0.8, 0.4, 11},
	{1810, "pihole-FTL", "root", "pihole-FTL -f", 0.3, 0.2, 8},
	{1825, "traefik", "root", "traefik --configFile=/etc/traefik/traefik.yml", 0.5, 0.2, 14},
	{1851, "vaultwarden", "root", "/vaultwarden", 0.1, 0.1, 6},
	{1902, "nextdash", "root", "/app/nextDash", 0.2, 0.1, 9},
	{540, "nginx", "root", "nginx: master process /usr/sbin/nginx", 0.1, 0.1, 1},
	{561, "emhttpd", "root", "/usr/local/bin/emhttpd", 0.3, 0.1, 5},
	{398, "sshd", "root", "/usr/sbin/sshd -D", 0.0, 0.0, 1},
	{1, "init", "root", "/sbin/init", 0.0, 0.0, 1},
}

var demoGlancesContainerList = []struct {
	Name, Image, Status string
	CPU, MemMB, Rx, Tx  float64
	Days                int
}{
	{"jellyfin", "jellyfin/jellyfin:10.10", "running", 3.5, 612, 2e5, 4.6e6, 21},
	{"sonarr", "lscr.io/linuxserver/sonarr:4", "running", 0.8, 287, 2.1e4, 1.4e4, 21},
	{"radarr", "lscr.io/linuxserver/radarr:5", "running", 0.6, 301, 1.9e4, 1.2e4, 21},
	{"prowlarr", "lscr.io/linuxserver/prowlarr:1", "running", 0.3, 164, 9e3, 6e3, 21},
	{"qbittorrent", "lscr.io/linuxserver/qbittorrent:5", "running", 1.8, 233, 4.4e6, 7.5e5, 14},
	{"bazarr", "lscr.io/linuxserver/bazarr:1", "exited", 0, 0, 0, 0, 0},
	{"immich-server", "ghcr.io/immich-app/immich-server:v1.120", "running", 5.2, 948, 6e4, 2.2e5, 9},
	{"immich-postgres", "tensorchord/pgvecto-rs:pg16-v0.2", "running", 1.2, 210, 3e4, 4e4, 9},
	{"vaultwarden", "vaultwarden/server:1.32", "running", 0.1, 38, 1e3, 2e3, 45},
	{"uptime-kuma", "louislam/uptime-kuma:1", "running", 0.8, 121, 8e3, 5e3, 60},
	{"homeassistant", "ghcr.io/home-assistant/home-assistant:2024.12", "running", 2.7, 455, 3e4, 1.5e4, 3},
	{"pihole", "pihole/pihole:2024.07", "running", 0.3, 86, 2e4, 3e4, 60},
	{"traefik", "traefik:v3.2", "running", 0.5, 74, 4e4, 4.5e4, 2},
	{"nextdash", "ghcr.io/jordibrouwer/nextdash:latest", "running", 0.2, 29, 2e3, 6e3, 1},
}

func demoDays(n int) string {
	if n <= 0 {
		return ""
	}
	if n == 1 {
		return "1 day"
	}
	return strconv.Itoa(n) + " days"
}

// demoGlancesAnswer is what the host would say to one path ("quicklook",
// "processlist/top/300", ...), or errGlancesNotFound for a plugin that is off.
func demoGlancesAnswer(path string, at time.Time) ([]byte, error) {
	path = strings.TrimPrefix(path, "/")
	num := func(v float64) float64 { return demoRound(v, 1) }
	var out any
	switch {
	case path == "status":
		out = map[string]string{"version": "4.3.1"}
	case path == "pluginslist":
		out = demoGlancesPlugins
	case path == "quicklook":
		cores := make(demoRows, demoGlancesCores)
		for i := range cores {
			c := demoGlancesCore(at, i)
			cores[i] = map[string]any{"cpu_number": i, "total": num(c), "user": num(c * 0.7), "system": num(c * 0.25), "idle": num(100 - c)}
		}
		out = map[string]any{
			"cpu": num(demoGlancesCPU(at)), "mem": num(demoGlancesMem(at)), "swap": num(demoGlancesSwap(at)),
			"cpu_name": "Intel(R) Core(TM) i5-12400", "cpu_hz_current": 2.5e9 + 1.2e9*demoGlancesCPU(at)/100, "cpu_hz": 4.4e9, "percpu": cores,
		}
	case path == "cpu":
		c := demoGlancesCPU(at)
		out = map[string]any{"total": num(c), "user": num(c * 0.7), "system": num(c * 0.25), "idle": num(100 - c), "iowait": num(c * 0.05), "steal": 0, "cpucore": demoGlancesCores}
	case path == "core":
		out = map[string]int{"phys": 6, "log": demoGlancesCores}
	case path == "percpu":
		rows := make(demoRows, demoGlancesCores)
		for i := range rows {
			rows[i] = map[string]any{"cpu_number": i, "total": num(demoGlancesCore(at, i))}
		}
		out = rows
	case path == "mem":
		total, _ := demoGlancesTotals()
		pct := demoGlancesMem(at)
		used := total * pct / 100
		out = map[string]any{
			"total": total, "percent": num(pct), "used": used, "free": total - used, "available": total - used + total*0.11,
			"cached": total * 0.11, "buffers": total * 0.01,
		}
	case path == "memswap":
		_, total := demoGlancesTotals()
		pct := demoGlancesSwap(at)
		out = map[string]any{"total": total, "percent": num(pct), "used": total * pct / 100, "free": total * (100 - pct) / 100}
	case path == "load":
		l1, l5, l15 := demoGlancesLoad(at)
		out = map[string]any{"min1": demoRound(l1, 2), "min5": demoRound(l5, 2), "min15": demoRound(l15, 2), "cpucore": demoGlancesCores}
	case path == "fs":
		rows := demoRows{{"device_name": "/dev/loop2", "fs_type": "ext4", "mnt_point": "/", "size": 3.2e10, "used": 2e9, "free": 3e10, "percent": 6.2}}
		for i, d := range demoGlancesDisks {
			p := demoGlancesFSPercent(i, at)
			rows = append(rows, map[string]any{
				"device_name": "/dev/" + d.Name, "fs_type": "xfs", "mnt_point": d.Mount,
				"size": d.Size, "used": d.Size * p / 100, "free": d.Size * (100 - p) / 100, "percent": p,
			})
		}
		out = rows
	case path == "diskio":
		rows := demoRows{}
		for _, name := range []string{"nvme0n1", "sdb", "sdc", "sdd", "sde"} {
			rd, wr := demoGlancesDiskRate(at, name, name != "nvme0n1")
			rows = append(rows, map[string]any{
				"disk_name": name, "read_bytes_rate_per_sec": rd, "write_bytes_rate_per_sec": wr,
				"read_bytes": rd * 3600 * 24, "write_bytes": wr * 3600 * 24, "read_count": 1, "write_count": 1,
			})
		}
		out = rows
	case path == "network":
		rx, tx := demoGlancesNet(at)
		up := true
		out = demoRows{
			{"interface_name": "eth0", "is_up": up, "speed": 1000, "bytes_recv_rate_per_sec": rx, "bytes_sent_rate_per_sec": tx,
				"bytes_recv": rx * 86400 * 12, "bytes_sent": tx * 86400 * 12, "bytes_all_rate_per_sec": rx + tx},
			{"interface_name": "docker0", "is_up": up, "speed": 0, "bytes_recv_rate_per_sec": rx / 8, "bytes_sent_rate_per_sec": tx / 8},
		}
	case path == "sensors":
		temps := demoGlancesTemps(at)
		rows := demoRows{}
		for _, label := range []string{"Package id 0", "nvme0 Composite", "/dev/sdb", "/dev/sdc", "/dev/sdd", "/dev/sde"} {
			warn, crit, kind := 45.0, 55.0, "temperature_hdd"
			if label == "Package id 0" {
				warn, crit, kind = 80, 100, "temperature_core"
			} else if strings.HasPrefix(label, "nvme") {
				warn, crit, kind = 70, 85, "temperature_core"
			}
			rows = append(rows, map[string]any{"label": label, "value": num(temps[label]), "warning": warn, "critical": crit, "unit": "C", "type": kind})
		}
		out = rows
	case path == "system":
		out = map[string]string{
			"hostname": demoGlancesName, "os_name": "Linux", "os_version": "6.6.78-Unraid", "platform": "64bit",
			"linux_distro": "Slackware 15.0", "hr_name": "Slackware 15.0 / Linux 6.6.78-Unraid",
		}
	case path == "uptime":
		d := at.Sub(demoGlancesAnchorTime().Add(-12 * demoGlancesDay))
		out = fmt.Sprintf("%d days, %d:%02d:%02d", int(d.Hours())/24, int(d.Hours())%24, int(d.Minutes())%60, int(d.Seconds())%60)
	case path == "processcount":
		out = map[string]int{"total": 312, "running": 2, "sleeping": 268, "thread": 1340, "pid_max": 0}
	case path == "processlist" || strings.HasPrefix(path, "processlist/top/"):
		rows := make(demoRows, 0, len(demoGlancesProcs))
		for i, p := range demoGlancesProcs {
			cpu := math.Max(0, p.cpu*(1+0.5*demoWave(at, p.name, time.Duration(20+i)*time.Second)))
			rss := p.mem / 100 * 32 * (1 << 30)
			rows = append(rows, map[string]any{
				"pid": p.pid, "name": p.name, "username": p.user, "cpu_percent": num(cpu), "memory_percent": demoRound(p.mem, 2),
				"memory_info": map[string]any{"rss": rss, "vms": rss * 2.4}, "status": "S", "nice": 0, "num_threads": p.threads,
				"cmdline": strings.Fields(p.cmdline),
			})
		}
		out = rows
	case path == "containers":
		rows := make(demoRows, 0, len(demoGlancesContainerList))
		for i, c := range demoGlancesContainerList {
			cpu := math.Max(0, c.CPU*(1+0.45*demoWave(at, c.Name, time.Duration(17+i)*time.Second)))
			rx := c.Rx * (1 + 0.4*demoWave(at, c.Name+"rx", time.Minute))
			tx := c.Tx * (1 + 0.4*demoWave(at, c.Name+"tx", 80*time.Second))
			row := map[string]any{
				"name": c.Name, "id": fmt.Sprintf("%012x", 0xa1b2c3d4e5f6+i*7919), "image": []string{c.Image}, "status": c.Status,
				"uptime": demoDays(c.Days), "command": "/init", "engine": "docker",
				"cpu_percent": num(cpu), "memory_usage": c.MemMB * (1 << 20), "memory_limit": 32.0 * (1 << 30),
				"network_rx": rx, "network_tx": tx, "network": map[string]any{"rx": rx, "tx": tx},
			}
			if c.Status != "running" {
				row["cpu_percent"], row["memory_usage"] = nil, nil
				delete(row, "network_rx")
				delete(row, "network_tx")
				delete(row, "network")
			}
			rows = append(rows, row)
		}
		out = rows
	case path == "alert":
		out = demoRows{}
	case path == "smart":
		drive := func(name, model string, hours, temp int) map[string]any {
			return map[string]any{
				"DeviceName": name, "Device Model": model,
				"5":   map[string]any{"name": "Reallocated_Sector_Ct", "value": 100, "worst": 100, "threshold": 10, "raw": "0"},
				"9":   map[string]any{"name": "Power_On_Hours", "value": 90, "worst": 90, "threshold": 0, "raw": strconv.Itoa(hours)},
				"194": map[string]any{"name": "Temperature_Celsius", "value": 100 - temp, "worst": 90, "threshold": 0, "raw": strconv.Itoa(temp)},
				"197": map[string]any{"name": "Current_Pending_Sector", "value": 100, "worst": 100, "threshold": 0, "raw": "0"},
			}
		}
		out = []map[string]any{
			drive("sdb", "WDC WD80EFAX-68LHPN0", 31204, 34),
			drive("sdc", "WDC WD80EFAX-68LHPN0", 30911, 35),
			drive("sdd", "ST4000VN006-3CW104", 18460, 36),
		}
	case path == "all/limits":
		out = map[string]any{
			"cpu": map[string]float64{"cpu_total_careful": 50, "cpu_total_warning": 70, "cpu_total_critical": 90},
			"mem": map[string]float64{"mem_careful": 50, "mem_warning": 70, "mem_critical": 90},
			"fs":  map[string]float64{"fs_careful": 50, "fs_warning": 70, "fs_critical": 90},
		}
	default:
		return nil, errGlancesNotFound
	}
	return json.Marshal(out)
}

// ---- the seed ----

/*
seedDemoGlances sets Tower up and gives it a week behind it: the config, the
history the graphs and Insights read, and two incidents in the log. Called
after every reset, with the data directory empty.
*/
func (h *Handlers) seedDemoGlances(now time.Time) error {
	demoGlancesAnchor.Store(now.UnixMilli())
	cfg := defaultGlancesConfig()
	cfg.ID, cfg.Name, cfg.Enabled, cfg.Server = glancesMainID, demoGlancesName, true, demoGlancesServer
	cfg.DockerLink = glancesLinkNo
	saved, err := saveGlancesConfig(cfg, nil)
	if err != nil {
		return err
	}

	hs := glancesHostByID(saved.ID)
	hs.wipe()
	hs.applyRetention(saved)
	hs.setBeat(saved.recordInterval())

	// Seven days at the coarse pace, then the last quarter of an hour at the
	// sampler's own, so the one-minute traces start full.
	fine := now.Add(-time.Duration(glancesFineKeep) * glancesSampleEvery)
	for at := now.Add(-7 * demoGlancesDay).Truncate(glancesCoarseDuration()); at.Before(fine); at = at.Add(glancesCoarseDuration()) {
		hs.record(at.UnixMilli(), demoGlancesReadings(at))
	}
	for at := fine; at.Before(now); at = at.Add(glancesSampleEvery) {
		hs.record(at.UnixMilli(), demoGlancesReadings(at))
	}

	// The parity check's burst last night, and a warm afternoon two days ago.
	day := now.UTC().Truncate(demoGlancesDay)
	incident := func(kind, subject string, start time.Time, length time.Duration, peak float64) {
		beat := saved.recordInterval()
		for at := start; at.Before(start.Add(length)); at = at.Add(beat) {
			hs.observe(at.UnixMilli(), []glancesObservation{{Kind: kind, Subject: subject, Value: peak, Bad: true}})
		}
		for i := 0; i < 3; i++ {
			at := start.Add(length + time.Duration(i)*beat)
			hs.observe(at.UnixMilli(), []glancesObservation{{Kind: kind, Subject: subject, Value: 20}})
		}
	}
	nightly := day.Add(3 * time.Hour)
	if nightly.After(now.Add(-time.Hour)) {
		nightly = nightly.Add(-demoGlancesDay)
	}
	incident("cpu", "", nightly, 14*time.Minute, 94.2)
	incident("temp", "/dev/sdd", day.Add(-2*demoGlancesDay).Add(15*time.Hour), 40*time.Minute, 58)

	hs.setState(now.UnixMilli(), true, "ok", "")
	hs.saveHistory()
	glancesViewForgetAll()
	glancesInsightsCache.Lock()
	glancesInsightsCache.entries = map[string]glancesInsightsEntry{}
	glancesInsightsCache.Unlock()
	glancesWakeSampler()
	return nil
}

func glancesCoarseDuration() time.Duration { return time.Duration(glancesCoarseMs) * time.Millisecond }
