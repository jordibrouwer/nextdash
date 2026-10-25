package app

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// demoPreviews is the title and line each demo bookmark carries itself, so
// the Bookmarks view reads well before, or without, the fetched previews.
var demoPreviews = map[string][2]string{
	"https://github.com/":                        {"GitHub", "Where the world builds software: code hosting, pull requests, issues and Actions."},
	"https://gitlab.com/":                        {"GitLab", "One application for source code, CI/CD, issues and the rest of the DevSecOps cycle."},
	"https://codeberg.org/":                      {"Codeberg", "A non-profit, community-led home for free and open-source projects, running Forgejo."},
	"https://stackoverflow.com/":                 {"Stack Overflow", "Questions and answers for programmers, with an answer for nearly every error message."},
	"https://developer.mozilla.org/":             {"MDN Web Docs", "Documentation for HTML, CSS, JavaScript and the web platform's APIs."},
	"https://go.dev/doc/":                        {"Documentation - The Go Programming Language", "Tutorials, the language spec, Effective Go and the standard library."},
	"https://doc.rust-lang.org/book/":            {"The Rust Programming Language", "The official book: ownership, borrowing, traits and fearless concurrency."},
	"https://docs.python.org/3/":                 {"Python 3 documentation", "The tutorial, the library reference and the language reference."},
	"https://nodejs.org/docs/latest/api/":        {"Node.js Documentation", "The API reference for the latest Node.js release, module by module."},
	"https://devdocs.io/":                        {"DevDocs API Documentation", "Many API references in one fast, searchable interface that also works offline."},
	"https://regex101.com/":                      {"regex101: build, test, and debug regex", "Test regular expressions with an explanation of every token and live matches."},
	"https://caniuse.com/":                       {"Can I use... Support tables for HTML5, CSS3, etc", "Which browsers support which web features, version by version."},
	"https://crontab.guru/":                      {"Crontab.guru - The cron schedule expression editor", "Type a cron expression and read in plain words when it will run."},
	"https://excalidraw.com/":                    {"Excalidraw", "A virtual whiteboard for sketching hand-drawn-looking diagrams."},
	"https://jwt.io/":                            {"JSON Web Tokens - jwt.io", "Decode, verify and generate JSON Web Tokens in the browser."},
	"https://news.ycombinator.com/":              {"Hacker News", "Links and discussion about programming, startups and whatever gratifies curiosity."},
	"https://lobste.rs/":                         {"Lobsters", "A computing-focused link aggregation community with tags and invitations."},
	"https://dev.to/":                            {"DEV Community", "Articles and discussion by and for software developers."},
	"https://changelog.com/":                     {"Changelog", "News and podcasts for developers about software and open source."},
	"https://pve.proxmox.com/wiki/Main_Page":     {"Proxmox VE wiki", "Documentation for Proxmox Virtual Environment: VMs, containers, storage and clusters."},
	"https://www.truenas.com/docs/":              {"TrueNAS Documentation Hub", "Guides and references for TrueNAS SCALE and CORE."},
	"https://docs.unraid.net/":                   {"Unraid Docs", "Documentation for the Unraid OS: the array, shares, Docker and VMs."},
	"https://docs.docker.com/":                   {"Docker Docs", "Guides and references for Docker Engine, Compose and Build."},
	"https://hub.docker.com/":                    {"Docker Hub Container Image Library", "Find and share container images for apps, databases and base systems."},
	"https://docs.opnsense.org/":                 {"OPNsense documentation", "Manuals for the open-source firewall and routing platform."},
	"https://tailscale.com/":                     {"Tailscale", "A WireGuard-based mesh VPN that connects your devices wherever they are."},
	"https://www.wireguard.com/":                 {"WireGuard: fast, modern, secure VPN tunnel", "A simple VPN that lives in the kernel and uses modern cryptography."},
	"https://docs.pi-hole.net/":                  {"Pi-hole documentation", "Network-wide ad blocking through your own DNS server."},
	"https://www.home-assistant.io/":             {"Home Assistant", "Open-source home automation that puts local control and privacy first."},
	"https://esphome.io/":                        {"ESPHome", "Control ESP32 and ESP8266 boards with simple configuration files."},
	"https://www.zigbee2mqtt.io/":                {"Zigbee2MQTT", "Use Zigbee devices without the vendor's bridge or gateway."},
	"https://www.servethehome.com/":              {"ServeTheHome", "Server, storage and networking reviews for the homelab and beyond."},
	"https://www.reddit.com/r/homelab/":          {"r/homelab", "Show off your rack, ask about hardware, and learn from other homelabbers."},
	"https://awesome-selfhosted.net/":            {"awesome-selfhosted", "A list of free software network services and web applications you can host yourself."},
	"https://selfh.st/":                          {"selfh.st", "Self-hosting news, a weekly newsletter and a directory of apps."},
	"https://www.reddit.com/r/selfhosted/":       {"r/selfhosted", "A place to share, discuss and find alternatives to hosted services."},
	"https://www.linuxserver.io/":                {"LinuxServer.io", "Container images for popular self-hosted apps, kept up to date."},
	"https://nextdash.cc/":                       {"nextDash", "A self-hosted, keyboard-first dashboard for your bookmarks and services."},
	"https://jellyfin.org/":                      {"Jellyfin", "The free software media system: your movies, shows and music, streamed by you."},
	"https://immich.app/":                        {"Immich", "Self-hosted photo and video backup with a familiar timeline and mobile apps."},
	"https://nextcloud.com/":                     {"Nextcloud", "Files, calendar, contacts and office on a server you control."},
	"https://github.com/dani-garcia/vaultwarden": {"Vaultwarden", "A lightweight Bitwarden-compatible password manager server written in Rust."},
	"https://docs.paperless-ngx.com/":            {"Paperless-ngx", "Scan, index and archive your paper documents with full-text search."},
	"https://github.com/louislam/uptime-kuma":    {"Uptime Kuma", "A self-hosted monitoring tool with status pages and notifications."},
	"https://doc.traefik.io/traefik/":            {"Traefik Proxy Documentation", "A reverse proxy that configures itself from Docker labels and other providers."},
	"https://caddyserver.com/docs/":              {"Caddy Documentation", "The web server with automatic HTTPS and a one-line config for most sites."},
	"https://letsencrypt.org/docs/":              {"Let's Encrypt Documentation", "Free, automated TLS certificates, and how ACME clients get them."},
	"https://www.exploit-db.com/":                {"Exploit Database", "An archive of public exploits and the vulnerable software they target."},
	"https://www.hackthebox.com/":                {"Hack The Box", "Hands-on labs and challenges for learning offensive and defensive security."},
	"https://tryhackme.com/":                     {"TryHackMe", "Guided security rooms that run in the browser, from first steps to red teaming."},
	"https://owasp.org/":                         {"OWASP Foundation", "Open standards, guides and tools for building and testing secure software."},
	"https://portswigger.net/web-security":       {"Web Security Academy", "Free, practical training on web vulnerabilities, with labs to break."},
	"https://gchq.github.io/CyberChef/":          {"CyberChef", "The cyber Swiss Army knife: encode, decode, hash and analyse data in the browser."},
	"https://www.shodan.io/":                     {"Shodan", "A search engine for the devices and services connected to the internet."},
	"https://haveibeenpwned.com/":                {"Have I Been Pwned", "Check whether an address or password turned up in a known data breach."},
	"https://www.cve.org/":                       {"CVE Program", "The common identifiers that name publicly known security vulnerabilities."},
	"https://nmap.org/":                          {"Nmap", "The network scanner for discovering hosts, ports and services."},
	"https://www.wireshark.org/":                 {"Wireshark", "The network protocol analyser: capture traffic and read it packet by packet."},
	"https://www.kali.org/":                      {"Kali Linux", "A Debian-based distribution packed with penetration-testing tools."},
	"https://wiki.archlinux.org/":                {"ArchWiki", "Detailed, well-kept documentation that helps on almost any Linux distribution."},
	"https://www.kernel.org/":                    {"The Linux Kernel Archives", "Releases, patches and source of the Linux kernel."},
	"https://explainshell.com/":                  {"explainshell", "Paste a shell command and see what each part and flag means."},
	"https://tldr.sh/":                           {"tldr pages", "Community-written command-line help with short, practical examples."},
	"https://search.nixos.org/packages":          {"NixOS Search", "Search the packages and options of the Nix ecosystem."},
	"https://lwn.net/":                           {"LWN.net", "In-depth news and analysis on Linux and free software development."},
	"https://www.phoronix.com/":                  {"Phoronix", "Linux hardware reviews, benchmarks and news about open-source graphics."},
	"https://www.debian.org/":                    {"Debian", "The universal operating system, built by a community of volunteers."},
	"https://www.linuxfromscratch.org/":          {"Linux From Scratch", "Build your own Linux system from source, step by step."},
	"https://www.shellcheck.net/":                {"ShellCheck", "A static analysis tool that finds bugs and pitfalls in shell scripts."},
	"https://adventofcode.com/":                  {"Advent of Code", "A calendar of small programming puzzles for every December day."},
	"https://projecteuler.net/":                  {"Project Euler", "Mathematical and computational problems that reward clever programs."},
	"https://exercism.org/":                      {"Exercism", "Free coding exercises in dozens of languages, with mentoring."},
	"https://godbolt.org/":                       {"Compiler Explorer", "See the assembly your compiler produces, live, for many languages."},
	"https://www.shadertoy.com/":                 {"Shadertoy", "Write and share GLSL shaders that run in the browser."},
	"https://xkcd.com/":                          {"xkcd", "A webcomic of romance, sarcasm, math and language."},
	"https://picoctf.org/":                       {"picoCTF", "A free capture-the-flag game for learning security skills."},
	"https://ctftime.org/":                       {"CTFtime", "A calendar and scoreboard for capture-the-flag competitions."},
	"https://www.raspberrypi.com/":               {"Raspberry Pi", "Small, affordable computers and the software that runs on them."},
	"https://www.adafruit.com/":                  {"Adafruit Industries", "Parts, boards and tutorials for makers and electronics learners."},
	"https://www.sparkfun.com/":                  {"SparkFun Electronics", "Sensors, microcontrollers and guides for electronics projects."},
	"https://wokwi.com/":                         {"Wokwi", "Simulate Arduino, ESP32 and Raspberry Pi Pico projects in the browser."},
	"https://flipperzero.one/":                   {"Flipper Zero", "A portable multi-tool for hardware and radio hacking, in a pocket-sized case."},
	"https://hackaday.com/":                      {"Hackaday", "Hardware hacks, projects and tinkering from around the world."},
	"https://www.hackster.io/":                   {"Hackster.io", "A community for sharing hardware projects with build guides."},
	"https://pine64.org/":                        {"PINE64", "Open hardware: single-board computers, phones and laptops that run Linux."},
	"https://frame.work/":                        {"Framework", "Laptops you can upgrade, repair and customise yourself."},
	"https://openwrt.org/":                       {"OpenWrt", "A Linux distribution for routers, with a full package system."},
	"https://www.privacyguides.org/":             {"Privacy Guides", "Plain-language advice on tools and settings that protect your privacy."},
	"https://www.eff.org/":                       {"Electronic Frontier Foundation", "Defending civil liberties in the digital world."},
	"https://signal.org/":                        {"Signal", "A private messenger with end-to-end encryption by default."},
	"https://www.torproject.org/":                {"Tor Project", "The anonymity network and browser that hide where you connect from."},
	"https://mullvad.net/":                       {"Mullvad VPN", "A VPN that asks for no account details and keeps no logs."},
	"https://bitwarden.com/":                     {"Bitwarden", "An open-source password manager for every device."},
	"https://www.yubico.com/":                    {"Yubico", "Hardware security keys for phishing-resistant sign-in."},
	"https://cryptpad.org/":                      {"CryptPad", "End-to-end encrypted office tools you can use together."},
	"https://krebsonsecurity.com/":               {"Krebs on Security", "In-depth reporting on cybercrime and security."},
	"https://www.schneier.com/":                  {"Schneier on Security", "A blog on security, privacy and the people behind them."},
}

