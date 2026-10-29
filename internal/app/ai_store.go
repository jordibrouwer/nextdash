package app

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

/*
The assistant's conversations, kept in one file in the data directory.

The file is read on every call and never cached, so a per-test data dir just
works and a restored backup is picked up without a restart. Tool results are
never stored: a message keeps only the tool names and byte counts, because a
result can carry bookmark URLs and notes that the conversation has no business
holding on to. A file that cannot be parsed, or is absurdly large, is set aside
as ai-conversations.json.broken rather than deleted, and the warning that says
so never includes its contents.
*/

const (
	aiMessageTextMax = 32 << 10
	aiTitleMax       = 80
)

// aiConversationsMaxBytes is a variable so a test can lower it.
var aiConversationsMaxBytes int64 = 32 << 20

var (
	aiStoreMu             sync.Mutex
	errAIConversationGone = errors.New("conversation not found")
)

type aiMessage struct {
	ID        string          `json:"id"`
	Role      string          `json:"role"` // user or assistant
	Text      string          `json:"text"`
	Tools     []aiToolSummary `json:"tools"`
	Proposals []aiProposal    `json:"proposals"`
	Provider  string          `json:"provider"`
	Model     string          `json:"model"`
	TokensIn  int             `json:"tokensIn"`
	TokensOut int             `json:"tokensOut"`
	Created   int64           `json:"created"`
}

type aiConversation struct {
	ID       string      `json:"id"`
	Title    string      `json:"title"`
	Created  int64       `json:"created"`
	Updated  int64       `json:"updated"`
	Messages []aiMessage `json:"messages"`
}

type aiConversationSummary struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Updated int64  `json:"updated"`
}

func aiConversationsFilePath() string {
	return filepath.Join(ResolveDataDir(), "ai-conversations.json")
}

func aiSetAside(path, why string) {
	if err := os.Rename(path, path+".broken"); err != nil {
		logWarn("assistant", "conversation file %s and could not be set aside: %v", why, err)
		return
	}
	logWarn("assistant", "conversation file %s; set aside as ai-conversations.json.broken", why)
}

// aiRecoveryDone is guarded by aiStoreMu. The first load of a process maps any
// proposal still "applying" to "failed": such a claim can only be left over
// from a process that died between claiming and applying.
var aiRecoveryDone bool

const aiInterruptedText = "Interrupted by a restart. You can apply it again or skip it."

// aiResetRecoveryForTest makes the next load behave like the first of a process.
func aiResetRecoveryForTest() {
	aiStoreMu.Lock()
	aiRecoveryDone = false
	aiStoreMu.Unlock()
}

// aiLoadConversations has side effects (it may rename a bad file aside and
// recover interrupted proposals), so aiStoreMu MUST be held by the caller.
// Tests may call it unlocked.
func aiLoadConversations() []aiConversation {
	convs := aiReadConversations()
	if !aiRecoveryDone {
		aiRecoveryDone = true
		changed := false
		for ci := range convs {
			for mi := range convs[ci].Messages {
				props := convs[ci].Messages[mi].Proposals
				for pi := range props {
					if props[pi].Status == "applying" {
						props[pi].Status = "failed"
						props[pi].Error = aiInterruptedText
						changed = true
					}
				}
			}
		}
		if changed {
			if err := writeAIConvs(convs); err != nil {
				logWarn("assistant", "could not save recovered proposals: %v", err)
			}
		}
	}
	return convs
}

func aiReadConversations() []aiConversation {
	path := aiConversationsFilePath()
	fi, err := os.Stat(path)
	if err != nil {
		return []aiConversation{}
	}
	if fi.Size() > aiConversationsMaxBytes {
		aiSetAside(path, "is too large")
		return []aiConversation{}
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return []aiConversation{}
	}
	var convs []aiConversation
	if err := json.Unmarshal(data, &convs); err != nil {
		aiSetAside(path, "is not valid JSON")
		return []aiConversation{}
	}
	if convs == nil {
		convs = []aiConversation{}
	}
	return convs
}

func aiSaveConversations(convs []aiConversation, s Settings, now time.Time) error {
	convs = aiPrune(convs, aiHistoryMaxOf(s), aiHistoryDaysOf(s), now)
	if convs == nil {
		convs = []aiConversation{}
	}
	return writeAIConvs(convs)
}

func aiPrune(convs []aiConversation, max, days int, now time.Time) []aiConversation {
	cutoff := now.Add(-time.Duration(days) * 24 * time.Hour).UnixMilli()
	kept := make([]aiConversation, 0, len(convs))
	for _, c := range convs {
		if c.Updated >= cutoff {
			kept = append(kept, c)
		}
	}
	sort.SliceStable(kept, func(i, j int) bool { return kept[i].Updated > kept[j].Updated })
	if max > 0 && len(kept) > max {
		kept = kept[:max]
	}
	return kept
}

func aiTitleFrom(question string) string {
	q := strings.TrimSpace(question)
	if i := strings.IndexAny(q, "\r\n"); i >= 0 {
		q = strings.TrimSpace(q[:i])
	}
	r := []rune(q)
	if len(r) > aiTitleMax {
		return strings.TrimSpace(string(r[:aiTitleMax])) + "…"
	}
	return q
}

