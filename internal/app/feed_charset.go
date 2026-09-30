package app

import (
	"bytes"
	"encoding/xml"
	"fmt"
	"io"
	"strings"
)

/*
decodeFeedXML unmarshals a feed that may declare a single-byte encoding.

encoding/xml reads UTF-8 only and refuses any other declared encoding outright
("CharsetReader is nil"), so a feed saying encoding="ISO-8859-1" -- common on
older European sites -- was "not a feed" in the RSS tile, a failure in Fresh,
and after five of those retired. Latin-1 and windows-1252 cover nearly all of
them and need no tables beyond the 32 characters where the two differ.
*/
func decodeFeedXML(raw []byte, v any) error {
	decoder := newFeedXMLDecoder(raw)
	return decoder.Decode(v)
}

// newFeedXMLDecoder is xml.NewDecoder over raw with feedCharsetReader set.
func newFeedXMLDecoder(raw []byte) *xml.Decoder {
	decoder := xml.NewDecoder(bytes.NewReader(raw))
	decoder.CharsetReader = feedCharsetReader
	return decoder
}

// windows1252High is what bytes 0x80-0x9F mean in windows-1252; in Latin-1
// they are C1 control characters. Unassigned positions stay as they are.
var windows1252High = [32]rune{
	'€', 0x81, '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', 0x8D, 'Ž', 0x8F,
	0x90, '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', 0x9D, 'ž', 'Ÿ',
}

func feedCharsetReader(label string, input io.Reader) (io.Reader, error) {
	switch strings.ToLower(strings.TrimSpace(label)) {
	case "utf-8", "utf8", "us-ascii", "ascii":
		return input, nil
	case "iso-8859-1", "iso8859-1", "latin1", "latin-1", "l1", "iso_8859-1",
		"windows-1252", "cp1252", "x-cp1252":
		raw, err := io.ReadAll(input)
		if err != nil {
			return nil, err
		}
		// Every Latin-1 feed in practice is windows-1252 with a smaller name:
		// curly quotes and dashes in 0x80-0x9F. Read both the same way.
		var out strings.Builder
		out.Grow(len(raw) + len(raw)/4)
		for _, b := range raw {
			switch {
			case b < 0x80:
				out.WriteByte(b)
			case b < 0xA0:
				out.WriteRune(windows1252High[b-0x80])
			default:
				out.WriteRune(rune(b))
			}
		}
		return strings.NewReader(out.String()), nil
	}
	return nil, fmt.Errorf("feed encoding %q is not supported", label)
}
