package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"math/big"
	"strings"
	"testing"
)

// newTestSubscriptionKeys builds a browser-side keypair the way a real
// PushSubscription would expose it, so the encryption path can be exercised end
// to end and actually decrypted again.
func newTestSubscriptionKeys(t *testing.T) (p256dh string, auth string, priv *ecdh.PrivateKey, authSecret []byte) {
	t.Helper()

	priv, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate subscription key: %v", err)
	}
	authSecret = make([]byte, pushSaltLength)
	if _, err := rand.Read(authSecret); err != nil {
		t.Fatalf("generate auth secret: %v", err)
	}
	return b64.EncodeToString(priv.PublicKey().Bytes()), b64.EncodeToString(authSecret), priv, authSecret
}

// decryptPushPayload is the client half of RFC 8291, used only by tests. If this
// can recover the plaintext, a real browser can too.
func decryptPushPayload(t *testing.T, body []byte, clientPriv *ecdh.PrivateKey, authSecret []byte) []byte {
	t.Helper()

	if len(body) < pushSaltLength+4+1 {
		t.Fatalf("body too short: %d bytes", len(body))
	}
	salt := body[:pushSaltLength]
	idLen := int(body[pushSaltLength+4])
	offset := pushSaltLength + 4 + 1
	if len(body) < offset+idLen {
		t.Fatalf("body truncated before key id")
	}
	serverPubRaw := body[offset : offset+idLen]
	ciphertext := body[offset+idLen:]

	serverPub, err := ecdh.P256().NewPublicKey(serverPubRaw)
	if err != nil {
		t.Fatalf("parse server public key: %v", err)
	}
	shared, err := clientPriv.ECDH(serverPub)
	if err != nil {
		t.Fatalf("client ECDH: %v", err)
	}

	keyInfo := append([]byte("WebPush: info\x00"), clientPriv.PublicKey().Bytes()...)
	keyInfo = append(keyInfo, serverPubRaw...)
	ikm, err := hkdf.Key(sha256.New, shared, authSecret, string(keyInfo), 32)
	if err != nil {
		t.Fatalf("derive ikm: %v", err)
	}
	cek, err := hkdf.Key(sha256.New, ikm, salt, "Content-Encoding: aes128gcm\x00", pushKeyLength)
	if err != nil {
		t.Fatalf("derive cek: %v", err)
	}
	nonce, err := hkdf.Key(sha256.New, ikm, salt, "Content-Encoding: nonce\x00", pushNonceLen)
	if err != nil {
		t.Fatalf("derive nonce: %v", err)
	}

	block, err := aes.NewCipher(cek)
	if err != nil {
		t.Fatalf("aes: %v", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatalf("gcm: %v", err)
	}
	plain, err := aead.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	// Strip the padding delimiter the encoder appended.
	if len(plain) == 0 {
		t.Fatal("decrypted record is empty")
	}
	return plain[:len(plain)-1]
}

// The core guarantee: what the server encrypts, a browser can decrypt. A change
// that breaks the key derivation or the record framing shows up here rather than
// as silently undelivered notifications.
func TestEncryptPushPayloadRoundTrip(t *testing.T) {
	p256dh, auth, clientPriv, authSecret := newTestSubscriptionKeys(t)

	want := []byte(`{"title":"nextDash","body":"example.com is offline"}`)
	body, err := encryptPushPayload(p256dh, auth, want)
	if err != nil {
		t.Fatalf("encryptPushPayload: %v", err)
	}

	got := decryptPushPayload(t, body, clientPriv, authSecret)
	if string(got) != string(want) {
		t.Errorf("round trip mismatch:\n got %q\nwant %q", got, want)
	}
}

// The aes128gcm header must describe the record exactly, or clients reject it.
func TestEncryptPushPayloadHeader(t *testing.T) {
	p256dh, auth, _, _ := newTestSubscriptionKeys(t)

	plaintext := []byte("hello")
	body, err := encryptPushPayload(p256dh, auth, plaintext)
	if err != nil {
		t.Fatalf("encryptPushPayload: %v", err)
	}

	if got := int(body[pushSaltLength+4]); got != 65 {
		t.Errorf("key id length = %d, want 65 (uncompressed P-256 point)", got)
	}

	recordSize := binary.BigEndian.Uint32(body[pushSaltLength : pushSaltLength+4])
	// Record size must cover the padded plaintext plus the GCM tag; anything
	// smaller and a client stops reading early.
	wantMin := uint32(len(plaintext) + 1 + 16)
	if recordSize < wantMin {
		t.Errorf("record size = %d, want at least %d", recordSize, wantMin)
	}

	// Two encryptions of the same input must differ: the salt and the ephemeral
	// key are per-message, and reusing either would be a real cryptographic flaw.
	other, err := encryptPushPayload(p256dh, auth, plaintext)
	if err != nil {
		t.Fatalf("second encryptPushPayload: %v", err)
	}
	if string(body) == string(other) {
		t.Error("two encryptions produced identical output; salt or ephemeral key is being reused")
	}
}

func TestEncryptPushPayloadRejectsBadInput(t *testing.T) {
	p256dh, auth, _, _ := newTestSubscriptionKeys(t)

	tests := []struct {
		name    string
		p256dh  string
		auth    string
		payload []byte
	}{
		{"invalid public key", "not-base64!!", auth, []byte("x")},
		{"invalid auth secret", p256dh, "not-base64!!", []byte("x")},
		{"short auth secret", p256dh, b64.EncodeToString([]byte("tooshort")), []byte("x")},
		{"oversized payload", p256dh, auth, make([]byte, pushMaxPayload+1)},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := encryptPushPayload(tc.p256dh, tc.auth, tc.payload); err == nil {
				t.Error("expected an error, got nil")
			}
		})
	}
}