/*
demoPreviewCache keeps the link previews fetched at the first start, pictures
included, so every reset puts the preview cards back without asking the sites
again.
*/
var demoPreviewCache struct {
	sync.Mutex
	ready   bool
	entries map[string]BookmarkPreview // canonical URL -> preview
	files   map[string][]byte          // file name under preview-images -> bytes
}

// fetchDemoPreviews fetches every demo bookmark's preview and its pictures,
// a few sites at a time, and keeps them. Runs inside the start-up window.
func (h *Handlers) fetchDemoPreviews() {
	urls := []string{}
	for _, page := range demoPages() {
		for _, link := range page.links {
			urls = append(urls, link.url)
		}
	}
	jobs := make(chan string)
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for rawURL := range jobs {
				h.fetchDemoPreview(rawURL)
			}
		}()
	}
	for _, rawURL := range urls {
		jobs <- rawURL
	}
	close(jobs)
	wg.Wait()

	entries := map[string]BookmarkPreview{}
	files := map[string][]byte{}
	dir := previewImageDir()
	for _, rawURL := range urls {
		key := canonicalBookmarkURLKey(rawURL)
		entry, ok := h.storedPreview(key)
		if !ok || !previewCacheEntryValid(entry) {
			continue
		}
		for _, local := range []string{entry.Image, entry.Icon} {
			name := strings.TrimPrefix(local, "/data/"+previewImageDirName+"/")
			if name == local || name == "" || strings.ContainsAny(name, "/\\") {
				continue
			}
			if data, err := os.ReadFile(filepath.Join(dir, name)); err == nil {
				files[name] = data
			}
		}
		entries[key] = entry
	}
	demoPreviewCache.Lock()
	demoPreviewCache.entries, demoPreviewCache.files, demoPreviewCache.ready = entries, files, true
	demoPreviewCache.Unlock()
	logInfo(logComponentServer, "demo: kept %s for every reset", plural(len(entries), "link preview", "link previews"))
}

