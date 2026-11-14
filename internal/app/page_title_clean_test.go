package app

import "testing"

func TestCleanPageTitle(t *testing.T) {
	cases := []struct {
		name, title, site, host, want string
	}{
		{"login with a dash", "Login - Radarr", "", "radarr.home.lan", "Radarr"},
		{"dutch login", "Aanmelden - Seerr", "", "seerr.example", "Seerr"},
		{"sign in with a bar", "Sign in | CrossWatch", "", "crosswatch.example", "CrossWatch"},
		{"sign in to", "Sign in to Nextcloud", "", "cloud.example", "Nextcloud"},
		{"login word alone", "Login", "", "tower.example", ""},
		{"site name from og", "Judge overturns press ban - YouTube", "YouTube", "www.youtube.com", "Judge overturns press ban"},
		{"site name from host", "Some video - YouTube", "", "www.youtube.com", "Some video"},
		{"host with co.uk", "Headline | BBC", "", "www.bbc.co.uk", "Headline"},
		{"tail is not the site", "About us - Radarr", "", "radarr.home.lan", "About us - Radarr"},
		{"tail is half a headline", "Cats - and why they purr", "", "example.com", "Cats - and why they purr"},
		{"head would be empty", " - YouTube", "YouTube", "youtube.com", "- YouTube"},
		{"address has no name", "Home - 192", "", "192.168.0.1", "Home - 192"},
		{"login then site name", "Login - Radarr - Radarr", "Radarr", "radarr.example.com", "Radarr"},
		{"plain title unchanged", "Tower/Login", "", "tower.example", "Tower/Login"},
	}
	for _, c := range cases {
		if got := cleanPageTitle(c.title, c.site, c.host); got != c.want {
			t.Errorf("%s: cleanPageTitle(%q) = %q, want %q", c.name, c.title, got, c.want)
		}
	}
}

func TestApplyTitleCleanupKeepsTheOriginalOnce(t *testing.T) {
	p := BookmarkPreview{Title: "Login - Radarr", Domain: "radarr.home.lan"}
	applyTitleCleanup(&p)
	if p.Title != "Radarr" || p.OriginalTitle != "Login - Radarr" {
		t.Fatalf("first pass: %+v", p)
	}
	applyTitleCleanup(&p)
	if p.Title != "Radarr" || p.OriginalTitle != "Login - Radarr" {
		t.Fatalf("a second pass changed it: %+v", p)
	}
	plain := BookmarkPreview{Title: "Radarr", Domain: "radarr.home.lan"}
	applyTitleCleanup(&plain)
	if plain.OriginalTitle != "" {
		t.Fatalf("a title that needed nothing got an original: %+v", plain)
	}
}