// A payload at the documented ceiling must still encrypt: the limit exists so
// push services never reject a message for size, and an off-by-one here would
// silently drop the largest legitimate notifications.
func TestEncryptPushPayloadAcceptsMaxSize(t *testing.T) {
	p256dh, auth, clientPriv, authSecret := newTestSubscriptionKeys(t)

	payload := make([]byte, pushMaxPayload)
	for i := range payload {
		payload[i] = 'a'
	}
	body, err := encryptPushPayload(p256dh, auth, payload)
	if err != nil {
		t.Fatalf("encryptPushPayload at max size: %v", err)
	}
	// 4096 is the smallest body every push service must accept.
	if len(body) > 4096 {
		t.Errorf("encrypted body = %d bytes, exceeds the 4096-byte floor", len(body))
	}
	if got := decryptPushPayload(t, body, clientPriv, authSecret); len(got) != pushMaxPayload {
		t.Errorf("round trip length = %d, want %d", len(got), pushMaxPayload)
	}
}

func TestGenerateAndParseVAPIDKeys(t *testing.T) {
	keys, err := generateVAPIDKeys()
	if err != nil {
		t.Fatalf("generateVAPIDKeys: %v", err)
	}

	pub, err := decodeB64(keys.PublicKey)
	if err != nil {
		t.Fatalf("decode public key: %v", err)
	}
	if len(pub) != 65 || pub[0] != 4 {
		t.Errorf("public key is not an uncompressed P-256 point: len=%d first=%d", len(pub), pub[0])
	}

	priv, err := parseVAPIDPrivateKey(keys)
	if err != nil {
		t.Fatalf("parseVAPIDPrivateKey: %v", err)
	}
	// The parsed private key must regenerate the same public point, or the token
	// would be signed by a key the push service cannot match to k=.
	want, err := p256PublicKeyFromPoint(pub)
	if err != nil {
		t.Fatalf("p256PublicKeyFromPoint: %v", err)
	}
	if priv.PublicKey.X.Cmp(want.X) != 0 || priv.PublicKey.Y.Cmp(want.Y) != 0 {
		t.Error("parsed private key does not match the stored public key")
	}
}

func TestParseVAPIDPrivateKeyRejectsBadKeys(t *testing.T) {
	tests := []struct {
		name string
		key  string
	}{
		{"not base64", "!!!"},
		{"wrong length", b64.EncodeToString([]byte("short"))},
		{"zero scalar", b64.EncodeToString(make([]byte, 32))},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := parseVAPIDPrivateKey(vapidKeys{PrivateKey: tc.key}); err == nil {
				t.Error("expected an error, got nil")
			}
		})
	}
}

