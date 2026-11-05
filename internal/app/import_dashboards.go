package app

import (
	"bytes"
	"errors"
	"strings"

	"gopkg.in/yaml.v3"
)

/*
Reading another dashboard's configuration as a list of links.

A homelab that has lived on Homepage, Dashy or Homer already has its services
written down, with a name, an address and a group for each. Moving to nextDash
should not mean typing them again, so the importer that reads a browser's
bookmark file also reads these three, and everything after the reading is the
same: the dry run, the question of where it goes, the de-duplication.

What is read is the links and nothing else. A Homepage widget (its API keys and
settings), a Dashy theme or a Homer colour scheme has no counterpart in a
bookmark, and carrying a credential out of a config file into a bookmark is not
something an importer should do on its own; widgets are added afterwards, from
Config → Widgets, where a key is asked for on purpose.

The shapes, as each project documents them:

  Homepage  services.yaml   - Group: [ - Name: { href, description, icon } ]
            bookmarks.yaml  - Group: [ - Name: [ { abbr, href } ] ]
  Dashy     conf.yml        sections: [ { name, items: [ { title, url, description } ] } ]
  Homer     config.yml      services: [ { name, items: [ { name, url, subtitle, tag } ] } ]

A group nested inside a group becomes its own category, named after the inner
group: a category is flat in nextDash, and "Media / Players" as a name is noise.
*/

// errNotADashboardConfig means the file is not one of the three shapes, so the
// caller may try it as a bookmark file instead.
var errNotADashboardConfig = errors.New("not a dashboard configuration")

// looksLikeDashboardConfig tells a YAML or JSON configuration from an HTML
// bookmark file without parsing either: HTML starts with a tag.
func looksLikeDashboardConfig(data []byte) bool {
	trimmed := bytes.TrimLeft(bytes.TrimPrefix(data, []byte("\xef\xbb\xbf")), " \t\r\n")
	if len(trimmed) == 0 {
		return false
	}
	return trimmed[0] != '<'
}

// What a configuration may cost to read. A real file is a few hundred links
// under a few levels; anchors and aliases (&x, *x) let a file of one kilobyte
// stand for millions of rows, or for a group that contains itself, so reading is
// bounded rather than trusted: by depth, by the nodes visited and by the rows
// produced. A file past any bound is refused as a whole.
const (
	dashboardConfigMaxDepth = 12
	dashboardConfigMaxNodes = 200000
	dashboardConfigMaxRows  = 20000
)

var errDashboardConfigTooBig = errors.New("dashboard configuration is too large or too deeply nested")

// configReader is one reading: the rows so far and what is left of the budget.
type configReader struct {
	rows  []NetscapeBookmark
	nodes int
	// onPath holds the nodes being read right now, so an alias that leads back
	// into its own group ends there instead of looping.
	onPath map[*yaml.Node]bool
	failed bool
}

// enter spends budget on one node and says whether to go on into it.
func (c *configReader) enter(node *yaml.Node, depth int) bool {
	if c.failed {
		return false
	}
	c.nodes++
	if c.nodes > dashboardConfigMaxNodes || depth > dashboardConfigMaxDepth || len(c.rows) > dashboardConfigMaxRows {
		c.failed = true
		return false
	}
	if node != nil && c.onPath[node] {
		// A group that contains itself: not an error, there is just nothing new in it.
		return false
	}
	return true
}

func (c *configReader) add(row NetscapeBookmark) {
	// Past the budget nothing is kept: a group read through an alias can hold
	// far more services than the file has lines.
	if c.failed {
		return
	}
	c.rows = append(c.rows, row)
	if len(c.rows) > dashboardConfigMaxRows {
		c.failed = true
	}
}

// ParseDashboardConfig reads Homepage, Dashy or Homer configuration into
// bookmark rows, and says which of them it was.
func ParseDashboardConfig(data []byte) ([]NetscapeBookmark, string, error) {
	var doc yaml.Node
	if err := yaml.Unmarshal(data, &doc); err != nil || len(doc.Content) == 0 {
		return nil, "", errNotADashboardConfig
	}
	root := resolveAlias(doc.Content[0])
	reader := &configReader{onPath: map[*yaml.Node]bool{}}

	kind := ""
	switch root.Kind {
	case yaml.SequenceNode:
		kind = "homepage"
		reader.homepageGroups(root, "", 0)
	case yaml.MappingNode:
		if sections := yamlField(root, "sections"); sections != nil && sections.Kind == yaml.SequenceNode {
			kind = "dashy"
			reader.dashySections(sections)
		} else if services := yamlField(root, "services"); services != nil && services.Kind == yaml.SequenceNode {
			kind = "homer"
			reader.homerServices(services)
			if links := yamlField(root, "links"); links != nil && links.Kind == yaml.SequenceNode {
				reader.homerItems(links, "Links")
			}
		}
	}
	if reader.failed {
		return nil, "", errDashboardConfigTooBig
	}
	if kind == "" || len(reader.rows) == 0 {
		return nil, "", errNotADashboardConfig
	}
	return reader.rows, kind, nil
}

// resolveAlias follows an alias to what it names. A chain of aliases is
// followed with a small bound of its own.
func resolveAlias(node *yaml.Node) *yaml.Node {
	for hops := 0; node != nil && node.Kind == yaml.AliasNode && node.Alias != nil && hops < 8; hops++ {
		node = node.Alias
	}
	return node
}

