package app

import "time"

/*
A fresh install has links in its Inbox, not only on its pages.

The Inbox is where a link waits to be judged, and an empty one on day one says
nothing about that: it is a view with a count of zero. Ten links to read, keep,
promote or throw away show what it is for, and give the first triage something
to triage.

None of them is on the starter pages: the Inbox is for what is not yet part of
the collection, so a link already on main would be a duplicate to decide about.
They are real, long-lived pages, with their preview text written here, so the
list reads well before any fetch and without the network.
*/

const defaultInboxSeedPrefix = "inl_starter"

type starterInboxLink struct {
	url, title, desc string
	tags             []string
}

// starterInboxLinks is the starter Inbox, in the order it is shown (newest first).
var starterInboxLinks = []starterInboxLink{
	{"https://caddyserver.com/docs/automatic-https", "Automatic HTTPS · Caddy Documentation",
		"How Caddy gets and renews certificates by itself, and what it needs from you to do it.", []string{"reverse-proxy", "homelab"}},
	{"https://healthchecks.io", "Healthchecks.io: cron job monitoring",
		"Get an alert when a scheduled job does not check in, instead of finding out when the backup is missing.", []string{"monitoring", "cron"}},
	{"https://restic.net", "restic: backups done right",
		"A fast, encrypted, deduplicating backup program, for a laptop or a server, to a disk or to the cloud.", []string{"backup", "self-hosted"}},
	{"https://syncthing.net", "Syncthing: continuous file synchronization",
		"Keeps folders in step between your own devices, without a server in the middle.", []string{"self-hosted", "sync"}},
	{"https://docs.paperless-ngx.com", "Paperless-ngx documentation",
		"A document archive for scans and PDFs: it reads them, tags them, and finds them again.", []string{"self-hosted", "documents"}},
	{"https://immich.app", "Immich: self-hosted photo and video backup",
		"Your phone's photos and videos on your own server, with search, albums and sharing.", []string{"self-hosted", "photos"}},
	{"https://12factor.net", "The Twelve-Factor App",
		"Twelve rules for apps that are easy to deploy, scale and move, still a good checklist for your own.", []string{"dev", "architecture"}},
	{"https://www.sqlite.org/whentouse.html", "Appropriate Uses For SQLite",
		"Where SQLite is the right database, and the few places where it is not.", []string{"dev", "database"}},
	{"https://wiki.archlinux.org/title/Systemd", "systemd - ArchWiki",
		"The clearest guide to units, timers and the journal, useful well beyond Arch.", []string{"linux", "docs"}},
	{"https://jvns.ca", "Julia Evans",
		"Zines and posts that explain how things work: networking, the shell, debugging, containers.", []string{"blog", "linux"}},
}

// defaultInboxItems is the starter Inbox, stamped from now: the newest first,
// a few hours apart, so the list reads as saved over the last days.
func defaultInboxItems(now time.Time) []InboxLink {
	items := make([]InboxLink, 0, len(starterInboxLinks))
	for i, link := range starterInboxLinks {
		savedAt := now.Add(-time.Duration(i)*3*time.Hour - time.Duration(i*7)*time.Minute)
		items = append(items, InboxLink{
			ID:           fmtStarterInboxID(i),
			URL:          link.url,
			Title:        link.title,
			AddedAt:      savedAt.UnixMilli(),
			Source:       "paste",
			PreviewTitle: link.title,
			PreviewDesc:  link.desc,
			Tags:         append([]string(nil), link.tags...),
			Domain:       inboxDomainFromURL(link.url),
		})
	}
	return items
}

func fmtStarterInboxID(i int) string {
	return defaultInboxSeedPrefix + string(rune('a'+i))
}

// seedStarterInbox writes the starter Inbox on a fresh install. Never over an
// inbox that is already there.
func (fs *FileStore) seedStarterInbox(now time.Time) {
	if minimalSeed() || demoMode() {
		return
	}
	fs.mutex.Lock()
	defer fs.mutex.Unlock()
	if inbox, err := fs.readInboxDataForWriteLocked(); err != nil || len(inbox.Items) > 0 {
		return
	}
	_ = fs.saveInboxDataLocked(InboxData{Version: inboxDataVersion, Items: defaultInboxItems(now)})
}

// isStarterInboxLink says whether an item is one the starter Inbox put there
// and nobody has touched: still unread and not put to sleep.
func isStarterInboxLink(item InboxLink) bool {
	if len(item.ID) != len(defaultInboxSeedPrefix)+1 || item.ID[:len(defaultInboxSeedPrefix)] != defaultInboxSeedPrefix {
		return false
	}
	return item.ReadAt == 0 && item.SnoozedUntil == 0
}

// clearStarterInbox takes the untouched starter links out of the Inbox, for a
// reader who starts empty. Links they have read or put to sleep stay: those
// they have already made theirs.
func (h *Handlers) clearStarterInbox() error {
	var ids []string
	for _, item := range h.store.GetInboxItems() {
		if isStarterInboxLink(item) {
			ids = append(ids, item.ID)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	_, _, err := h.store.BatchInboxLinks(ids, func(*InboxLink) bool { return true })
	return err
}