func aiCapText(s string) string {
	if len(s) <= aiMessageTextMax {
		return s
	}
	s = s[:aiMessageTextMax]
	for !utf8.ValidString(s) {
		s = s[:len(s)-1]
	}
	return s
}

func aiRandomID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func aiPrepMessage(m aiMessage, now time.Time) aiMessage {
	m.Text = aiCapText(m.Text)
	if m.ID == "" {
		m.ID = aiRandomID()
	}
	if m.Created == 0 {
		m.Created = now.UnixMilli()
	}
	return m
}

func aiAppendTurn(convID string, question string, answer aiMessage, s Settings, now time.Time) (aiConversation, error) {
	aiStoreMu.Lock()
	defer aiStoreMu.Unlock()
	convs := aiLoadConversations()
	idx := -1
	if convID != "" {
		for i := range convs {
			if convs[i].ID == convID {
				idx = i
				break
			}
		}
		if idx < 0 {
			return aiConversation{}, errAIConversationGone
		}
	} else {
		convs = append(convs, aiConversation{ID: aiRandomID(), Title: aiTitleFrom(question), Created: now.UnixMilli()})
		idx = len(convs) - 1
	}
	c := &convs[idx]
	c.Messages = append(c.Messages,
		aiPrepMessage(aiMessage{Role: "user", Text: question}, now),
		aiPrepMessage(answer, now))
	c.Updated = now.UnixMilli()
	out := *c
	if err := aiSaveConversations(convs, s, now); err != nil {
		return aiConversation{}, err
	}
	return out, nil
}

func aiListConversations(query string) []aiConversationSummary {
	aiStoreMu.Lock()
	convs := aiLoadConversations()
	aiStoreMu.Unlock()
	q := strings.ToLower(strings.TrimSpace(query))
	out := []aiConversationSummary{}
	for _, c := range convs {
		if q != "" && !aiConversationMatches(c, q) {
			continue
		}
		out = append(out, aiConversationSummary{ID: c.ID, Title: c.Title, Updated: c.Updated})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Updated > out[j].Updated })
	return out
}

func aiConversationMatches(c aiConversation, q string) bool {
	if strings.Contains(strings.ToLower(c.Title), q) {
		return true
	}
	for _, m := range c.Messages {
		if strings.Contains(strings.ToLower(m.Text), q) {
			return true
		}
	}
	return false
}

func aiGetConversation(id string) (aiConversation, bool) {
	aiStoreMu.Lock()
	defer aiStoreMu.Unlock()
	for _, c := range aiLoadConversations() {
		if c.ID == id {
			return c, true
		}
	}
	return aiConversation{}, false
}

// aiDeleteConversation returns (found, error); not found is (false, nil).
func aiDeleteConversation(id string) (bool, error) {
	aiStoreMu.Lock()
	defer aiStoreMu.Unlock()
	convs := aiLoadConversations()
	for i := range convs {
		if convs[i].ID == id {
			convs = append(convs[:i], convs[i+1:]...)
			if err := writeAIConvs(convs); err != nil {
				return false, err
			}
			return true, nil
		}
	}
	return false, nil
}

// writeAIConvs is the one writer; it does not prune. 0600 because the file
// holds the person's conversation text.
func writeAIConvs(convs []aiConversation) error {
	data, err := json.Marshal(convs)
	if err != nil {
		return err
	}
	return writeFileAtomic(aiConversationsFilePath(), data, 0600)
}

func aiDeleteAllConversations() error {
	aiStoreMu.Lock()
	defer aiStoreMu.Unlock()
	err := os.Remove(aiConversationsFilePath())
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

// aiUpdateProposal replaces the proposal only when its status is in from. The
// check and the write happen under aiStoreMu, which is what lets Apply run once.
// err != nil means the proposal was NOT claimed.
func aiUpdateProposal(id string, from []string, to aiProposal) (aiProposal, bool, error) {
	aiStoreMu.Lock()
	defer aiStoreMu.Unlock()
	convs := aiLoadConversations()
	for ci := range convs {
		for mi := range convs[ci].Messages {
			props := convs[ci].Messages[mi].Proposals
			for pi := range props {
				if props[pi].ID != id {
					continue
				}
				prev := props[pi]
				allowed := false
				for _, f := range from {
					if prev.Status == f {
						allowed = true
						break
					}
				}
				if !allowed {
					return prev, false, nil
				}
				to.ID = id
				props[pi] = to
				if err := writeAIConvs(convs); err != nil {
					return prev, false, err
				}
				return prev, true, nil
			}
		}
	}
	return aiProposal{}, false, nil
}

func aiFindProposal(id string) (aiProposal, bool) {
	aiStoreMu.Lock()
	defer aiStoreMu.Unlock()
	for _, c := range aiLoadConversations() {
		for _, m := range c.Messages {
			for _, p := range m.Proposals {
				if p.ID == id {
					return p, true
				}
			}
		}
	}
	return aiProposal{}, false
}