// fetchDemoPreview fetches one page's preview and, at once rather than through
// the background queue, its picture and icon. A second try covers a request the
// shared limit refused between the wait and the fetch.
func (h *Handlers) fetchDemoPreview(rawURL string) {
	key := canonicalBookmarkURLKey(rawURL)
	var preview BookmarkPreview
	for attempt := 0; attempt < 2; attempt++ {
		waitForOutboundRoom()
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		preview = h.fetchBookmarkPreview(ctx, rawURL, &PreviewCacheFile{Cache: map[string]BookmarkPreview{}}, false)
		cancel()
		if preview.Title != "" || preview.Description != "" {
			break
		}
	}
	// A site that answered nothing useful keeps the bookmark's own text.
	if preview.Title == "" && preview.Description == "" {
		return
	}
	if err := h.mergePreviewCacheUpdates(map[string]BookmarkPreview{key: preview}); err != nil {
		return
	}
	waitForOutboundRoom()
	h.runPreviewMediaJob(previewMediaJob{key: key, entry: preview, wantImage: true, wantIcon: true})
}

/*
waitForOutboundRoom waits, for a while at most, until the shared outbound limit
has room. The favicon round just before spends most of a minute's worth, and a
refused request would leave the preview empty rather than late.
*/
func waitForOutboundRoom() {
	for i := 0; i < 60 && globalOutboundLimiter.saturated("global"); i++ {
		time.Sleep(2 * time.Second)
	}
}

/*
writeDemoPreviewCache puts the kept previews back after a reset, fresh, so
none ages into a refetch the demo would refuse. Before the first round is done
the cache is emptied instead, which also drops what visitors fetched.
*/
func (h *Handlers) writeDemoPreviewCache(now time.Time) {
	demoPreviewCache.Lock()
	entries, files, ready := demoPreviewCache.entries, demoPreviewCache.files, demoPreviewCache.ready
	demoPreviewCache.Unlock()
	cache := PreviewCacheFile{Cache: map[string]BookmarkPreview{}}
	if ready {
		dir := previewImageDir()
		_ = os.MkdirAll(dir, 0o755)
		for name, data := range files {
			_ = writeFileAtomic(filepath.Join(dir, name), data, 0o644)
		}
		for key, entry := range entries {
			entry.FetchedAt = now.UnixMilli()
			cache.Cache[key] = entry
		}
	}
	_ = h.replacePreviewCache(cache)
}
