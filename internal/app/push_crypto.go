package app

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/asn1"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/url"
	"strings"
	"time"
)

// Web Push encryption and VAPID signing, implemented against the RFCs directly
// rather than pulling in a library: the whole scheme is ECDH + HKDF + AES-GCM
// plus an ES256 JWT, all of which Go 1.24's standard library covers. nextDash
// ships with a single dependency (gorilla/mux) and this keeps it that way.
//
//	RFC 8291 — Message Encryption for Web Push (aes128gcm)
//	RFC 8188 — Encrypted Content-Encoding for HTTP
//	RFC 8292 — VAPID: voluntary application server identification
const (
	// pushSaltLength and pushKeyLength are fixed by RFC 8291.
	pushSaltLength = 16
	pushKeyLength  = 16
	pushNonceLen   = 12
	// pushRecordOverhead is the AES-GCM tag (16) plus the single padding
	// delimiter byte this implementation emits.
	pushRecordOverhead = 17
	// pushMaxPayload is the smallest payload every push service is required to
	// accept (4096 bytes) minus the aes128gcm framing overhead. Staying under it
	// means a notification is never rejected for size alone.
	pushMaxPayload = 3993
	// vapidTokenTTL is how long a signed VAPID JWT stays valid. RFC 8292 caps
	// this at 24h; a shorter window limits the damage from a leaked token while
	// still covering any single delivery.
	vapidTokenTTL = 12 * time.Hour
)

// b64 is the URL-safe, unpadded base64 that every Web Push field uses.
var b64 = base64.RawURLEncoding

// decodeB64 accepts both padded and unpadded URL-safe base64. Browsers emit the
// unpadded form, but subscriptions that have been round-tripped through other
// tooling sometimes carry padding, and rejecting those would be needless.
func decodeB64(s string) ([]byte, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil, errors.New("empty value")
	}
	// Tolerate the standard alphabet too: some clients serialize with +/ instead
	// of -_ and the bytes are identical once translated.
	s = strings.NewReplacer("+", "-", "/", "_").Replace(s)
	s = strings.TrimRight(s, "=")
	return b64.DecodeString(s)
}

// vapidKeys is the server's identity toward push services. The private key is
// an ES256 (P-256) signing key; the public key is what the browser pins when it
// subscribes, which is why rotating it invalidates every existing subscription.
type vapidKeys struct {
	// PrivateKey is the raw 32-byte scalar, base64url encoded.
	PrivateKey string `json:"privateKey"`
	// PublicKey is the uncompressed P-256 point (65 bytes), base64url encoded.
	// This is the applicationServerKey the frontend passes to subscribe().
	PublicKey string `json:"publicKey"`
	// CreatedAt records when the pair was generated, for display only.
	CreatedAt int64 `json:"createdAt"`
}

// generateVAPIDKeys creates a fresh P-256 signing pair.
func generateVAPIDKeys() (vapidKeys, error) {
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return vapidKeys{}, err
	}
	// The uncompressed point is the wire format Web Push requires, and
	// crypto/ecdh emits exactly that -- elliptic.Marshal, which used to do this,
	// has been deprecated since Go 1.21.
	ecdhPub, err := priv.PublicKey.ECDH()
	if err != nil {
		return vapidKeys{}, err
	}
	pub := ecdhPub.Bytes()
	// Left-pad the scalar to a full 32 bytes: a big.Int drops leading zeros and a
	// short key would fail to reconstruct.
	d := priv.D.FillBytes(make([]byte, 32))
	return vapidKeys{
		PrivateKey: b64.EncodeToString(d),
		PublicKey:  b64.EncodeToString(pub),
		CreatedAt:  time.Now().UnixMilli(),
	}, nil
}

