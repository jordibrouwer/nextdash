package app

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"math"
)

/*
A bookmark icon is drawn at 16 to 64 CSS pixels, so a stored picture larger than
a few times that is bytes nobody sees. Sites hand over what they have: a
512x512 PNG of 324 KB, a favicon.ico holding six sizes up to 256. Both were
saved as they came, and every dashboard that shows the bookmark downloads them.

saveIconBytes passes what it is about to write through shrinkIconBytes. Only a
picture that gets smaller is changed; anything this cannot read, or cannot make
smaller, is stored exactly as it arrived.
*/

// iconMaxEdge is the longest side a stored raster icon keeps. Three times the
// largest size it is drawn at, so a 2x screen is sharp with room to spare.
const iconMaxEdge = 192

// iconMaxPixels refuses to decode a picture that would unpack to more than this
// many pixels: a small file can declare a huge canvas, and 2048 square is
// already 16 MB as NRGBA. Larger ones are stored as they arrived.
const iconMaxPixels = 2048 * 2048

// iconIcoWanted is the entry of an .ico that is kept: the smallest one at least
// this wide, or the widest there is.
const iconIcoWanted = 64

func shrinkIconBytes(data []byte, ext string) ([]byte, string) {
	original, originalExt := data, ext
	if ext == ".ico" {
		inner := pngFromICO(data)
		if inner == nil {
			return original, originalExt // BMP entries: left as they are
		}
		data, ext = inner, ".png"
	}
	if ext != ".png" && ext != ".jpg" {
		return original, originalExt // GIFs may move; SVG is already vector; WebP has no decoder here
	}

	// An animated PNG would be flattened to its first frame, and a JPEG turned
	// by its EXIF orientation would come out sideways: both are left alone.
	if (ext == ".png" && bytes.Contains(data, []byte("acTL"))) || (ext == ".jpg" && jpegIsRotated(data)) {
		return original, originalExt
	}

	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || cfg.Width <= 0 || cfg.Height <= 0 || cfg.Width*cfg.Height > iconMaxPixels {
		return original, originalExt
	}
	if cfg.Width > iconMaxEdge || cfg.Height > iconMaxEdge {
		img, _, err := image.Decode(bytes.NewReader(data))
		if err != nil {
			return original, originalExt
		}
		w, h := cfg.Width, cfg.Height
		if w >= h {
			h = max(1, int(math.Round(float64(h)*iconMaxEdge/float64(w))))
			w = iconMaxEdge
		} else {
			w = max(1, int(math.Round(float64(w)*iconMaxEdge/float64(h))))
			h = iconMaxEdge
		}
		small := boxResize(img, w, h)
		var out bytes.Buffer
		if ext == ".jpg" {
			err = jpeg.Encode(&out, small, &jpeg.Options{Quality: 88})
		} else {
			err = (&png.Encoder{CompressionLevel: png.BestCompression}).Encode(&out, small)
		}
		if err != nil {
			return original, originalExt
		}
		data = out.Bytes()
	}
	if len(data) >= len(original) {
		return original, originalExt
	}
	return data, ext
}

// pngFromICO is the PNG inside the .ico entry worth keeping, or nil when the
// file is not an .ico or that entry is a bitmap.
func pngFromICO(data []byte) []byte {
	if len(data) < 6 || binary.LittleEndian.Uint16(data[0:2]) != 0 || binary.LittleEndian.Uint16(data[2:4]) != 1 {
		return nil
	}
	count := int(binary.LittleEndian.Uint16(data[4:6]))
	if count == 0 || 6+count*16 > len(data) {
		return nil
	}
	bestWidth, bestOff, bestSize := -1, 0, 0
	for i := 0; i < count; i++ {
		e := data[6+i*16 : 6+(i+1)*16]
		width := int(e[0])
		if width == 0 {
			width = 256
		}
		size := int(binary.LittleEndian.Uint32(e[8:12]))
		off := int(binary.LittleEndian.Uint32(e[12:16]))
		if size <= 0 || off < 0 || off+size > len(data) {
			continue
		}
		if bestWidth < 0 || preferIcoWidth(width, bestWidth) {
			bestWidth, bestOff, bestSize = width, off, size
		}
	}
	if bestWidth < 0 {
		return nil
	}
	entry := data[bestOff : bestOff+bestSize]
	if !bytes.HasPrefix(entry, []byte("\x89PNG\r\n\x1a\n")) {
		return nil
	}
	return entry
}

