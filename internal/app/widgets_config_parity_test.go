package app

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

/*
 * The two halves of a widget setting, checked against each other.
 *
 * widgetFields says at the top of its file that the config UI is generated from
 * the same shape on the client, "so a field that exists in one and not the
 * other is a mismatch that shows up immediately". Nothing checked it, and it
 * does not show up immediately at all: sanitizeWidgetConfig drops every key its
 * type does not declare, so a setting added to the panel and to the widget but
 * not to the Go table is written by the browser, accepted with a 200, and
 * quietly gone on the next read. That is how the Kept widget lost its order and
 * its tag in v1.13.0.
 *
 * So the claim is a test now. Only one direction is required: everything the
 * panel can write has to be accepted. The other way round is legitimate --
 * health and uptime both take a pageId that the panel does not offer.
 */

var (
	widgetSettingsBlock = regexp.MustCompile(`(?m)^\s*static WIDGET_SETTINGS = \{$`)
	widgetSettingsType  = regexp.MustCompile(`^\s{8}([A-Za-z_][A-Za-z0-9_]*):\s*\[`)
	widgetSettingsKey   = regexp.MustCompile(`\{\s*key:\s*'([^']+)'`)
)

// widgetSettingsFromConfigPanel reads DashboardConfig.WIDGET_SETTINGS out of the
// browser source, as a map of widget type to the keys its panel writes.
func widgetSettingsFromConfigPanel(t *testing.T) map[string][]string {
	t.Helper()

	source, err := os.ReadFile("../../static/js/dashboard/dashboard-config.js")
	if err != nil {
		t.Fatalf("read the config panel: %v", err)
	}
	lines := strings.Split(string(source), "\n")

	start := -1
	for i, line := range lines {
		if widgetSettingsBlock.MatchString(line) {
			start = i + 1
			break
		}
	}
	if start < 0 {
		t.Fatal("WIDGET_SETTINGS is not in dashboard-config.js under the name this test looks for")
	}

	found := map[string][]string{}
	current := ""
	for _, line := range lines[start:] {
		// The table's own closing brace, at the indentation a class field ends
		// on. Anything deeper belongs to a type inside it.
		if line == "    };" {
			break
		}
		if m := widgetSettingsType.FindStringSubmatch(line); m != nil {
			current = m[1]
			if _, seen := found[current]; !seen {
				found[current] = nil
			}
			continue
		}
		if current == "" {
			continue
		}
		if m := widgetSettingsKey.FindStringSubmatch(line); m != nil {
			found[current] = append(found[current], m[1])
		}
	}
	if len(found) == 0 {
		t.Fatal("no widget types were read out of WIDGET_SETTINGS, so this test is measuring nothing")
	}
	return found
}

func TestEveryWidgetSettingThePanelWritesIsAccepted(t *testing.T) {
	panel := widgetSettingsFromConfigPanel(t)

	// Shared by every type rather than declared per type, so the table does not
	// carry twenty copies of one line. sanitizeWidgetConfig keeps them itself.
	shared := map[string]bool{"enabled": true, "columns": true}

	for widgetType, keys := range panel {
		accepted := map[string]bool{}
		fields, ok := widgetFields[WidgetType(widgetType)]
		if !ok && len(keys) > 0 {
			t.Errorf("the panel writes settings for %q and widgetFields has no entry for it, so every one of them is dropped: %v",
				widgetType, keys)
			continue
		}
		for _, field := range fields {
			accepted[field.Key] = true
		}
		for _, key := range keys {
			if shared[key] || accepted[key] {
				continue
			}
			t.Errorf("%s.%s is written by the config panel and not declared in widgetFields, so a save of it is accepted with a 200 and gone on the next read",
				widgetType, key)
		}
	}
}

/*
And the panel is read rather than assumed.

A regex over someone else's source file fails silently the day that file is
written differently: every type would come back with no keys and the test above
would pass by measuring nothing. This pins the shape of what was read.
*/
func TestWidgetSettingsWereActuallyReadFromThePanel(t *testing.T) {
	panel := widgetSettingsFromConfigPanel(t)

	if len(panel) < 15 {
		t.Errorf("read %d widget types out of the panel, which is fewer than this app has: %v",
			len(panel), panel)
	}
	// Three that have had settings since long before this test, one from each
	// corner of the table.
	for _, want := range []struct {
		widgetType string
		key        string
	}{
		{"unsorted", "rows"},
		{"docker", "refreshSeconds"},
		{"custom", "url"},
	} {
		if !contains(panel[want.widgetType], want.key) {
			t.Errorf("%s.%s was not read out of the panel, so the parse is wrong: got %v",
				want.widgetType, want.key, panel[want.widgetType])
		}
	}
}

func contains(haystack []string, needle string) bool {
	for _, item := range haystack {
		if item == needle {
			return true
		}
	}
	return false
}
