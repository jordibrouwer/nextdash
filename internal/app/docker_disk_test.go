package app

import (
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

const mb = int64(1 << 20)

func diskFixture(t *testing.T) (*fakeDocker, *Handlers) {
	t.Helper()
	f := startFakeDocker(t)
	f.add(fakeContainer{ID: strings.Repeat("a", 64), Name: "sonarr", Image: "img:latest", ImageID: "sha256:new", State: "running",
		Mounts: []map[string]any{{"Type": "volume", "Name": "arr_config"}}})
	f.add(fakeContainer{ID: strings.Repeat("b", 64), Name: "radarr", Image: "radarr:latest", ImageID: "sha256:r", State: "exited",
		Mounts: []map[string]any{{"Type": "volume", "Name": "arr_config"}, {"Type": "bind", "Source": "/mnt"}}})
	f.df = map[string]any{
		"Images": []map[string]any{
			{"Id": "sha256:new", "RepoTags": []string{"img:latest"}, "Size": 400 * mb, "Containers": 1},
			{"Id": "sha256:old", "RepoTags": []string{}, "Size": 390 * mb, "Containers": 0},
			{"Id": "sha256:pg", "RepoTags": []string{"postgres:15"}, "Size": 379 * mb, "Containers": 0},
			{"Id": "sha256:r", "RepoTags": []string{"radarr:latest"}, "Size": 300 * mb, "Containers": 1},
		},
		"Volumes": []map[string]any{
			{"Name": "arr_config", "Driver": "local", "UsageData": map[string]any{"Size": 96 * mb, "RefCount": 2}},
			{"Name": "old_pgdata", "Driver": "local", "UsageData": map[string]any{"Size": 171 * mb, "RefCount": 0}},
		},
		"BuildCache": []map[string]any{{"ID": "c1", "Size": 100 * mb}, {"ID": "c2", "Size": 200 * mb}},
	}
	h := dockerTestHandlers(t)
	// sonarr was updated from sha256:old: that image is its way back.
	if err := appendDockerUpdateHistory(dockerUpdateHistoryEntry{At: 1, Kind: "update", Container: "sonarr", Image: "img:latest",
		FromImageID: "sha256:old", ToImageID: "sha256:new"}); err != nil {
		t.Fatal(err)
	}
	return f, h
}

// The disk route names what uses each image and volume, which untagged image
// a rollback still needs, and what could be freed.
func TestDockerDiskUsage(t *testing.T) {
	_, h := diskFixture(t)
	rec := httptest.NewRecorder()
	newDockerTestRouter(h).ServeHTTP(rec, httptest.NewRequest("GET", "/api/docker/disk", nil))
	var d dockerDiskView
	if err := json.NewDecoder(rec.Body).Decode(&d); err != nil || rec.Code != 200 {
		t.Fatalf("%d %v %s", rec.Code, err, rec.Body)
	}
	if len(d.Images) != 4 || d.Images[0].ID != "sha256:new" || d.Images[3].ID != "sha256:r" {
		t.Fatalf("images, biggest first = %+v", d.Images)
	}
	byID := map[string]dockerDiskImage{}
	for _, im := range d.Images {
		byID[im.ID] = im
	}
	if old := byID["sha256:old"]; !old.Dangling || strings.Join(old.RollbackFor, ",") != "sonarr" || len(old.UsedBy) != 0 {
		t.Fatalf("old = %+v", old)
	}
	if strings.Join(byID["sha256:r"].UsedBy, ",") != "radarr" || strings.Join(byID["sha256:new"].UsedBy, ",") != "sonarr" {
		t.Fatalf("used by = %+v / %+v", byID["sha256:r"], byID["sha256:new"])
	}
	if len(d.Volumes) != 2 || d.Volumes[0].Name != "old_pgdata" || strings.Join(d.Volumes[1].UsedBy, ",") != "radarr,sonarr" {
		t.Fatalf("volumes = %+v", d.Volumes)
	}
	want := dockerDiskTotals{Images: 1469 * mb, ImagesUnused: 769 * mb, Dangling: 390 * mb, DanglingCount: 1, ImagesUnusedCount: 2,
		BuildCache: 300 * mb, BuildCacheCount: 2, Volumes: 267 * mb, VolumesUnused: 171 * mb, VolumesUnusedCount: 1,
		Reclaimable: (769 + 300 + 171) * mb}
	if d.Totals != want {
		t.Fatalf("totals = %+v\nwant     %+v", d.Totals, want)
	}
}

// Pruning is an action: control on, then one daemon call with the filter
// that says which images.
func TestDockerPrune(t *testing.T) {
	f, h := diskFixture(t)
	router := newDockerTestRouter(h)
	if rec := dockerPost(router, "/api/docker/prune/images-dangling"); rec.Code != 403 {
		t.Fatalf("without control: %d", rec.Code)
	}
	t.Setenv("NEXTDASH_DOCKER_CONTROL", "1")
	f.reclaimed = 390 * mb
	rec := dockerPost(router, "/api/docker/prune/images-dangling")
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"reclaimed":408944640`) {
		t.Fatalf("dangling: %d %s", rec.Code, rec.Body)
	}
	filter := func(v string) string {
		return "filters=" + url.QueryEscape(`{"dangling":["`+v+`"]}`)
	}
	if !f.called("POST /images/prune?" + filter("true")) {
		t.Fatalf("calls = %v", f.calls)
	}
	dockerPost(router, "/api/docker/prune/images-unused")
	if !f.called("POST /images/prune?" + filter("false")) {
		t.Fatalf("calls = %v", f.calls)
	}
	dockerPost(router, "/api/docker/prune/build-cache")
	if !f.called("POST /build/prune?all=true") {
		t.Fatalf("calls = %v", f.calls)
	}
	if rec := dockerPost(router, "/api/docker/prune/volumes"); rec.Code != 404 {
		t.Fatalf("no bulk volume prune: %d", rec.Code)
	}
}

// A volume goes one at a time, only when named twice, and never while a
// container -- even a stopped one -- still holds it.
func TestDockerVolumeRemove(t *testing.T) {
	f, h := diskFixture(t)
	t.Setenv("NEXTDASH_DOCKER_CONTROL", "1")
	router := newDockerTestRouter(h)
	del := func(path string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest("DELETE", path, nil))
		return rec
	}
	if rec := del("/api/docker/volumes/old_pgdata"); rec.Code != 400 || !strings.Contains(rec.Body.String(), "confirm-name") {
		t.Fatalf("no confirm: %d %s", rec.Code, rec.Body)
	}
	if rec := del("/api/docker/volumes/old_pgdata?confirm=old"); rec.Code != 400 {
		t.Fatalf("wrong confirm: %d", rec.Code)
	}
	if rec := del("/api/docker/volumes/arr_config?confirm=arr_config"); rec.Code != 409 || !strings.Contains(rec.Body.String(), "radarr") {
		t.Fatalf("in use: %d %s", rec.Code, rec.Body)
	}
	if f.called("DELETE /volumes/arr_config") {
		t.Fatal("an in-use volume reached the daemon")
	}
	if rec := del("/api/docker/volumes/old_pgdata?confirm=old_pgdata"); rec.Code != 200 || !f.called("DELETE /volumes/old_pgdata") {
		t.Fatalf("remove: %d %s calls %v", rec.Code, rec.Body, f.calls)
	}
}

// An image prune waits for a running update or rollback, and an update waits
// for a running prune: between pull and create the new image is unused.
func TestDockerPruneAndUpdateExcludeEachOther(t *testing.T) {
	f, h := diskFixture(t)
	router := newDockerTestRouter(h)
	t.Setenv("NEXTDASH_DOCKER_CONTROL", "1")
	h.dockerBusy.Store(strings.Repeat("a", 64), struct{}{})
	if rec := dockerPost(router, "/api/docker/prune/images-unused"); rec.Code != 409 || !strings.Contains(rec.Body.String(), "busy") {
		t.Fatalf("prune during an update: %d %s", rec.Code, rec.Body)
	}
	if f.called("POST /images/prune?filters=" + url.QueryEscape(`{"dangling":["false"]}`)) {
		t.Fatalf("the prune reached the daemon: %v", f.calls)
	}
	if rec := dockerPost(router, "/api/docker/prune/build-cache"); rec.Code != 200 {
		t.Fatalf("the build cache holds no image: %d", rec.Code)
	}
	h.dockerBusy.Delete(strings.Repeat("a", 64))

	h.dockerPruneRunning.Store(true)
	defer h.dockerPruneRunning.Store(false)
	if rec := dockerPost(router, "/api/docker/containers/radarr/update"); rec.Code != 409 || !strings.Contains(rec.Body.String(), "prune-running") {
		t.Fatalf("update during a prune: %d %s", rec.Code, rec.Body)
	}
	if rec := dockerPost(router, "/api/docker/containers/radarr/restart"); rec.Code != 200 {
		t.Fatalf("a restart needs no image: %d %s", rec.Code, rec.Body)
	}
}

// Images share layers. Removing an unused one frees its size less what other
// images keep, and the images together take LayersSize, not the sum of their
// sizes -- as `docker system df` counts. A shared or in-use cache record does
// not go with a prune either.
func TestDockerDiskCountsSharedLayersOnce(t *testing.T) {
	f, h := diskFixture(t)
	f.df["LayersSize"] = 900 * mb
	images := f.df["Images"].([]map[string]any)
	images[1]["SharedSize"] = 300 * mb // sha256:old, dangling: 90 MB of its own
	images[2]["SharedSize"] = 350 * mb // sha256:pg, unused: 29 MB of its own
	f.df["BuildCache"] = []map[string]any{{"ID": "c1", "Size": 100 * mb}, {"ID": "c2", "Size": 200 * mb, "Shared": true}}
	rec := httptest.NewRecorder()
	newDockerTestRouter(h).ServeHTTP(rec, httptest.NewRequest("GET", "/api/docker/disk", nil))
	var d dockerDiskView
	_ = json.NewDecoder(rec.Body).Decode(&d)
	tot := d.Totals
	if tot.Images != 900*mb || tot.ImagesUnused != 119*mb || tot.Dangling != 90*mb {
		t.Fatalf("images %d unused %d dangling %d (MB: %d %d %d)", tot.Images, tot.ImagesUnused, tot.Dangling,
			tot.Images/mb, tot.ImagesUnused/mb, tot.Dangling/mb)
	}
	if tot.BuildCache != 300*mb || tot.Reclaimable != 119*mb+100*mb+171*mb {
		t.Fatalf("build cache %d reclaimable %d MB", tot.BuildCache/mb, tot.Reclaimable/mb)
	}
}

// Bind mounts are listed by host folder with who mounts it where; the Docker
// socket and the clock are the host's own, not data, and are left out.
func TestDockerDiskBinds(t *testing.T) {
	f, h := diskFixture(t)
	f.add(fakeContainer{ID: strings.Repeat("c", 64), Name: "bazarr", Image: "bazarr:latest", ImageID: "sha256:b", State: "running",
		Mounts: []map[string]any{
			{"Type": "bind", "Source": "/mnt", "Destination": "/media"},
			{"Type": "bind", "Source": "/var/run/docker.sock", "Destination": "/var/run/docker.sock"},
			{"Type": "bind", "Source": "/etc/localtime", "Destination": "/etc/localtime"},
		}})
	rec := httptest.NewRecorder()
	newDockerTestRouter(h).ServeHTTP(rec, httptest.NewRequest("GET", "/api/docker/disk", nil))
	var d dockerDiskView
	if err := json.NewDecoder(rec.Body).Decode(&d); err != nil || rec.Code != 200 {
		t.Fatalf("%d %v %s", rec.Code, err, rec.Body)
	}
	if len(d.Binds) != 1 || d.Binds[0].Source != "/mnt" {
		t.Fatalf("binds = %+v", d.Binds)
	}
	at := d.Binds[0].UsedBy
	if len(at) != 2 || at[0].Container != "bazarr" || at[0].Destination != "/media" || at[1].Container != "radarr" {
		t.Fatalf("used by = %+v", at)
	}
}
