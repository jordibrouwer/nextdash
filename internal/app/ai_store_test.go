package app

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode/utf8"
)

func aiTestStoreDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)
	return dir
}

func TestPruneByCountAndAge(t *testing.T) {
	now := time.Date(2026, 10, 29, 12, 0, 0, 0, time.UTC)
	var convs []aiConversation
	for i := 0; i < 60; i++ {
		age := time.Duration(i*2) * 24 * time.Hour // 0..118 days
		convs = append(convs, aiConversation{ID: fmt.Sprintf("c%02d", i), Updated: now.Add(-age).UnixMilli()})
	}
	out := aiPrune(convs, 50, 90, now)
	if len(out) > 50 {
		t.Fatalf("kept %d, want <= 50", len(out))
	}
	cutoff := now.Add(-90 * 24 * time.Hour).UnixMilli()
	for _, c := range out {
		if c.Updated < cutoff {
			t.Fatalf("%s is older than 90 days", c.ID)
		}
	}
	if len(out) != 46 { // i*2 <= 90 -> i 0..45
		t.Fatalf("kept %d, want 46", len(out))
	}
	if out[0].ID != "c00" {
		t.Fatalf("newest not kept first: %s", out[0].ID)
	}
	out = aiPrune(convs[:10], 5, 365, now)
	if len(out) != 5 || out[4].ID != "c04" {
		t.Fatalf("count prune kept wrong set: %+v", out)
	}
}

func TestRetentionUsesTheDefaultsWhenUnset(t *testing.T) {
	aiTestStoreDir(t)
	now := time.Now()
	var convs []aiConversation
	for i := 0; i < 60; i++ {
		convs = append(convs, aiConversation{ID: fmt.Sprintf("c%02d", i), Updated: now.Add(-time.Duration(i) * time.Hour).UnixMilli()})
	}
	convs = append(convs, aiConversation{ID: "old", Updated: now.Add(-100 * 24 * time.Hour).UnixMilli()})
	if err := aiSaveConversations(convs, Settings{}, now); err != nil {
		t.Fatal(err)
	}
	got := aiLoadConversations()
	if len(got) != 50 {
		t.Fatalf("got %d, want 50", len(got))
	}
	for _, c := range got {
		if c.ID == "old" {
			t.Fatal("old conversation survived")
		}
	}
	two := []aiConversation{{ID: "old", Updated: now.Add(-100 * 24 * time.Hour).UnixMilli()}}
	if err := aiSaveConversations(two, Settings{}, now); err != nil {
		t.Fatal(err)
	}
	if n := len(aiLoadConversations()); n != 0 {
		t.Fatalf("age default not applied, %d left", n)
	}
}