// parseVAPIDPrivateKey rebuilds the signing key from the stored scalar.
func parseVAPIDPrivateKey(keys vapidKeys) (*ecdsa.PrivateKey, error) {
	raw, err := decodeB64(keys.PrivateKey)
	if err != nil {
		return nil, fmt.Errorf("invalid VAPID private key: %w", err)
	}
	if len(raw) != 32 {
		return nil, fmt.Errorf("invalid VAPID private key length %d", len(raw))
	}
	// NewPrivateKey does the range check this used to do by hand (0 < d < N) and
	// derives the public point, which is what ScalarBaseMult was here for before
	// Go 1.21 deprecated it.
	ecdhPriv, err := ecdh.P256().NewPrivateKey(raw)
	if err != nil {
		return nil, errors.New("VAPID private key out of range")
	}
	pub, err := p256PublicKeyFromPoint(ecdhPriv.PublicKey().Bytes())
	if err != nil {
		return nil, err
	}
	return &ecdsa.PrivateKey{PublicKey: *pub, D: new(big.Int).SetBytes(raw)}, nil
}

// p256PublicKeyFromPoint reads an uncompressed P-256 point -- the 65-byte form
// Web Push puts on the wire -- back into a signing-side public key.
//
// Routed through crypto/ecdh rather than elliptic.Unmarshal, whose replacement
// it is: NewPublicKey rejects a point that is not on the curve, which the
// deprecated call did only as a side effect of returning nil coordinates.
func p256PublicKeyFromPoint(raw []byte) (*ecdsa.PublicKey, error) {
	point, err := ecdh.P256().NewPublicKey(raw)
	if err != nil {
		return nil, fmt.Errorf("invalid P-256 public key: %w", err)
	}
	b := point.Bytes()
	return &ecdsa.PublicKey{
		Curve: elliptic.P256(),
		X:     new(big.Int).SetBytes(b[1:33]),
		Y:     new(big.Int).SetBytes(b[33:65]),
	}, nil
}

// vapidAudience is the scheme+host of the push endpoint, which is what the JWT
// is scoped to. A token minted for one push service must not be replayable
// against another.
func vapidAudience(endpoint string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(endpoint))
	if err != nil {
		return "", err
	}
	if u.Scheme != "https" && u.Scheme != "http" {
		return "", fmt.Errorf("unsupported push endpoint scheme %q", u.Scheme)
	}
	if u.Host == "" {
		return "", errors.New("push endpoint has no host")
	}
	return u.Scheme + "://" + u.Host, nil
}

// signVAPIDToken builds the ES256 JWT that authenticates this server to the push
// service, and returns it with the base64url public key the header also needs.
//
// subject identifies the operator (a mailto: or https: URL). Push services use
// it to make contact when a server misbehaves; it is sent as-is.
func signVAPIDToken(keys vapidKeys, endpoint, subject string) (token string, publicKey string, err error) {
	priv, err := parseVAPIDPrivateKey(keys)
	if err != nil {
		return "", "", err
	}
	aud, err := vapidAudience(endpoint)
	if err != nil {
		return "", "", err
	}

	header := b64.EncodeToString([]byte(`{"typ":"JWT","alg":"ES256"}`))

	claims := map[string]any{
		"aud": aud,
		"exp": time.Now().Add(vapidTokenTTL).Unix(),
	}
	if subject = strings.TrimSpace(subject); subject != "" {
		claims["sub"] = subject
	}
	claimsJSON, err := json.Marshal(claims)
	if err != nil {
		return "", "", err
	}
	signingInput := header + "." + b64.EncodeToString(claimsJSON)

	digest := sha256.Sum256([]byte(signingInput))
	r, s, err := ecdsa.Sign(rand.Reader, priv, digest[:])
	if err != nil {
		return "", "", err
	}
	// JWS wants the raw r||s pair, fixed width — not the ASN.1 sequence that
	// ecdsa.SignASN1 produces.
	sig := make([]byte, 64)
	r.FillBytes(sig[:32])
	s.FillBytes(sig[32:])

	return signingInput + "." + b64.EncodeToString(sig), keys.PublicKey, nil
}

// ensure asn1 stays referenced if a future signer switches formats; keeping the
// import here documents that the raw r||s form above is a deliberate choice.
var _ = asn1.Marshal

