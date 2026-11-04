package app

import (
	"bytes"
	"encoding/binary"
	"hash/crc32"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"math/rand"
	"os"
	"path/filepath"
	"testing"
)

// noisePNG is a picture that does not compress, like a photographic icon.
func noisePNG(t *testing.T, w, h int, alpha uint8) []byte {
	t.Helper()
	rng := rand.New(rand.NewSource(1))
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for i := range img.Pix {
		img.Pix[i] = uint8(rng.Intn(256))
	}
	for i := 3; i < len(img.Pix); i += 4 {
		img.Pix[i] = alpha
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func sizeOf(t *testing.T, data []byte) (int, int) {
	t.Helper()
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("not an image: %v", err)
	}
	return cfg.Width, cfg.Height
}

func TestShrinkIconBringsALargePNGDown(t *testing.T) {
	in := noisePNG(t, 512, 512, 255)
	out, ext := shrinkIconBytes(in, ".png")
	if ext != ".png" {
		t.Fatalf("ext = %q", ext)
	}
	if w, h := sizeOf(t, out); w != iconMaxEdge || h != iconMaxEdge {
		t.Fatalf("size = %dx%d, want %d square", w, h, iconMaxEdge)
	}
	if len(out) >= len(in)/3 {
		t.Errorf("%d B from %d B: saved too little", len(out), len(in))
	}
}

func TestShrinkIconKeepsTheShapeAndTheTransparency(t *testing.T) {
	// 400x200, half transparent: the long side shrinks, the other follows.
	out, _ := shrinkIconBytes(noisePNG(t, 400, 200, 128), ".png")
	if w, h := sizeOf(t, out); w != iconMaxEdge || h != iconMaxEdge/2 {
		t.Fatalf("size = %dx%d, want %dx%d", w, h, iconMaxEdge, iconMaxEdge/2)
	}
	img, err := png.Decode(bytes.NewReader(out))
	if err != nil {
		t.Fatal(err)
	}
	if a := color.NRGBAModel.Convert(img.At(10, 10)).(color.NRGBA).A; a < 120 || a > 136 {
		t.Errorf("alpha = %d, want about 128", a)
	}
}

func TestShrinkIconLeavesWhatIsAlreadySmallOrUnreadable(t *testing.T) {
	small := noisePNG(t, 64, 64, 255)
	if out, ext := shrinkIconBytes(small, ".png"); !bytes.Equal(out, small) || ext != ".png" {
		t.Error("a 64 px icon was rewritten")
	}
	for _, c := range []struct {
		name string
		data []byte
		ext  string
	}{
		{"truncated", noisePNG(t, 512, 512, 255)[:300], ".png"},
		{"svg", []byte(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"/>`), ".svg"},
		{"gif", []byte("GIF89a"), ".gif"},
		{"not a picture", []byte("hello"), ".png"},
	} {
		if out, ext := shrinkIconBytes(c.data, c.ext); !bytes.Equal(out, c.data) || ext != c.ext {
			t.Errorf("%s: changed", c.name)
		}
	}
}

// ico builds an .ico whose entries are the given PNGs.
func ico(entries ...[]byte) []byte {
	var b bytes.Buffer
	b.Write([]byte{0, 0, 1, 0, byte(len(entries)), 0})
	off := 6 + 16*len(entries)
	for _, e := range entries {
		w, _ := func() (int, int) {
			cfg, _, _ := image.DecodeConfig(bytes.NewReader(e))
			return cfg.Width, cfg.Height
		}()
		wb := byte(w)
		if w >= 256 {
			wb = 0
		}
		b.Write([]byte{wb, wb, 0, 0, 1, 0, 32, 0})
		binary.Write(&b, binary.LittleEndian, uint32(len(e)))
		binary.Write(&b, binary.LittleEndian, uint32(off))
		off += len(e)
	}
	for _, e := range entries {
		b.Write(e)
	}
	return b.Bytes()
}

func TestShrinkIconKeepsOneSizeOfAnIco(t *testing.T) {
	in := ico(noisePNG(t, 16, 16, 255), noisePNG(t, 32, 32, 255), noisePNG(t, 64, 64, 255), noisePNG(t, 128, 128, 255), noisePNG(t, 256, 256, 255))
	out, ext := shrinkIconBytes(in, ".ico")
	if ext != ".png" {
		t.Fatalf("ext = %q, want the chosen entry as a png", ext)
	}
	if w, _ := sizeOf(t, out); w != 64 {
		t.Errorf("kept the %d px entry, want the smallest of 64 or more", w)
	}
	if len(out) >= len(in)/4 {
		t.Errorf("%d B from %d B", len(out), len(in))
	}
}

func TestShrinkIconTakesTheWidestWhenNoneReachesTheWantedSize(t *testing.T) {
	out, _ := shrinkIconBytes(ico(noisePNG(t, 16, 16, 255), noisePNG(t, 32, 32, 255)), ".ico")
	if w, _ := sizeOf(t, out); w != 32 {
		t.Errorf("kept %d px, want 32", w)
	}
}

func TestShrinkIconLeavesABitmapIcoAlone(t *testing.T) {
	bmp := append([]byte{0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0, 40, 0, 0, 0, 22, 0, 0, 0}, make([]byte, 40)...)
	if out, ext := shrinkIconBytes(bmp, ".ico"); !bytes.Equal(out, bmp) || ext != ".ico" {
		t.Error("an .ico of bitmaps was rewritten")
	}
}

// The way icons really arrive: through saveIconBytes, onto disk.
func TestSavedIconIsTheShrunkOne(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	name, err := saveIconBytes(noisePNG(t, 512, 512, 255), ".png")
	if err != nil || name == "" {
		t.Fatalf("save: %q %v", name, err)
	}
	data, err := os.ReadFile(filepath.Join(ResolveDataDir(), "icons", name))
	if err != nil {
		t.Fatal(err)
	}
	if w, _ := sizeOf(t, data); w != iconMaxEdge {
		t.Errorf("stored icon is %d px wide", w)
	}
}

// pngWithChunk is png with an extra, valid chunk of the given name before IDAT.
func pngWithChunk(t *testing.T, base []byte, name string, data []byte) []byte {
	t.Helper()
	i := bytes.Index(base, []byte("IDAT")) - 4
	chunk := make([]byte, 0, 12+len(data))
	chunk = binary.BigEndian.AppendUint32(chunk, uint32(len(data)))
	chunk = append(chunk, name...)
	chunk = append(chunk, data...)
	chunk = binary.BigEndian.AppendUint32(chunk, crc32.ChecksumIEEE(chunk[4:]))
	return append(append(append([]byte{}, base[:i]...), chunk...), base[i:]...)
}

func TestShrinkIconLeavesAnAnimatedPNG(t *testing.T) {
	in := pngWithChunk(t, noisePNG(t, 512, 512, 255), "acTL", []byte{0, 0, 0, 2, 0, 0, 0, 0})
	if out, _ := shrinkIconBytes(in, ".png"); !bytes.Equal(out, in) {
		t.Error("an animated PNG was flattened to one frame")
	}
}

func TestShrinkIconLeavesAPictureTooLargeToDecodeHere(t *testing.T) {
	// 2100 square is over the cap; flat, so the file itself is small.
	img := image.NewNRGBA(image.Rect(0, 0, 2100, 2100))
	for i := range img.Pix {
		img.Pix[i] = 255
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	in := buf.Bytes()
	if out, _ := shrinkIconBytes(in, ".png"); !bytes.Equal(out, in) {
		t.Error("a picture over the pixel cap was decoded and rewritten")
	}
}

// jpegWithOrientation is a minimal JPEG with an EXIF block saying `orientation`.
func jpegWithOrientation(t *testing.T, w, h, orientation int) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	rng := rand.New(rand.NewSource(2))
	for i := range img.Pix {
		img.Pix[i] = uint8(rng.Intn(256))
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, nil); err != nil {
		t.Fatal(err)
	}
	tiff := []byte{'M', 'M', 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, byte(orientation >> 8), byte(orientation), 0, 0, 0, 0, 0, 0}
	seg := append([]byte("Exif\x00\x00"), tiff...)
	app1 := []byte{0xFF, 0xE1, byte((len(seg) + 2) >> 8), byte(len(seg) + 2)}
	return append(append(append([]byte{0xFF, 0xD8}, app1...), seg...), buf.Bytes()[2:]...)
}

func TestShrinkIconTurnedJPEGIsLeftAloneAndUprightOneIsShrunk(t *testing.T) {
	turned := jpegWithOrientation(t, 400, 400, 6)
	if out, ext := shrinkIconBytes(turned, ".jpg"); !bytes.Equal(out, turned) || ext != ".jpg" {
		t.Error("a JPEG that is turned by its EXIF tag was re-encoded, which drops the tag")
	}
	upright := jpegWithOrientation(t, 400, 400, 1)
	out, _ := shrinkIconBytes(upright, ".jpg")
	if w, _ := sizeOf(t, out); w != iconMaxEdge {
		t.Errorf("an upright JPEG was %d px wide after, want %d", w, iconMaxEdge)
	}
}

// Colour, not only alpha: a red square stays red.
func TestShrinkIconKeepsColour(t *testing.T) {
	img := image.NewNRGBA(image.Rect(0, 0, 400, 400))
	for i := 0; i < len(img.Pix); i += 4 {
		img.Pix[i], img.Pix[i+1], img.Pix[i+2], img.Pix[i+3] = 200, 30, 40, 255
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	// A flat picture compresses to nothing, so it is only kept when smaller; give it noise to lose.
	out, _ := shrinkIconBytes(buf.Bytes(), ".png")
	got, err := png.Decode(bytes.NewReader(out))
	if err != nil {
		t.Skip("a flat picture is already smaller than its shrunk copy and was kept as it was")
	}
	c := color.NRGBAModel.Convert(got.At(5, 5)).(color.NRGBA)
	if c.R < 198 || c.R > 202 || c.G < 28 || c.G > 32 || c.B < 38 || c.B > 42 {
		t.Errorf("colour = %v, want about 200,30,40", c)
	}
}
