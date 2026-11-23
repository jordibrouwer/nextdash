package app

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"net"
	"strings"
)

// STARTTLS: a mail or file-transfer port speaks plain text first and upgrades
// to TLS on request. The TLS check does that upgrade before the handshake, so
// a certificate on port 25, 587, 143, 110 or 21 is read like one on 443.

const (
	starttlsSMTP = "SMTP"
	starttlsIMAP = "IMAP"
	starttlsPOP3 = "POP3"
	starttlsFTP  = "FTP"

	// starttlsMaxLine and starttlsMaxLines bound what is read of the plain-text
	// conversation, so a server that never stops talking cannot hold the check.
	starttlsMaxLine  = 1024
	starttlsMaxLines = 64
)

// netStartTLSProto is the STARTTLS protocol of a well-known plain-text port, or
// "" for a port that is expected to speak TLS straight away. These ports go
// through STARTTLS without first trying a TLS handshake: an SMTP server with a
// pregreet test (postscreen) penalises a client that talks before the greeting.
func netStartTLSProto(port int) string {
	switch port {
	case 25, 587, 2525:
		return starttlsSMTP
	case 143:
		return starttlsIMAP
	case 110:
		return starttlsPOP3
	case 21:
		return starttlsFTP
	}
	return ""
}

// starttlsFromGreeting picks the protocol from a server's first line, for a
// port that is not in the well-known list but greeted in plain text.
func starttlsFromGreeting(line string) string {
	switch {
	case strings.HasPrefix(line, "* OK"):
		return starttlsIMAP
	case strings.HasPrefix(line, "+OK"):
		return starttlsPOP3
	case strings.HasPrefix(line, "220"):
		if strings.Contains(strings.ToUpper(line), "FTP") {
			return starttlsFTP
		}
		return starttlsSMTP
	}
	return ""
}

// starttlsGreetingLooksPlain is true when the first bytes a server sent instead
// of a TLS record are the start of a mail or FTP greeting.
func starttlsGreetingLooksPlain(header [5]byte) bool {
	s := string(header[:])
	return strings.HasPrefix(s, "220") || strings.HasPrefix(s, "* OK") || strings.HasPrefix(s, "+OK")
}

// errStartTLSRefused is a server that answered the upgrade request with
// anything but yes; the message carries its reply.
var errStartTLSRefused = errors.New("STARTTLS refused")

// starttlsConv is the plain-text side of the conversation.
type starttlsConv struct {
	conn net.Conn
	r    *bufio.Reader
}

func (c *starttlsConv) line() (string, error) {
	var b strings.Builder
	for {
		chunk, isPrefix, err := c.r.ReadLine()
		if err != nil {
			if errors.Is(err, io.EOF) {
				return "", errors.New("the server closed the connection before STARTTLS")
			}
			return "", err
		}
		if b.Len()+len(chunk) > starttlsMaxLine {
			return "", errors.New("the server sent a line that is too long")
		}
		b.Write(chunk)
		if !isPrefix {
			return b.String(), nil
		}
	}
}

// reply reads one reply in the SMTP/FTP style: "code-text" lines until a
// "code text" line. It returns the last line.
func (c *starttlsConv) reply() (string, error) {
	for i := 0; i < starttlsMaxLines; i++ {
		l, err := c.line()
		if err != nil {
			return "", err
		}
		if len(l) < 4 || l[3] != '-' {
			return l, nil
		}
	}
	return "", errors.New("the server sent too many lines")
}

func (c *starttlsConv) send(s string) error {
	_, err := io.WriteString(c.conn, s+"\r\n")
	return err
}

// expect sends cmd and checks the reply starts with want.
func (c *starttlsConv) expect(cmd, want string, read func() (string, error)) error {
	if err := c.send(cmd); err != nil {
		return err
	}
	l, err := read()
	if err != nil {
		return err
	}
	if !strings.HasPrefix(l, want) {
		return fmt.Errorf("%w: %s answered %q", errStartTLSRefused, cmd, netCutName(l))
	}
	return nil
}

// netStartTLS runs the plain-text part of the conversation on conn until the
// server agrees to start TLS. proto "" reads the greeting and picks the
// protocol from it. It returns the protocol used. Nothing the server sends
// after its yes is read, so the TLS handshake starts on a clean connection.
func netStartTLS(conn net.Conn, proto string) (string, error) {
	c := &starttlsConv{conn: conn, r: bufio.NewReaderSize(conn, starttlsMaxLine)}
	greeting, err := c.reply()
	if err != nil {
		return proto, err
	}
	if proto == "" {
		if proto = starttlsFromGreeting(greeting); proto == "" {
			return "", netTLSError{fmt.Errorf("the server greeting %q is not one of SMTP, IMAP, POP3 or FTP", netCutName(greeting))}
		}
	}
	switch proto {
	case starttlsSMTP:
		if !strings.HasPrefix(greeting, "220") {
			return proto, fmt.Errorf("%w: the SMTP greeting was %q", errStartTLSRefused, netCutName(greeting))
		}
		if err = c.expect("EHLO nextdash.local", "250", c.reply); err == nil {
			err = c.expect("STARTTLS", "220", c.reply)
		}
	case starttlsFTP:
		if !strings.HasPrefix(greeting, "220") {
			return proto, fmt.Errorf("%w: the FTP greeting was %q", errStartTLSRefused, netCutName(greeting))
		}
		err = c.expect("AUTH TLS", "234", c.reply)
	case starttlsIMAP:
		if !strings.HasPrefix(greeting, "* OK") {
			return proto, fmt.Errorf("%w: the IMAP greeting was %q", errStartTLSRefused, netCutName(greeting))
		}
		err = c.expect("nd1 STARTTLS", "nd1 OK", func() (string, error) {
			for i := 0; i < starttlsMaxLines; i++ { // skip untagged lines
				l, err := c.line()
				if err != nil || strings.HasPrefix(l, "nd1 ") {
					return l, err
				}
			}
			return "", errors.New("the server sent too many lines")
		})
	case starttlsPOP3:
		if !strings.HasPrefix(greeting, "+OK") {
			return proto, fmt.Errorf("%w: the POP3 greeting was %q", errStartTLSRefused, netCutName(greeting))
		}
		err = c.expect("STLS", "+OK", c.line)
	}
	if err == nil && c.r.Buffered() > 0 {
		err = errors.New("the server sent data after agreeing to STARTTLS")
	}
	if err != nil {
		var ne net.Error
		if errors.As(err, &ne) {
			return proto, err // a time-out stays a time-out
		}
		return proto, netTLSError{err}
	}
	return proto, nil
}
