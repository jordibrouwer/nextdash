package app

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
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
