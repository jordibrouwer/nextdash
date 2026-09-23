package app

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"testing"
)

// iconPNG is the shortest thing detectImageType calls a PNG, with a tail that
// tells one upload from another.
func iconPNG(tail string) []byte {
	return append([]byte("\x89PNG\r\n\x1a\n"), []byte(tail)...)
}

func uploadIcon(t *testing.T, h *Handlers, filename string, body []byte) string {
	t.Helper()
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	part, err := writer.CreateFormFile("icon", filename)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(body); err != nil {
		t.Fatal(err)
	}
	writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/icon", bytes.NewReader(buf.Bytes()))
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()
	h.UploadIcon(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("upload %s: status %d, body %s", filename, rec.Code, rec.Body.String())
	}
	var answer struct {
		Icon string `json:"icon"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &answer); err != nil {
		t.Fatalf("upload %s: %v", filename, err)
	}
	return answer.Icon
}

/*
An uploaded icon is named for its bytes, not for the file it came from.

UploadIcon kept the name the browser sent and wrote with os.WriteFile, which
overwrites. Two bookmarks given different pictures both called icon.png meant
the second silently replaced the first -- and every icon is served with a
year-long immutable cache entry, so a replacement was not even visible to a
browser that had already seen the old one.
*/
func TestUploadedIconsDoNotOverwriteEachOther(t *testing.T) {
	h := newTestHandlers(t)

	first := uploadIcon(t, h, "icon.png", iconPNG("first picture"))
	second := uploadIcon(t, h, "icon.png", iconPNG("second picture"))

	if first == second {
		t.Fatalf("two uploads named icon.png got one name (%s): one overwrote the other", first)
	}

	iconsDir := filepath.Join(ResolveDataDir(), "icons")
	for name, want := range map[string]string{
		first:  "first picture",
		second: "second picture",
	} {
		got, err := os.ReadFile(filepath.Join(iconsDir, name))
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		if !bytes.Contains(got, []byte(want)) {
			t.Errorf("%s does not hold %q", name, want)
		}
	}
}

/*
And the name has the shape the immutable cache header is promised.

data_file_route.go freezes a name for a year on the premise that icon names
carry random bytes and are never rewritten. That premise only ever held for the
prefetcher's names; an upload kept whatever the browser sent.
*/
func TestUploadedIconNameIsContentAddressed(t *testing.T) {
	h := newTestHandlers(t)
	generated := regexp.MustCompile(`^icon-[0-9a-f]{16}\.[a-z0-9]+$`)

	for _, sent := range []string{"icon.png", "My Logo (1).png", "../../etc/passwd.png"} {
		got := uploadIcon(t, h, sent, iconPNG(sent))
		if !generated.MatchString(got) {
			t.Errorf("upload named %q was stored as %q, which is not a generated name", sent, got)
		}
	}
}