// normalizeVAPIDSubject validates the operator contact stored in settings.
// RFC 8292 requires a mailto: or https: URL; anything else is dropped rather
// than sent, because a malformed claim makes some push services reject every
// delivery and an empty subject falls back to a valid default at send time.
func normalizeVAPIDSubject(subject string) string {
	subject = strings.TrimSpace(subject)
	if subject == "" {
		return ""
	}
	lower := strings.ToLower(subject)
	if strings.HasPrefix(lower, "mailto:") && strings.Contains(subject, "@") {
		return subject
	}
	if strings.HasPrefix(lower, "https://") {
		if u, err := url.Parse(subject); err == nil && u.Host != "" {
			return subject
		}
	}
	// A bare address is the most likely thing an operator types; accept it by
	// promoting it rather than discarding what they entered.
	if !strings.Contains(subject, ":") && strings.Contains(subject, "@") {
		return "mailto:" + subject
	}
	return ""
}

// encryptPushPayload encrypts plaintext for one subscription using the
// aes128gcm content encoding (RFC 8291 §3), returning a body ready to POST.
//
// p256dh is the subscription's public key and auth its shared secret, both as
// the browser reported them.
func encryptPushPayload(p256dh, auth string, plaintext []byte) ([]byte, error) {
	if len(plaintext) > pushMaxPayload {
		return nil, fmt.Errorf("push payload too large: %d bytes (max %d)", len(plaintext), pushMaxPayload)
	}

	clientPubRaw, err := decodeB64(p256dh)
	if err != nil {
		return nil, fmt.Errorf("invalid subscription key: %w", err)
	}
	authSecret, err := decodeB64(auth)
	if err != nil {
		return nil, fmt.Errorf("invalid subscription auth secret: %w", err)
	}
	if len(authSecret) != pushSaltLength {
		return nil, fmt.Errorf("invalid auth secret length %d", len(authSecret))
	}

	curve := ecdh.P256()
	clientPub, err := curve.NewPublicKey(clientPubRaw)
	if err != nil {
		return nil, fmt.Errorf("invalid subscription public key: %w", err)
	}

	// A fresh ephemeral pair per message: reusing it across messages would let a
	// push service correlate them and would weaken the derived keys.
	serverPriv, err := curve.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	serverPubRaw := serverPriv.PublicKey().Bytes()

	shared, err := serverPriv.ECDH(clientPub)
	if err != nil {
		return nil, fmt.Errorf("ECDH failed: %w", err)
	}

	salt := make([]byte, pushSaltLength)
	if _, err := rand.Read(salt); err != nil {
		return nil, err
	}

	// RFC 8291 §3.3: the auth secret mixes the ECDH output with both public keys
	// before the record keys are derived, binding the result to this exact pair.
	keyInfo := append([]byte("WebPush: info\x00"), clientPubRaw...)
	keyInfo = append(keyInfo, serverPubRaw...)
	ikm, err := hkdf.Key(sha256.New, shared, authSecret, string(keyInfo), 32)
	if err != nil {
		return nil, err
	}

	cek, err := hkdf.Key(sha256.New, ikm, salt, "Content-Encoding: aes128gcm\x00", pushKeyLength)
	if err != nil {
		return nil, err
	}
	nonce, err := hkdf.Key(sha256.New, ikm, salt, "Content-Encoding: nonce\x00", pushNonceLen)
	if err != nil {
		return nil, err
	}

	block, err := aes.NewCipher(cek)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	// A single record, so the padding delimiter is 0x02 ("last record"). 0x01
	// would mean another record follows and the client would wait for it.
	record := make([]byte, 0, len(plaintext)+1)
	record = append(record, plaintext...)
	record = append(record, 0x02)
	ciphertext := aead.Seal(nil, nonce, record, nil)

	// RFC 8188 §2.1 header: salt | record size | key id length | key id.
	// The key id is the server's ephemeral public key, which is how the client
	// recovers the shared secret.
	body := make([]byte, 0, pushSaltLength+4+1+len(serverPubRaw)+len(ciphertext))
	body = append(body, salt...)
	recordSize := make([]byte, 4)
	binary.BigEndian.PutUint32(recordSize, uint32(len(record)+pushRecordOverhead-1))
	body = append(body, recordSize...)
	body = append(body, byte(len(serverPubRaw)))
	body = append(body, serverPubRaw...)
	body = append(body, ciphertext...)

	return body, nil
}