// The JWT must verify under the advertised public key and carry the claims the
// push service checks, or every delivery is rejected with 401.
func TestSignVAPIDTokenVerifies(t *testing.T) {
	keys, err := generateVAPIDKeys()
	if err != nil {
		t.Fatalf("generateVAPIDKeys: %v", err)
	}

	token, publicKey, err := signVAPIDToken(keys, "https://fcm.googleapis.com/fcm/send/abc123", "mailto:admin@example.com")
	if err != nil {
		t.Fatalf("signVAPIDToken: %v", err)
	}
	if publicKey != keys.PublicKey {
		t.Errorf("returned public key = %q, want %q", publicKey, keys.PublicKey)
	}

	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		t.Fatalf("token has %d segments, want 3", len(parts))
	}

	var claims struct {
		Aud string `json:"aud"`
		Sub string `json:"sub"`
		Exp int64  `json:"exp"`
	}
	claimsJSON, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatalf("decode claims: %v", err)
	}
	if err := json.Unmarshal(claimsJSON, &claims); err != nil {
		t.Fatalf("parse claims: %v", err)
	}
	// The audience must be origin-only: a token scoped to a full path would be
	// rejected, and one scoped too broadly would be replayable elsewhere.
	if claims.Aud != "https://fcm.googleapis.com" {
		t.Errorf("aud = %q, want the endpoint origin", claims.Aud)
	}
	if claims.Sub != "mailto:admin@example.com" {
		t.Errorf("sub = %q", claims.Sub)
	}
	if claims.Exp <= 0 {
		t.Error("exp must be set")
	}

	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		t.Fatalf("decode signature: %v", err)
	}
	if len(sig) != 64 {
		t.Fatalf("signature is %d bytes, want the 64-byte raw r||s form", len(sig))
	}

	pubBytes, _ := decodeB64(publicKey)
	pub, err := p256PublicKeyFromPoint(pubBytes)
	if err != nil {
		t.Fatalf("p256PublicKeyFromPoint: %v", err)
	}
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	r := new(big.Int).SetBytes(sig[:32])
	s := new(big.Int).SetBytes(sig[32:])
	if !ecdsa.Verify(pub, digest[:], r, s) {
		t.Error("signature does not verify under the advertised public key")
	}
}

func TestSignVAPIDTokenRejectsBadEndpoint(t *testing.T) {
	keys, err := generateVAPIDKeys()
	if err != nil {
		t.Fatalf("generateVAPIDKeys: %v", err)
	}
	for _, endpoint := range []string{"", "not a url", "ftp://example.com/x", "https://"} {
		if _, _, err := signVAPIDToken(keys, endpoint, "mailto:a@b.c"); err == nil {
			t.Errorf("endpoint %q: expected an error, got nil", endpoint)
		}
	}
}

// An omitted subject must not leave an empty "sub" in the claims: some push
// services reject that outright, which is worse than not sending the field.
func TestSignVAPIDTokenOmitsEmptySubject(t *testing.T) {
	keys, err := generateVAPIDKeys()
	if err != nil {
		t.Fatalf("generateVAPIDKeys: %v", err)
	}
	token, _, err := signVAPIDToken(keys, "https://push.example.com/x", "   ")
	if err != nil {
		t.Fatalf("signVAPIDToken: %v", err)
	}
	claimsJSON, err := base64.RawURLEncoding.DecodeString(strings.Split(token, ".")[1])
	if err != nil {
		t.Fatalf("decode claims: %v", err)
	}
	var claims map[string]any
	if err := json.Unmarshal(claimsJSON, &claims); err != nil {
		t.Fatalf("parse claims: %v", err)
	}
	if _, ok := claims["sub"]; ok {
		t.Error("sub should be omitted when no subject is configured")
	}
}

func TestNormalizeVAPIDSubject(t *testing.T) {
	tests := []struct {
		in   string
		want string
	}{
		{"", ""},
		{"  ", ""},
		{"mailto:admin@example.com", "mailto:admin@example.com"},
		{"https://example.com/contact", "https://example.com/contact"},
		{"admin@example.com", "mailto:admin@example.com"},
		{"http://example.com", ""},
		{"nonsense", ""},
		{"mailto:notanaddress", ""},
	}
	for _, tc := range tests {
		if got := normalizeVAPIDSubject(tc.in); got != tc.want {
			t.Errorf("normalizeVAPIDSubject(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestDecodeB64AcceptsPaddedAndStandard(t *testing.T) {
	raw := []byte("some binary value")
	for name, encoded := range map[string]string{
		"raw url":     base64.RawURLEncoding.EncodeToString(raw),
		"padded url":  base64.URLEncoding.EncodeToString(raw),
		"padded std":  base64.StdEncoding.EncodeToString(raw),
		"standard":    base64.StdEncoding.EncodeToString(raw),
		"whitespaced": "  " + base64.RawURLEncoding.EncodeToString(raw) + "  ",
	} {
		got, err := decodeB64(encoded)
		if err != nil {
			t.Errorf("%s: unexpected error: %v", name, err)
			continue
		}
		if string(got) != string(raw) {
			t.Errorf("%s: decoded %q, want %q", name, got, raw)
		}
	}
}
