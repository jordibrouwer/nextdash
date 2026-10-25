package app

import "time"

/*
The demo's inbox as it looks after a few weeks of use: a couple of links from
the last hours, a handful from the days before, older ones already read, a few
snoozed until later, and some with a note or a tag. Seeded relative to the
reset, like the rest of the demo.
*/

type demoInboxEntry struct {
	url, title, desc string
	hoursAgo         float64
	read             bool    // opened and read, a few hours after it arrived
	snoozeHours      float64 // snoozed until this many hours from now; 0 for not snoozed
	note             string
	tags             []string
}

var demoInboxEntries = []demoInboxEntry{
	{url: "https://tailscale.com/kb/", title: "Tailscale knowledge base", desc: "Articles on subnet routers, exit nodes, ACLs and every platform.", hoursAgo: 0.4},
	{url: "https://docs.docker.com/compose/", title: "Docker Compose", desc: "Define and run multi-container applications from one file.", hoursAgo: 1.5, tags: []string{"docker"}},
	{url: "https://jellyfin.org/docs/", title: "Jellyfin documentation", desc: "Install, configure and extend the media server.", hoursAgo: 3},
	{url: "https://www.home-assistant.io/blog/", title: "Home Assistant blog", desc: "Release notes, community highlights and what is coming next.", hoursAgo: 5},
	{url: "https://github.com/awesome-selfhosted/awesome-selfhosted", title: "Awesome self-hosted", desc: "A list of free software network services and web applications you can host yourself.", hoursAgo: 26},
	{url: "https://restic.net/", title: "restic: backups done right", desc: "A fast, secure backup program with deduplication and many storage backends.", hoursAgo: 30, tags: []string{"backup"}, note: "Compare with borg for the NAS"},
	{url: "https://www.brendangregg.com/linuxperf.html", title: "Linux performance", desc: "Tools, tracing and flame graphs for finding where a Linux machine spends its time.", hoursAgo: 52, tags: []string{"linux"}, note: "Flame graphs for the NAS?"},
	{url: "https://wiki.archlinux.org/title/Systemd", title: "systemd - ArchWiki", desc: "Units, targets, timers and journal: the init system explained in practice.", hoursAgo: 76, tags: []string{"linux"}},
	{url: "https://owasp.org/www-project-top-ten/", title: "OWASP Top Ten", desc: "The most critical security risks to web applications, with how to prevent them.", hoursAgo: 100, tags: []string{"security"}},
	{url: "https://caddyserver.com/docs/caddyfile", title: "Caddyfile concepts", desc: "How the Caddyfile is structured: sites, matchers, directives and snippets.", hoursAgo: 140, tags: []string{"proxy"}, snoozeHours: 46},
	{url: "https://book.hacktricks.xyz/", title: "HackTricks", desc: "A wiki of pentesting techniques, tools and checklists.", hoursAgo: 170, tags: []string{"security"}, snoozeHours: 170},
	{url: "https://borgbackup.readthedocs.io/en/stable/", title: "Borg documentation", desc: "Deduplicating backups with compression and authenticated encryption.", hoursAgo: 200, tags: []string{"backup"}},
	{url: "https://immich.app/docs/overview/introduction", title: "Immich documentation", desc: "Self-hosted photo and video management: setup, mobile apps and storage.", hoursAgo: 260, read: true, tags: []string{"photos"}},
	{url: "https://hub.docker.com/_/postgres", title: "postgres - Official Image", desc: "Tags, environment variables and volumes for the official PostgreSQL image.", hoursAgo: 330, read: true, tags: []string{"docker"}},
	{url: "https://github.com/louislam/uptime-kuma/wiki", title: "Uptime Kuma wiki", desc: "Monitor types, notifications and status pages for Uptime Kuma.", hoursAgo: 400, read: true},
	{url: "https://crontab.guru/examples.html", title: "Crontab examples", desc: "Common cron schedules with a plain-language reading of each.", hoursAgo: 470, read: true},
	{url: "https://www.wireshark.org/docs/", title: "Wireshark documentation", desc: "User guide, display filters and the developer's guide.", hoursAgo: 520, read: true, snoozeHours: 20},
	{url: "https://selfh.st/weekly/", title: "selfh.st weekly", desc: "A weekly newsletter on self-hosting: new apps, updates and guides.", hoursAgo: 640, read: true},
	{url: "https://www.proxmox.com/en/downloads", title: "Proxmox downloads", desc: "ISO images, appliances and documentation for Proxmox VE and Backup Server.", hoursAgo: 760, read: true},
	{url: "https://ubuntu.com/server/docs", title: "Ubuntu Server documentation", desc: "Installation, networking, storage and security for Ubuntu Server.", hoursAgo: 900, read: true},
	{url: "https://www.kernel.org/doc/html/latest/", title: "The Linux kernel documentation", desc: "Admin guide, driver API and subsystem documentation for the kernel.", hoursAgo: 1000, read: true},
}

// demoInboxLinks are the links the demo's inbox holds, oldest first, with their
// times counted back from now.
func demoInboxLinks(now time.Time) []InboxLink {
	links := make([]InboxLink, 0, len(demoInboxEntries))
	for i := len(demoInboxEntries) - 1; i >= 0; i-- {
		e := demoInboxEntries[i]
		added := now.Add(-time.Duration(e.hoursAgo * float64(time.Hour)))
		link := InboxLink{
			URL: e.url, Title: e.title, PreviewTitle: e.title, PreviewDesc: e.desc,
			AddedAt: added.UnixMilli(), Tags: e.tags, Note: e.note,
		}
		if e.read {
			link.ReadAt = added.Add(time.Duration(2+i%5) * time.Hour).UnixMilli()
		}
		if e.snoozeHours > 0 {
			link.SnoozedUntil = now.Add(time.Duration(e.snoozeHours * float64(time.Hour))).UnixMilli()
		}
		links = append(links, link)
	}
	return links
}