func TestSearchMatchesTitlesAndTexts(t *testing.T) {
	aiTestStoreDir(t)
	now := time.Now()
	a, err := aiAppendTurn("", "Hello there", aiMessage{Role: "assistant", Text: "Try the radarr bookmark"}, Settings{}, now)
	if err != nil {
		t.Fatal(err)
	}
	b, err := aiAppendTurn("", "Second topic", aiMessage{Role: "assistant", Text: "ok"}, Settings{}, now.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	got := aiListConversations("Radarr")
	if len(got) != 1 || got[0].ID != a.ID {
		t.Fatalf("radarr search: %+v", got)
	}
	if got := aiListConversations("zzz"); len(got) != 0 {
		t.Fatalf("zzz: %+v", got)
	}
	if got := aiListConversations("second"); len(got) != 1 || got[0].ID != b.ID {
		t.Fatalf("title search: %+v", got)
	}
	all := aiListConversations("")
	if len(all) != 2 || all[0].ID != b.ID {
		t.Fatalf("all not newest first: %+v", all)
	}
}

func TestDeleteOneAndAll(t *testing.T) {
	aiTestStoreDir(t)
	now := time.Now()
	a, _ := aiAppendTurn("", "one", aiMessage{Role: "assistant", Text: "x"}, Settings{}, now)
	b, _ := aiAppendTurn("", "two", aiMessage{Role: "assistant", Text: "y"}, Settings{}, now)
	if ok, err := aiDeleteConversation(a.ID); !ok || err != nil {
		t.Fatalf("delete: %v %v", ok, err)
	}
	if ok, err := aiDeleteConversation(a.ID); ok || err != nil {
		t.Fatalf("second delete: %v %v", ok, err)
	}
	if _, ok := aiGetConversation(a.ID); ok {
		t.Fatal("deleted conversation still there")
	}
	if _, ok := aiGetConversation(b.ID); !ok {
		t.Fatal("other conversation lost")
	}
	if err := aiDeleteAllConversations(); err != nil {
		t.Fatal(err)
	}
	if n := len(aiListConversations("")); n != 0 {
		t.Fatalf("%d left", n)
	}
}

func TestABrokenConversationFileIsSetAside(t *testing.T) {
	dir := aiTestStoreDir(t)
	path := filepath.Join(dir, "ai-conversations.json")
	if err := os.WriteFile(path, []byte(`{"conv`), 0644); err != nil {
		t.Fatal(err)
	}
	if got := aiLoadConversations(); len(got) != 0 {
		t.Fatalf("got %d", len(got))
	}
	broken, err := os.ReadFile(path + ".broken")
	if err != nil || string(broken) != `{"conv` {
		t.Fatalf("broken copy: %q %v", broken, err)
	}
	if _, err := aiAppendTurn("", "hi", aiMessage{Role: "assistant", Text: "yo"}, Settings{}, time.Now()); err != nil {
		t.Fatal(err)
	}
	if n := len(aiLoadConversations()); n != 1 {
		t.Fatalf("after append: %d", n)
	}
}

func TestAHugeConversationFileIsSetAside(t *testing.T) {
	dir := aiTestStoreDir(t)
	old := aiConversationsMaxBytes
	aiConversationsMaxBytes = 1024
	t.Cleanup(func() { aiConversationsMaxBytes = old })
	path := filepath.Join(dir, "ai-conversations.json")
	body := `[{"id":"a","title":"` + strings.Repeat("x", 2048) + `"}]`
	if err := os.WriteFile(path, []byte(body), 0644); err != nil {
		t.Fatal(err)
	}
	if got := aiLoadConversations(); len(got) != 0 {
		t.Fatalf("got %d", len(got))
	}
	if _, err := os.Stat(path + ".broken"); err != nil {
		t.Fatalf("not set aside: %v", err)
	}
	if _, err := os.Stat(path); err == nil {
		t.Fatal("original still in place")
	}
}

func TestToolResultsAreNotStored(t *testing.T) {
	dir := aiTestStoreDir(t)
	msg := aiMessage{Role: "assistant", Text: "done", Tools: []aiToolSummary{{Name: "search_bookmarks", Bytes: 4321}}}
	conv, err := aiAppendTurn("", "find it", msg, Settings{}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(filepath.Join(dir, "ai-conversations.json"))
	if strings.Contains(string(raw), "https://secret.example/only-in-tool-result") {
		t.Fatal("tool result leaked")
	}
	got, _ := aiGetConversation(conv.ID)
	tools := got.Messages[len(got.Messages)-1].Tools
	if len(tools) != 1 || tools[0].Name != "search_bookmarks" || tools[0].Bytes != 4321 {
		t.Fatalf("tools: %+v", tools)
	}
}

func TestAProposalClaimIsExclusive(t *testing.T) {
	aiTestStoreDir(t)
	msg := aiMessage{Role: "assistant", Text: "x", Proposals: []aiProposal{{ID: "p1", Tool: "t", Status: "pending"}}}
	if _, err := aiAppendTurn("", "q", msg, Settings{}, time.Now()); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	var mu sync.Mutex
	changed := 0
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, ok, err := aiUpdateProposal("p1", []string{"pending", "failed"}, aiProposal{ID: "p1", Tool: "t", Status: "applying"})
			if err != nil {
				t.Error(err)
			}
			if ok {
				mu.Lock()
				changed++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	if changed != 1 {
		t.Fatalf("changed %d times", changed)
	}
	p, ok := aiFindProposal("p1")
	if !ok || p.Status != "applying" {
		t.Fatalf("%+v %v", p, ok)
	}
}

func TestApplyingIsRecoveredAfterARestart(t *testing.T) {
	dir := aiTestStoreDir(t)
	now := time.Now()
	conv, err := aiAppendTurn("", "q", aiMessage{Role: "assistant", Text: "x", Proposals: []aiProposal{{ID: "p1", Tool: "t", Status: "applying"}, {ID: "p2", Tool: "t", Status: "pending"}}}, Settings{}, now)
	if err != nil {
		t.Fatal(err)
	}
	_ = conv
	aiResetRecoveryForTest()
	p, ok := aiFindProposal("p1")
	if !ok || p.Status != "failed" || p.Error != "Interrupted by a restart. You can apply it again or skip it." {
		t.Fatalf("not recovered: %+v", p)
	}
	raw, _ := os.ReadFile(filepath.Join(dir, "ai-conversations.json"))
	if !strings.Contains(string(raw), `"status":"failed"`) || strings.Contains(string(raw), `"status":"applying"`) {
		t.Fatalf("disk not updated: %s", raw)
	}
	if p2, _ := aiFindProposal("p2"); p2.Status != "pending" {
		t.Fatalf("p2 touched: %+v", p2)
	}
	// A claim made in this process survives later loads.
	if _, ok, err := aiUpdateProposal("p2", []string{"pending"}, aiProposal{Tool: "t", Status: "applying"}); !ok || err != nil {
		t.Fatalf("claim: %v %v", ok, err)
	}
	if p2, _ := aiFindProposal("p2"); p2.Status != "applying" {
		t.Fatalf("live claim reset: %+v", p2)
	}
}

func TestConversationGoneAndProposalMisses(t *testing.T) {
	aiTestStoreDir(t)
	if _, err := aiAppendTurn("nope", "q", aiMessage{Role: "assistant"}, Settings{}, time.Now()); err != errAIConversationGone {
		t.Fatalf("err = %v", err)
	}
	if _, err := aiAppendTurn("", "q", aiMessage{Role: "assistant", Proposals: []aiProposal{{ID: "p1", Status: "applied"}}}, Settings{}, time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, ok, err := aiUpdateProposal("missing", []string{"pending"}, aiProposal{Status: "applying"}); ok || err != nil {
		t.Fatalf("missing: %v %v", ok, err)
	}
	prev, ok, err := aiUpdateProposal("p1", []string{"pending", "failed"}, aiProposal{Status: "applying"})
	if ok || err != nil || prev.Status != "applied" {
		t.Fatalf("wrong status: %+v %v %v", prev, ok, err)
	}
	if p, _ := aiFindProposal("p1"); p.Status != "applied" {
		t.Fatalf("changed: %+v", p)
	}
}

func TestMultibyteTruncationIsUTF8Safe(t *testing.T) {
	aiTestStoreDir(t)
	long := strings.Repeat("é", 20<<10) // 40 KiB
	conv, err := aiAppendTurn("", strings.Repeat("日", 200), aiMessage{Role: "assistant", Text: long}, Settings{}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	got, _ := aiGetConversation(conv.ID)
	txt := got.Messages[1].Text
	if len(txt) > 32<<10 || !utf8.ValidString(txt) || len(txt) < 32<<10-3 {
		t.Fatalf("text len %d valid %v", len(txt), utf8.ValidString(txt))
	}
	if !utf8.ValidString(got.Title) || utf8.RuneCountInString(got.Title) != 81 || !strings.HasSuffix(got.Title, "…") {
		t.Fatalf("title %q", got.Title)
	}
}