// yamlField returns the value under a key of a mapping, or nil.
func yamlField(mapping *yaml.Node, key string) *yaml.Node {
	if mapping == nil || mapping.Kind != yaml.MappingNode {
		return nil
	}
	for i := 0; i+1 < len(mapping.Content); i += 2 {
		if strings.EqualFold(mapping.Content[i].Value, key) {
			return resolveAlias(mapping.Content[i+1])
		}
	}
	return nil
}

func yamlText(mapping *yaml.Node, keys ...string) string {
	for _, key := range keys {
		if value := yamlField(mapping, key); value != nil && value.Kind == yaml.ScalarNode {
			if text := strings.TrimSpace(value.Value); text != "" {
				return text
			}
		}
	}
	return ""
}

func isWebAddress(address string) bool {
	lower := strings.ToLower(address)
	return strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://")
}

/* ---------- Homepage ---------- */

// homepageGroups reads a sequence of single-key mappings: { Group: [...] }.
func (c *configReader) homepageGroups(seq *yaml.Node, inherited string, depth int) {
	if !c.enter(seq, depth) {
		return
	}
	c.onPath[seq] = true
	defer delete(c.onPath, seq)
	for _, entry := range seq.Content {
		if c.failed {
			return
		}
		entry = resolveAlias(entry)
		if entry.Kind != yaml.MappingNode {
			continue
		}
		for i := 0; i+1 < len(entry.Content); i += 2 {
			name := strings.TrimSpace(entry.Content[i].Value)
			value := resolveAlias(entry.Content[i+1])
			switch value.Kind {
			case yaml.SequenceNode:
				c.homepageGroup(name, value, depth+1)
			case yaml.MappingNode:
				// A service sitting straight in the top-level list.
				if row, ok := homepageService(name, value, inherited); ok {
					c.add(row)
				}
			}
		}
	}
}

// homepageGroup reads the members of one group: services, bookmarks, or groups.
func (c *configReader) homepageGroup(group string, seq *yaml.Node, depth int) {
	if !c.enter(seq, depth) {
		return
	}
	c.onPath[seq] = true
	defer delete(c.onPath, seq)
	for _, member := range seq.Content {
		if c.failed {
			return
		}
		member = resolveAlias(member)
		if member.Kind != yaml.MappingNode {
			continue
		}
		for i := 0; i+1 < len(member.Content); i += 2 {
			name := strings.TrimSpace(member.Content[i].Value)
			value := resolveAlias(member.Content[i+1])
			switch value.Kind {
			case yaml.MappingNode:
				if row, ok := homepageService(name, value, group); ok {
					c.add(row)
				}
			case yaml.SequenceNode:
				// Either a bookmark (its one entry has an href) or a group inside this one.
				if row, ok := homepageBookmark(name, value, group); ok {
					c.add(row)
				} else {
					c.homepageGroup(name, value, depth+1)
				}
			}
		}
	}
}

func homepageService(name string, props *yaml.Node, group string) (NetscapeBookmark, bool) {
	href := yamlText(props, "href")
	if !isWebAddress(href) {
		return NetscapeBookmark{}, false
	}
	return NetscapeBookmark{Name: name, URL: href, Folder: group, Note: yamlText(props, "description")}, true
}

func homepageBookmark(name string, seq *yaml.Node, group string) (NetscapeBookmark, bool) {
	for _, entry := range seq.Content {
		entry = resolveAlias(entry)
		if href := yamlText(entry, "href"); isWebAddress(href) {
			return NetscapeBookmark{Name: name, URL: href, Folder: group, Note: yamlText(entry, "description")}, true
		}
	}
	return NetscapeBookmark{}, false
}

/* ---------- Dashy ---------- */

func (c *configReader) dashySections(sections *yaml.Node) {
	for _, section := range sections.Content {
		section = resolveAlias(section)
		name := yamlText(section, "name", "title")
		items := yamlField(section, "items")
		if items == nil || items.Kind != yaml.SequenceNode {
			continue
		}
		for _, item := range items.Content {
			c.dashyItem(resolveAlias(item), name, 0)
		}
	}
}

func (c *configReader) dashyItem(item *yaml.Node, section string, depth int) {
	if !c.enter(item, depth) {
		return
	}
	c.onPath[item] = true
	defer delete(c.onPath, item)
	if url := yamlText(item, "url"); isWebAddress(url) {
		c.add(NetscapeBookmark{
			Name: yamlText(item, "title", "name"), URL: url, Folder: section, Note: yamlText(item, "description"),
		})
	}
	// An item may hold more links under it.
	if sub := yamlField(item, "subItems"); sub != nil && sub.Kind == yaml.SequenceNode {
		for _, s := range sub.Content {
			c.dashyItem(resolveAlias(s), section, depth+1)
		}
	}
}

/* ---------- Homer ---------- */

func (c *configReader) homerServices(services *yaml.Node) {
	for _, service := range services.Content {
		service = resolveAlias(service)
		name := yamlText(service, "name")
		if items := yamlField(service, "items"); items != nil && items.Kind == yaml.SequenceNode {
			c.homerItems(items, name)
		}
	}
}

func (c *configReader) homerItems(items *yaml.Node, group string) {
	for _, item := range items.Content {
		if !c.enter(nil, 0) {
			return
		}
		item = resolveAlias(item)
		url := yamlText(item, "url")
		if !isWebAddress(url) {
			continue
		}
		row := NetscapeBookmark{Name: yamlText(item, "name"), URL: url, Folder: group, Note: yamlText(item, "subtitle")}
		if tag := yamlText(item, "tag"); tag != "" {
			row.Tags = []string{strings.ToLower(tag)}
		}
		c.add(row)
	}
}
