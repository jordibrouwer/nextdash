package app

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

/*
BatchInbox applies one action to many inbox items at once.

"Mark all read", "Clear read" and the selection bar sent one request per item,
and every one of them rewrote inbox.json whole: a few hundred items meant a few
hundred full rewrites, in parallel, behind one lock. This does the lot in one.

Ops: read, unread, snooze (with snoozedUntil; 0 or past wakes), tag (addTags
and/or removeTags, merged into what each item has), delete (with an optional
reason "promote", as the single delete takes it). Events and icon
cleanup follow the single-item routes, so the stats read the same either way.
*/
func (h *Handlers) BatchInbox(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == "OPTIONS" {
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}
	var request struct {
		Op           string   `json:"op"`
		IDs          []string `json:"ids"`
		SnoozedUntil int64    `json:"snoozedUntil"`
		Reason       string   `json:"reason"`
		AddTags      []string `json:"addTags"`
		RemoveTags   []string `json:"removeTags"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	now := time.Now().UnixMilli()
	var mutate func(*InboxLink) bool
	switch request.Op {
	case "read":
		mutate = func(item *InboxLink) bool {
			if item.ReadAt == 0 {
				item.ReadAt = now
			}
			return false
		}
	case "unread":
		mutate = func(item *InboxLink) bool {
			item.ReadAt = 0
			return false
		}
	case "snooze":
		until := request.SnoozedUntil
		if until <= now {
			until = 0
		}
		mutate = func(item *InboxLink) bool {
			item.SnoozedUntil = until
			return false
		}
	case "tag":
		add := normalizeTags(request.AddTags)
		remove := make(map[string]struct{}, len(request.RemoveTags))
		for _, tag := range normalizeTags(request.RemoveTags) {
			remove[tag] = struct{}{}
		}
		if len(add) == 0 && len(remove) == 0 {
			http.Error(w, "addTags or removeTags required", http.StatusBadRequest)
			return
		}
		mutate = func(item *InboxLink) bool {
			kept := make([]string, 0, len(item.Tags)+len(add))
			for _, tag := range normalizeTags(item.Tags) {
				if _, drop := remove[tag]; !drop {
					kept = append(kept, tag)
				}
			}
			item.Tags = normalizeTags(append(kept, add...))
			clampInboxLinkFields(item)
			return false
		}
	case "delete":
		mutate = func(*InboxLink) bool { return true }
	default:
		http.Error(w, "unknown op", http.StatusBadRequest)
		return
	}

	before, missing, err := h.store.BatchInboxLinks(request.IDs, mutate)
	if !respondStorePersistError(w, err) {
		return
	}

	switch request.Op {
	case "read":
		for _, item := range before {
			if item.ReadAt == 0 {
				h.store.RecordInboxEvent(InboxEvent{Type: inboxEventKept, Source: item.Source})
			}
		}
	case "delete":
		eventType := inboxEventDeleted
		if strings.EqualFold(strings.TrimSpace(request.Reason), "promote") {
			eventType = inboxEventPromoted
		}
		for _, item := range before {
			h.store.removeUnusedIconFile(item.Icon)
			var retentionMs int64
			if item.AddedAt > 0 && now > item.AddedAt {
				retentionMs = now - item.AddedAt
			}
			h.store.RecordInboxEvent(InboxEvent{Type: eventType, Source: item.Source, RetentionMs: retentionMs})
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"status":  "success",
		"done":    len(before),
		"missing": missing,
	})
}
