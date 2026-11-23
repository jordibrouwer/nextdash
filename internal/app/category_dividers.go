package app

import (
	"strconv"
	"strings"
)

// CategoryDivider is a label row inside a category ("Beheer", "Media"). It
// holds no link and is not a bookmark: it lives on its category, so every
// reader of the bookmark list stays untouched and a divider can never turn up
// in a count, a check or an export.
//
// Before is the address of the bookmark the divider stands above; empty means
// below the last one. It is what keeps a divider with its group when a bookmark
// above it is deleted, pinned or moved away. Index is the slot it stood in when
// last saved: the drawing falls back on it when the bookmark in Before is no
// longer in the category (0 is above the first, a value past the end is below
// the last). A bookmark dragged across a divider changes group, which is the
// point.
type CategoryDivider struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Index  int    `json:"index"`
	Before string `json:"before,omitempty"`
}

const (
	maxCategoryDividers    = 50
	maxCategoryDividerName = 80
	maxCategoryDividerRef  = 2048
)

// normalizeCategoryDividers cleans what a client sent: names trimmed and cut
// to length, empty names and repeated ids dropped, a missing id made from its
// position, negative slots lifted to 0, and the list kept in slot order (the
// stored order of equal slots is kept). Nothing here fails: a bad row is
// dropped, never the whole save.
func normalizeCategoryDividers(in []CategoryDivider) []CategoryDivider {
	if len(in) == 0 {
		return nil
	}
	seen := make(map[string]bool, len(in))
	out := make([]CategoryDivider, 0, len(in))
	for i, d := range in {
		name := truncateRunes(strings.TrimSpace(d.Name), maxCategoryDividerName)
		if name == "" {
			continue
		}
		id := strings.TrimSpace(d.ID)
		if id == "" || seen[id] {
			id = ""
			for n := i + 1; ; n++ {
				candidate := "d" + strconv.Itoa(n)
				if !seen[candidate] {
					id = candidate
					break
				}
			}
		}
		seen[id] = true
		slot := d.Index
		if slot < 0 {
			slot = 0
		}
		before := truncateRunes(strings.TrimSpace(d.Before), maxCategoryDividerRef)
		out = append(out, CategoryDivider{ID: id, Name: name, Index: slot, Before: before})
		if len(out) == maxCategoryDividers {
			break
		}
	}
	if len(out) == 0 {
		return nil
	}
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && out[j-1].Index > out[j].Index; j-- {
			out[j-1], out[j] = out[j], out[j-1]
		}
	}
	return out
}

// templateDividers is what a shared page template carries of a category's
// dividers: names and slots, never the address in Before (the template has no
// addresses of its own, and a link must not travel with it).
func templateDividers(in []CategoryDivider) []CategoryDivider {
	out := normalizeCategoryDividers(in)
	for i := range out {
		out[i].Before = ""
	}
	return out
}
