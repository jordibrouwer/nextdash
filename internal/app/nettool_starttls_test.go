package app

import (
	"bufio"
	"context"
	"crypto/tls"
	"net"
	"strings"
	"testing"
	"time"
)

// serveStartTLS runs a plain-text server of proto on a free port that upgrades
// to TLS with cert when asked. refuse makes it say no to the upgrade. Each
// connection's first client line is sent on firstLine (when not nil).
func serveStartTLS(t *testing.T, proto string, cert tls.Certificate, refuse bool, firstLine chan<- string) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func() {
				defer c.Close()
				_ = c.SetDeadline(time.Now().Add(5 * time.Second))
				r := bufio.NewReader(c)
				w := func(s string) { _, _ = c.Write([]byte(s)) }
				read := func() string {
					l, _ := r.ReadString('\n')
					return strings.TrimRight(l, "\r\n")
				}
				var yes bool
				switch proto {
				case starttlsSMTP:
					w("220 mail.test ESMTP ready\r\n")
					l := read()
					if firstLine != nil {
						firstLine <- l
					}
					if !strings.HasPrefix(l, "EHLO") {
						return // e.g. a ClientHello: hang up like a strict server
					}
					w("250-mail.test\r\n250-SIZE 1000\r\n250 STARTTLS\r\n")
					if read() != "STARTTLS" {
						return
					}
					if refuse {
						w("454 TLS not available\r\n")
						return
					}
					w("220 go ahead\r\n")
					yes = true
				case starttlsIMAP:
					w("* OK [CAPABILITY IMAP4rev1 STARTTLS] ready\r\n")
					if l := read(); l == "nd1 STARTTLS" && !refuse {
						w("* NOTE untagged\r\nnd1 OK begin TLS\r\n")
						yes = true
					} else {
						w("nd1 BAD no\r\n")
					}
				case starttlsPOP3:
					w("+OK POP3 ready\r\n")
					if read() == "STLS" && !refuse {
						w("+OK begin TLS\r\n")
						yes = true
					} else {
						w("-ERR no\r\n")
					}
				case starttlsFTP:
					w("220 ProFTPD Server ready\r\n")
					if read() == "AUTH TLS" && !refuse {
						w("234 AUTH TLS ok\r\n")
						yes = true
					} else {
						w("500 no\r\n")
					}
				}
				if yes {
					_ = tls.Server(c, &tls.Config{Certificates: []tls.Certificate{cert}}).Handshake()
				}
			}()
		}
	}()
	return ln.Addr().(*net.TCPAddr).Port
}

func TestNetTLSStartTLSProtocols(t *testing.T) {
	ca := newTLSTestCA(t)
	cert := ca.issue(t, time.Now().Add(-time.Hour), time.Now().Add(60*24*time.Hour))
	for _, proto := range []string{starttlsSMTP, starttlsIMAP, starttlsPOP3, starttlsFTP} {
		t.Run(proto, func(t *testing.T) {
			port := serveStartTLS(t, proto, cert, false, nil)
			res := runTLSTest(t, netGuard{allowLocal: true, tlsRoots: ca.pool}, port, NetCheck{})
			if !res.OK || res.TLS == nil || !res.TLS.Valid || res.TLS.StartTLS != proto {
				t.Fatalf("%+v tls=%+v", res, res.TLS)
			}
			if !strings.Contains(res.Detail, proto+" STARTTLS") || !strings.Contains(res.Detail, "days left") {
				t.Errorf("detail = %q", res.Detail)
			}
		})
	}
}

// A well-known SMTP port must not send a ClientHello before the greeting.
func TestNetTLSStartTLSKnownPortTalksSMTPFirst(t *testing.T) {
	ca := newTLSTestCA(t)
	first := make(chan string, 4)
	port := serveStartTLS(t, starttlsSMTP, ca.issue(t, time.Now().Add(-time.Hour), time.Now().Add(60*24*time.Hour)), false, first)
	g := netGuard{allowLocal: true, tlsRoots: ca.pool}
	out, err := g.tlsInspectOnce(context.Background(), "127.0.0.1", port, "127.0.0.1", 3*time.Second, true, starttlsSMTP)
	if err != nil || out.StartTLS != starttlsSMTP || !out.Valid {
		t.Fatalf("err %v out %+v", err, out)
	}
	if l := <-first; !strings.HasPrefix(l, "EHLO") {
		t.Errorf("first client line = %q", l)
	}
	if len(first) != 0 {
		t.Errorf("more than one connection: %d", len(first))
	}
}

func TestNetStartTLSProtoPorts(t *testing.T) {
	want := map[int]string{25: starttlsSMTP, 587: starttlsSMTP, 2525: starttlsSMTP, 143: starttlsIMAP,
		110: starttlsPOP3, 21: starttlsFTP, 443: "", 465: "", 993: "", 995: ""}
	for port, proto := range want {
		if got := netStartTLSProto(port); got != proto {
			t.Errorf("port %d = %q, want %q", port, got, proto)
		}
	}
}

func TestNetTLSStartTLSRefused(t *testing.T) {
	ca := newTLSTestCA(t)
	port := serveStartTLS(t, starttlsSMTP, ca.issue(t, time.Now().Add(-time.Hour), time.Now().Add(60*24*time.Hour)), true, nil)
	res := runTLSTest(t, netGuard{allowLocal: true, tlsRoots: ca.pool}, port, NetCheck{})
	if res.OK || res.Class != "tls" || res.TLS != nil || !strings.Contains(res.Error, "did not accept STARTTLS") ||
		!strings.Contains(res.Error, "454") {
		t.Fatalf("%+v", res)
	}
}

func TestNetTLSStartTLSUntrustedShowsChain(t *testing.T) {
	port := serveStartTLS(t, starttlsIMAP, selfSignedTLSCert(t), false, nil)
	res := runTLSTest(t, netGuard{allowLocal: true, tlsRoots: newTLSTestCA(t).pool}, port, NetCheck{})
	if res.OK || res.Class != "tls" || res.TLS == nil || len(res.TLS.Chain) == 0 || res.Detail != "not trusted" {
		t.Fatalf("%+v tls=%+v", res, res.TLS)
	}
}