// preferIcoWidth: the smallest width that reaches iconIcoWanted, else the widest.
func preferIcoWidth(candidate, current int) bool {
	switch {
	case candidate >= iconIcoWanted && current >= iconIcoWanted:
		return candidate < current
	case candidate >= iconIcoWanted:
		return true
	case current >= iconIcoWanted:
		return false
	}
	return candidate > current
}

// boxResize averages the source pixels each destination pixel covers, with
// colour weighted by alpha so a transparent edge does not darken the picture.
func boxResize(src image.Image, w, h int) *image.NRGBA {
	b := src.Bounds()
	sw, sh := b.Dx(), b.Dy()
	dst := image.NewNRGBA(image.Rect(0, 0, w, h))
	xs, ys := float64(sw)/float64(w), float64(sh)/float64(h)
	for dy := 0; dy < h; dy++ {
		y0, y1 := float64(dy)*ys, float64(dy+1)*ys
		for dx := 0; dx < w; dx++ {
			x0, x1 := float64(dx)*xs, float64(dx+1)*xs
			var r, g, bl, a, total float64
			for sy := int(y0); sy < sh && float64(sy) < y1; sy++ {
				wy := math.Min(float64(sy+1), y1) - math.Max(float64(sy), y0)
				for sx := int(x0); sx < sw && float64(sx) < x1; sx++ {
					wx := math.Min(float64(sx+1), x1) - math.Max(float64(sx), x0)
					weight := wx * wy
					pr, pg, pb, pa := src.At(b.Min.X+sx, b.Min.Y+sy).RGBA() // premultiplied
					r += float64(pr) * weight
					g += float64(pg) * weight
					bl += float64(pb) * weight
					a += float64(pa) * weight
					total += weight
				}
			}
			if total == 0 || a == 0 {
				continue
			}
			dst.SetNRGBA(dx, dy, color.NRGBA{
				R: clampByte(r / a * 255),
				G: clampByte(g / a * 255),
				B: clampByte(bl / a * 255),
				A: clampByte(a / total / 65535 * 255),
			})
		}
	}
	return dst
}

func clampByte(v float64) uint8 {
	return uint8(math.Max(0, math.Min(255, math.Round(v))))
}

// jpegIsRotated is true when the file's EXIF block asks for an orientation
// other than the upright one. Go's decoder ignores the tag, and the re-encode
// would drop it, so the picture would be stored the wrong way up.
func jpegIsRotated(data []byte) bool {
	if len(data) < 4 || data[0] != 0xFF || data[1] != 0xD8 {
		return false
	}
	for i := 2; i+4 <= len(data); {
		if data[i] != 0xFF {
			return false
		}
		marker := data[i+1]
		if marker == 0xDA || marker == 0xD9 { // start of scan, end of image
			return false
		}
		size := int(binary.BigEndian.Uint16(data[i+2 : i+4]))
		if size < 2 || i+2+size > len(data) {
			return false
		}
		seg := data[i+4 : i+2+size]
		if marker == 0xE1 && bytes.HasPrefix(seg, []byte("Exif\x00\x00")) {
			return exifOrientation(seg[6:]) > 1
		}
		i += 2 + size
	}
	return false
}

// exifOrientation reads tag 0x0112 from the first directory of a TIFF block, or
// 0 when there is none.
func exifOrientation(tiff []byte) int {
	if len(tiff) < 8 {
		return 0
	}
	var order binary.ByteOrder
	switch string(tiff[:2]) {
	case "II":
		order = binary.LittleEndian
	case "MM":
		order = binary.BigEndian
	default:
		return 0
	}
	ifd := int(order.Uint32(tiff[4:8]))
	if ifd < 8 || ifd+2 > len(tiff) {
		return 0
	}
	count := int(order.Uint16(tiff[ifd : ifd+2]))
	for n := 0; n < count; n++ {
		at := ifd + 2 + n*12
		if at+12 > len(tiff) {
			return 0
		}
		if order.Uint16(tiff[at:at+2]) == 0x0112 {
			return int(order.Uint16(tiff[at+8 : at+10]))
		}
	}
	return 0
}
