package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

/*
Immich: photos, albums and people, on the shared media basis.

Immich keeps the key in the X-Api-Key header and serves pictures only to a
caller that holds it, so the tile reads by widget id and the pictures come
through /api/widgets/<type>/image, as every media tile's do. A photo has two
pictures there: the poster is Immich's small thumbnail, the backdrop its
preview. The frame and the slideshow draw the backdrop, a grid the poster, so
a page of twenty thumbnails never carries twenty previews.

An album's own answer lists no photos (Immich 3 dropped them), so an album is
read through the search, which takes an album id like any other filter.
*/

const (
	immichMaxBody     = 8 << 20
	immichDefaultTTL  = 300
	immichMinTTL      = 60
	immichPeoplePage  = 500
	immichPeopleLimit = 300
)

// The kinds of thing an Immich tile can be set to show.
var (
	immichSources = []string{"library", "favorites", "album", "person", "memories", "day"}
	immichOrders  = []string{"random", "newest", "oldest"}
	immichLayouts = []string{"frame", "grid", "strip", "hero", "list"}
)

func immichPhotoFields(slides bool) []widgetField {
	fields := []widgetField{
		{Key: "server", Kind: "url"},
		{Key: "credentialId", Kind: "string"},
		{Key: "source", Kind: "string", Allowed: immichSources},
		{Key: "albumId", Kind: "string"},
		{Key: "personId", Kind: "string"},
		{Key: "order", Kind: "string", Allowed: immichOrders},
		{Key: "videos", Kind: "bool"},
		{Key: "fit", Kind: "string", Allowed: []string{"cover", "contain"}},
		{Key: "caption", Kind: "string", Allowed: []string{"none", "date"}},
		{Key: "click", Kind: "string", Allowed: []string{"open", "detail"}},
		{Key: "target", Kind: "string", Allowed: []string{"inherit", "_blank", "_self"}},
		{Key: "rows", Kind: "int", Min: widgetMinRows, Max: widgetMaxRows},
		{Key: "ttl", Kind: "int", Min: immichMinTTL, Max: 3600},
	}
	if slides {
		return append(fields,
			widgetField{Key: "interval", Kind: "int", Min: 3, Max: 300},
			widgetField{Key: "transition", Kind: "string", Allowed: []string{"fade", "slide", "none"}},
			widgetField{Key: "autoplay", Kind: "bool"},
		)
	}
	return append(fields, widgetField{Key: "layout", Kind: "string", Allowed: immichLayouts})
}

func immichAlbumFields() []widgetField {
	return []widgetField{
		{Key: "server", Kind: "url"},
		{Key: "credentialId", Kind: "string"},
		{Key: "scope", Kind: "string", Allowed: []string{"all", "shared", "mine"}},
		{Key: "sort", Kind: "string", Allowed: []string{"updated", "name", "newest", "count"}},
		{Key: "layout", Kind: "string", Allowed: []string{"list", "strip", "hero", "grid"}},
		{Key: "click", Kind: "string", Allowed: []string{"open", "detail"}},
		{Key: "target", Kind: "string", Allowed: []string{"inherit", "_blank", "_self"}},
		{Key: "rows", Kind: "int", Min: widgetMinRows, Max: widgetMaxRows},
		{Key: "ttl", Kind: "int", Min: immichMinTTL, Max: 3600},
	}
}

func immichPeopleFields() []widgetField {
	return []widgetField{
		{Key: "server", Kind: "url"},
		{Key: "credentialId", Kind: "string"},
		{Key: "favorites", Kind: "bool"},
		{Key: "layout", Kind: "string", Allowed: []string{"strip", "grid", "list"}},
		{Key: "click", Kind: "string", Allowed: []string{"open", "detail"}},
		{Key: "target", Kind: "string", Allowed: []string{"inherit", "_blank", "_self"}},
		{Key: "rows", Kind: "int", Min: widgetMinRows, Max: widgetMaxRows},
		{Key: "ttl", Kind: "int", Min: immichMinTTL, Max: 3600},
	}
}

type immichSpec struct {
	Service      string
	Server       string
	CredentialID string
	Source       string
	AlbumID      string
	PersonID     string
	Order        string
	Videos       bool
	Layout       string
	Rows         int
	TTL          time.Duration
	// Scope, Sort and Favorites are an album or people tile's own.
	Scope     string
	Sort      string
	Favorites bool
}

func immichChoice(raw any, allowed []string, fallback string) string {
	if value := stringOr(raw); containsString(allowed, value) {
		return value
	}
	return fallback
}

/*
immichSpecFrom reads a tile's settings. A frame shows one photo and the
slideshow a dozen unless told otherwise; the other layouts show a handful.
*/
func immichSpecFrom(service WidgetType, config map[string]any) immichSpec {
	spec := immichSpec{
		Service:      string(service),
		Server:       strings.TrimRight(stringOr(config["server"]), "/"),
		CredentialID: stringOr(config["credentialId"]),
		Source:       immichChoice(config["source"], immichSources, "library"),
		AlbumID:      stringOr(config["albumId"]),
		PersonID:     stringOr(config["personId"]),
		Order:        immichChoice(config["order"], immichOrders, "random"),
		Videos:       config["videos"] == true,
		Layout:       immichChoice(config["layout"], immichLayouts, "grid"),
		Scope:        immichChoice(config["scope"], []string{"all", "shared", "mine"}, "all"),
		Sort:         immichChoice(config["sort"], []string{"updated", "name", "newest", "count"}, "updated"),
		Favorites:    config["favorites"] == true,
		TTL:          immichDefaultTTL * time.Second,
	}
	switch {
	case service == WidgetTypeImmichSlideshow:
		spec.Layout = "slides"
		spec.Rows = 12
	case spec.Layout == "frame":
		spec.Rows = 1
	case service == WidgetTypeImmichPeople:
		spec.Rows = 8
		spec.Layout = immichChoice(config["layout"], []string{"strip", "grid", "list"}, "strip")
	default:
		spec.Rows = 6
	}
	if spec.Source == "day" {
		spec.Rows = 1
	}
	if rows, ok := widgetConfigInt(config["rows"]); ok && rows > 0 && spec.Source != "day" && spec.Layout != "frame" {
		spec.Rows = clampInt(rows, widgetMinRows, widgetMaxRows)
	}
	if ttl, ok := widgetConfigInt(config["ttl"]); ok && ttl > 0 {
		spec.TTL = time.Duration(clampInt(ttl, immichMinTTL, 3600)) * time.Second
	}
	return spec
}

// fingerprint changes with every setting that changes what Immich is asked.
func (spec immichSpec) fingerprint() string {
	return strings.Join([]string{
		spec.Service, spec.Server, spec.CredentialID, spec.Source, spec.AlbumID, spec.PersonID, spec.Order,
		strconv.FormatBool(spec.Videos), spec.Scope, spec.Sort, strconv.FormatBool(spec.Favorites),
		strconv.Itoa(spec.Rows),
	}, "|")
}

func (h *Handlers) immichGet(ctx context.Context, server string, credential HealthCredential, path string, query url.Values, out any) error {
	ctx, cancel := context.WithTimeout(ctx, mediaRequestTimeout)
	defer cancel()
	resp, err := h.mediaRequest(ctx, server, credential, "/api"+path, query, "application/json", nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if err := json.NewDecoder(io.LimitReader(resp.Body, immichMaxBody)).Decode(out); err != nil {
		return fmt.Errorf("%w: %v", errMediaUnreachable, err)
	}
	return nil
}

func (h *Handlers) immichPost(ctx context.Context, server string, credential HealthCredential, path string, body, out any) error {
	ctx, cancel := context.WithTimeout(ctx, mediaRequestTimeout)
	defer cancel()
	resp, err := h.mediaPost(ctx, server, credential, "/api"+path, body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if err := json.NewDecoder(io.LimitReader(resp.Body, immichMaxBody)).Decode(out); err != nil {
		return fmt.Errorf("%w: %v", errMediaUnreachable, err)
	}
	return nil
}

// immichAsset is what a photo or a video says about itself.
type immichAsset struct {
	ID               string         `json:"id"`
	Type             string         `json:"type"`
	OriginalFileName string         `json:"originalFileName"`
	LocalDateTime    string         `json:"localDateTime"`
	FileCreatedAt    string         `json:"fileCreatedAt"`
	UpdatedAt        string         `json:"updatedAt"`
	IsFavorite       bool           `json:"isFavorite"`
	Visibility       string         `json:"visibility"`
	IsTrashed        bool           `json:"isTrashed"`
	Duration         immichDuration `json:"duration"`
	Width            int            `json:"width"`
	Height           int            `json:"height"`
	IsArchived       bool           `json:"isArchived"`
}

/*
immichDuration is how long a video runs, in milliseconds, however Immich words it.

Immich 3 sends a number from the search and a string such as
"0:00:02.235000" from the timeline, and older versions sent the string
everywhere and one for a photo too. A decode that took only one of them would
fail the whole answer, so every photo tile read "unreachable" on the other.
Null, an empty string and anything it cannot read are no duration at all.
*/
type immichDuration float64

func (d *immichDuration) UnmarshalJSON(raw []byte) error {
	*d = 0
	text := strings.TrimSpace(string(raw))
	if text == "" || text == "null" {
		return nil
	}
	if number, err := strconv.ParseFloat(text, 64); err == nil {
		if number > 0 {
			*d = immichDuration(number)
		}
		return nil
	}
	var clock string
	if json.Unmarshal(raw, &clock) != nil {
		return nil
	}
	parts := strings.Split(strings.TrimSpace(clock), ":")
	if len(parts) != 3 {
		return nil
	}
	hours, errH := strconv.ParseFloat(parts[0], 64)
	minutes, errM := strconv.ParseFloat(parts[1], 64)
	seconds, errS := strconv.ParseFloat(parts[2], 64)
	if errH != nil || errM != nil || errS != nil {
		return nil
	}
	if total := ((hours*60+minutes)*60 + seconds) * 1000; total > 0 {
		*d = immichDuration(total)
	}
	return nil
}

type immichSearchAnswer struct {
	Assets struct {
		Items []immichAsset `json:"items"`
	} `json:"assets"`
}

type immichMemory struct {
	Type string `json:"type"`
	Data struct {
		Year int `json:"year"`
	} `json:"data"`
	Assets []immichAsset `json:"assets"`
}

// immichTime reads the moment a picture was taken, the way Immich words it.
func immichTime(asset immichAsset) int64 {
	for _, raw := range []string{asset.LocalDateTime, asset.FileCreatedAt} {
		for _, layout := range []string{time.RFC3339Nano, "2006-01-02T15:04:05.000Z"} {
			if at, err := time.Parse(layout, raw); err == nil {
				return at.UnixMilli()
			}
		}
	}
	return 0
}

func immichImageRef(id, kind, tag string) mediaImageRef {
	if tag == "" {
		tag = "-"
	}
	return mediaImageRef{Item: id, Kind: kind, Tag: tag}
}

func immichPhotoItem(spec immichSpec, asset immichAsset, imageURL func(mediaImageRef) string, images map[mediaImageRef]bool) MediaItem {
	kind := "photo"
	if strings.EqualFold(asset.Type, "VIDEO") {
		kind = "video"
	}
	item := MediaItem{
		ID:        asset.ID,
		Title:     asset.OriginalFileName,
		Kind:      kind,
		Library:   "Photos",
		LibraryID: "photos",
		When:      immichTime(asset),
		OpenURL:   spec.Server + "/photos/" + url.PathEscape(asset.ID),
	}
	item.AddedAt = item.When
	if item.When > 0 {
		item.Year = time.UnixMilli(item.When).UTC().Year()
	}
	if kind == "video" && asset.Duration > 0 {
		item.Seconds = int(float64(asset.Duration)/1000 + 0.5)
	}
	small := immichImageRef(asset.ID, "poster", asset.UpdatedAt)
	large := immichImageRef(asset.ID, "backdrop", asset.UpdatedAt)
	item.Poster, item.Backdrop = imageURL(small), imageURL(large)
	images[small], images[large] = true, true
	return item
}

// immichDayPicks holds the photo of the day, so it is one photo all day and
// not a new one at every refresh. A restart picks again; that is the cost of
// not writing it down.
var immichDayPicks = struct {
	sync.Mutex
	at map[string]immichDayPick
}{at: map[string]immichDayPick{}}

type immichDayPick struct {
	day   string
	asset immichAsset
}

func (spec immichSpec) filters() map[string]any {
	body := map[string]any{"visibility": "timeline"}
	if !spec.Videos {
		body["type"] = "IMAGE"
	}
	switch spec.Source {
	case "favorites":
		body["isFavorite"] = true
	case "album":
		body["albumIds"] = []string{spec.AlbumID}
	case "person":
		body["personIds"] = []string{spec.PersonID}
	}
	return body
}

// immichBucket is one month of a timeline.
type immichBucket struct {
	TimeBucket string `json:"timeBucket"`
	Count      int    `json:"count"`
}

// immichColumns is one month of photos as the timeline sends it: a list per
// field, the same position in each belonging to the same photo.
type immichColumns struct {
	ID               []string         `json:"id"`
	IsImage          []bool           `json:"isImage"`
	IsFavorite       []bool           `json:"isFavorite"`
	IsTrashed        []bool           `json:"isTrashed"`
	Visibility       []string         `json:"visibility"`
	FileCreatedAt    []string         `json:"fileCreatedAt"`
	LocalOffsetHours []float64        `json:"localOffsetHours"`
	Thumbhash        []*string        `json:"thumbhash"`
	Duration         []immichDuration `json:"duration"`
}

// immichBucketsRead is how many months one answer reads at most.
const immichBucketsRead = 4

/*
immichAlbumAssets lists an album's photos through the timeline.

The search takes an album id, but it looks only at the caller's own photos and
those of partners, so an album someone else shared would come back with
nothing of theirs in it. The timeline is what Immich's own album page reads,
and answers for any album the key may open. Months are read until there are
enough, and no more than immichBucketsRead of them: an album of ten years is
not ten requests for six photos.
*/
func (h *Handlers) immichAlbumAssets(ctx context.Context, spec immichSpec, credential HealthCredential, count int) ([]immichAsset, error) {
	query := url.Values{"albumId": {spec.AlbumID}, "visibility": {"timeline"}}
	var buckets []immichBucket
	if err := h.immichGet(ctx, spec.Server, credential, "/timeline/buckets", query, &buckets); err != nil {
		return nil, err
	}
	sort.SliceStable(buckets, func(i, j int) bool { return buckets[i].TimeBucket > buckets[j].TimeBucket })
	order := "desc"
	switch spec.Order {
	case "oldest":
		order = "asc"
		for i, j := 0, len(buckets)-1; i < j; i, j = i+1, j-1 {
			buckets[i], buckets[j] = buckets[j], buckets[i]
		}
	case "random":
		rand.Shuffle(len(buckets), func(i, j int) { buckets[i], buckets[j] = buckets[j], buckets[i] })
	}
	var list []immichAsset
	for read, bucket := range buckets {
		if read >= immichBucketsRead || (spec.Order != "random" && len(list) >= count) || (spec.Order == "random" && len(list) >= count*3) {
			break
		}
		bucketQuery := url.Values{"albumId": {spec.AlbumID}, "timeBucket": {bucket.TimeBucket}, "visibility": {"timeline"}, "order": {order}}
		var columns immichColumns
		if err := h.immichGet(ctx, spec.Server, credential, "/timeline/bucket", bucketQuery, &columns); err != nil {
			if read == 0 {
				return nil, err
			}
			break
		}
		list = append(list, columns.assets(spec.Videos)...)
	}
	if spec.Order == "random" {
		rand.Shuffle(len(list), func(i, j int) { list[i], list[j] = list[j], list[i] })
	}
	if len(list) > count {
		list = list[:count]
	}
	return list, nil
}

// assets reads the columns as photos; a list that is shorter than the ids
// leaves its field empty for the photos past its end.
func (c immichColumns) assets(videos bool) []immichAsset {
	var out []immichAsset
	for i, id := range c.ID {
		asset := immichAsset{ID: id, Type: "IMAGE", Visibility: "timeline"}
		if i < len(c.IsImage) && !c.IsImage[i] {
			asset.Type = "VIDEO"
			if !videos {
				continue
			}
		}
		if i < len(c.IsTrashed) && c.IsTrashed[i] {
			continue
		}
		if i < len(c.Visibility) {
			asset.Visibility = c.Visibility[i]
		}
		if i < len(c.IsFavorite) {
			asset.IsFavorite = c.IsFavorite[i]
		}
		if i < len(c.Duration) {
			asset.Duration = c.Duration[i]
		}
		// A timeline has no update time; the thumbhash changes when the
		// thumbnail does, which is what the picture's name needs.
		if i < len(c.Thumbhash) && c.Thumbhash[i] != nil {
			asset.UpdatedAt = *c.Thumbhash[i]
		}
		if i < len(c.FileCreatedAt) {
			if at, err := time.Parse("2006-01-02T15:04:05", strings.TrimSuffix(c.FileCreatedAt[i], "Z")); err == nil {
				if i < len(c.LocalOffsetHours) {
					at = at.Add(time.Duration(c.LocalOffsetHours[i] * float64(time.Hour)))
				}
				asset.LocalDateTime = at.Format(time.RFC3339)
			}
		}
		out = append(out, asset)
	}
	return out
}

// immichList asks for rows assets, in the order the tile is set to.
func (h *Handlers) immichList(ctx context.Context, spec immichSpec, credential HealthCredential, count int) ([]immichAsset, error) {
	if spec.Source == "album" {
		return h.immichAlbumAssets(ctx, spec, credential, count)
	}
	body := spec.filters()
	body["size"] = count
	if spec.Order == "random" {
		var list []immichAsset
		err := h.immichPost(ctx, spec.Server, credential, "/search/random", body, &list)
		return list, err
	}
	body["page"] = 1
	body["order"] = "desc"
	if spec.Order == "oldest" {
		body["order"] = "asc"
	}
	var answer immichSearchAnswer
	err := h.immichPost(ctx, spec.Server, credential, "/search/metadata", body, &answer)
	return answer.Assets.Items, err
}

func (h *Handlers) immichMemories(ctx context.Context, spec immichSpec, credential HealthCredential) ([]immichAsset, error) {
	var memories []immichMemory
	query := url.Values{"for": {time.Now().Format("2006-01-02")}}
	if err := h.immichGet(ctx, spec.Server, credential, "/memories", query, &memories); err != nil {
		return nil, err
	}
	var list []immichAsset
	for _, memory := range memories {
		if memory.Type != "on_this_day" {
			continue
		}
		for _, asset := range memory.Assets {
			if asset.IsTrashed || (!spec.Videos && strings.EqualFold(asset.Type, "VIDEO")) {
				continue
			}
			list = append(list, asset)
		}
	}
	// The oldest memories first: that is the point of the day.
	sort.SliceStable(list, func(i, j int) bool { return immichTime(list[i]) < immichTime(list[j]) })
	return list, nil
}

func (h *Handlers) immichDay(ctx context.Context, spec immichSpec, credential HealthCredential) ([]immichAsset, error) {
	key := spec.fingerprint()
	day := time.Now().Format("2006-01-02")
	immichDayPicks.Lock()
	pick, ok := immichDayPicks.at[key]
	immichDayPicks.Unlock()
	if ok && pick.day == day {
		return []immichAsset{pick.asset}, nil
	}
	one := spec
	one.Source = "library"
	one.Order = "random"
	list, err := h.immichList(ctx, one, credential, 1)
	if err != nil || len(list) == 0 {
		return list, err
	}
	immichDayPicks.Lock()
	defer immichDayPicks.Unlock()
	// Two first reads of the day at once chose twice: the first one stays.
	if pick, ok := immichDayPicks.at[key]; ok && pick.day == day {
		return []immichAsset{pick.asset}, nil
	}
	// Every settings change is a new key; yesterday's are of no use to anyone.
	for other, pick := range immichDayPicks.at {
		if pick.day != day {
			delete(immichDayPicks.at, other)
		}
	}
	immichDayPicks.at[key] = immichDayPick{day: day, asset: list[0]}
	return list, nil
}

func (h *Handlers) fetchImmichPhotos(ctx context.Context, spec immichSpec, imageURL func(mediaImageRef) string) (MediaResult, map[mediaImageRef]bool, error) {
	result := MediaResult{Items: []MediaItem{}, Libraries: []MediaGroup{{ID: "photos", Name: "Photos"}}}
	images := map[mediaImageRef]bool{}
	if spec.Server == "" || spec.CredentialID == "" {
		return result, images, errMediaNotSetUp
	}
	credential, ok := lookupHealthCredential(spec.CredentialID)
	if !ok {
		return result, images, errMediaNotSetUp
	}
	// An album or a person that was not chosen is a tile not finished, not a
	// library to draw from.
	if (spec.Source == "album" && spec.AlbumID == "") || (spec.Source == "person" && spec.PersonID == "") {
		return result, images, errMediaNoLibraries
	}
	var (
		list []immichAsset
		err  error
	)
	switch spec.Source {
	case "memories":
		list, err = h.immichMemories(ctx, spec, credential)
	case "day":
		list, err = h.immichDay(ctx, spec, credential)
	default:
		list, err = h.immichList(ctx, spec, credential, spec.Rows)
	}
	if err != nil {
		return result, images, err
	}
	for _, asset := range list {
		if len(result.Items) >= spec.Rows {
			break
		}
		// Versions before 1.133 ignore the visibility filter of the search.
		if asset.ID == "" || asset.IsTrashed || asset.IsArchived || (asset.Visibility != "" && asset.Visibility != "timeline") {
			continue
		}
		result.Items = append(result.Items, immichPhotoItem(spec, asset, imageURL, images))
	}
	if spec.Source == "memories" {
		result.Libraries = []MediaGroup{{ID: "memories", Name: "On this day"}}
		for i := range result.Items {
			result.Items[i].Library, result.Items[i].LibraryID = "On this day", "memories"
		}
	}
	return result, images, nil
}

type immichAlbum struct {
	ID                string `json:"id"`
	AlbumName         string `json:"albumName"`
	Description       string `json:"description"`
	AlbumThumbnailID  string `json:"albumThumbnailAssetId"`
	UpdatedAt         string `json:"updatedAt"`
	StartDate         string `json:"startDate"`
	EndDate           string `json:"endDate"`
	AssetCount        int    `json:"assetCount"`
	Shared            bool   `json:"shared"`
	LastModifiedAsset string `json:"lastModifiedAssetTimestamp"`
	OwnerID           string `json:"ownerId"`
	Owner             struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"owner"`
	AlbumUsers []struct {
		User struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"user"`
		Role string `json:"role"`
	} `json:"albumUsers"`
}

func (a immichAlbum) owner() (id, name string) {
	for _, member := range a.AlbumUsers {
		if member.Role == "owner" {
			return member.User.ID, member.User.Name
		}
	}
	// Older versions list only the people an album was shared with, and name
	// the owner beside them.
	if a.Owner.ID != "" {
		return a.Owner.ID, a.Owner.Name
	}
	return a.OwnerID, ""
}

func immichRFC(raw string) int64 {
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02T15:04:05.000Z"} {
		if at, err := time.Parse(layout, raw); err == nil {
			return at.UnixMilli()
		}
	}
	return 0
}

func (a immichAlbum) changed() int64 {
	if at := immichRFC(a.LastModifiedAsset); at > 0 {
		return at
	}
	return immichRFC(a.UpdatedAt)
}

func (h *Handlers) immichMe(ctx context.Context, server string, credential HealthCredential) (id string, admin bool, err error) {
	var me struct {
		ID      string `json:"id"`
		IsAdmin bool   `json:"isAdmin"`
	}
	if err = h.immichGet(ctx, server, credential, "/users/me", nil, &me); err != nil {
		return "", false, err
	}
	return me.ID, me.IsAdmin, nil
}

func (h *Handlers) fetchImmichAlbums(ctx context.Context, spec immichSpec, imageURL func(mediaImageRef) string) (MediaResult, map[mediaImageRef]bool, error) {
	result := MediaResult{Items: []MediaItem{}, Libraries: []MediaGroup{{ID: "albums", Name: "Albums"}}}
	images := map[mediaImageRef]bool{}
	if spec.Server == "" || spec.CredentialID == "" {
		return result, images, errMediaNotSetUp
	}
	credential, ok := lookupHealthCredential(spec.CredentialID)
	if !ok {
		return result, images, errMediaNotSetUp
	}
	var albums []immichAlbum
	if err := h.immichGet(ctx, spec.Server, credential, "/albums", nil, &albums); err != nil {
		return result, images, err
	}
	// Who "I" am tells a shared album from my own, and what someone else made.
	// A key that cannot say leaves every album as it is.
	me, _, _ := h.immichMe(ctx, spec.Server, credential)

	kept := albums[:0]
	for _, album := range albums {
		ownerID, _ := album.owner()
		mine := me == "" || ownerID == me
		switch spec.Scope {
		case "shared":
			if !album.Shared && mine {
				continue
			}
		case "mine":
			if !mine {
				continue
			}
		}
		kept = append(kept, album)
	}
	switch spec.Sort {
	case "name":
		sort.SliceStable(kept, func(i, j int) bool {
			return strings.ToLower(kept[i].AlbumName) < strings.ToLower(kept[j].AlbumName)
		})
	case "newest":
		sort.SliceStable(kept, func(i, j int) bool { return immichRFC(kept[i].EndDate) > immichRFC(kept[j].EndDate) })
	case "count":
		sort.SliceStable(kept, func(i, j int) bool { return kept[i].AssetCount > kept[j].AssetCount })
	default:
		sort.SliceStable(kept, func(i, j int) bool { return kept[i].changed() > kept[j].changed() })
	}
	for _, album := range kept {
		if len(result.Items) >= spec.Rows {
			break
		}
		item := MediaItem{
			ID:        album.ID,
			Title:     album.AlbumName,
			Kind:      "album",
			Count:     album.AssetCount,
			Overview:  trimToLength(strings.TrimSpace(album.Description), jellyfinMaxOverview),
			Library:   "Albums",
			LibraryID: "albums",
			AddedAt:   album.changed(),
			OpenURL:   spec.Server + "/albums/" + url.PathEscape(album.ID),
		}
		if end := immichRFC(album.EndDate); end > 0 {
			item.Year = time.UnixMilli(end).UTC().Year()
		}
		if ownerID, name := album.owner(); me != "" && ownerID != me {
			item.Who = name
		}
		if album.AlbumThumbnailID != "" {
			small := immichImageRef(album.AlbumThumbnailID, "poster", album.UpdatedAt)
			large := immichImageRef(album.AlbumThumbnailID, "backdrop", album.UpdatedAt)
			item.Poster, item.Backdrop = imageURL(small), imageURL(large)
			images[small], images[large] = true, true
		}
		result.Items = append(result.Items, item)
	}
	return result, images, nil
}

func (h *Handlers) fetchImmichPeople(ctx context.Context, spec immichSpec, imageURL func(mediaImageRef) string) (MediaResult, map[mediaImageRef]bool, error) {
	result := MediaResult{Items: []MediaItem{}, Libraries: []MediaGroup{{ID: "people", Name: "People"}}}
	images := map[mediaImageRef]bool{}
	if spec.Server == "" || spec.CredentialID == "" {
		return result, images, errMediaNotSetUp
	}
	credential, ok := lookupHealthCredential(spec.CredentialID)
	if !ok {
		return result, images, errMediaNotSetUp
	}
	people, err := h.immichPeople(ctx, spec.Server, credential)
	if err != nil {
		return result, images, err
	}
	for _, person := range people {
		if len(result.Items) >= spec.Rows {
			break
		}
		if spec.Favorites && !person.IsFavorite {
			continue
		}
		small := immichImageRef(person.ID, "poster", person.UpdatedAt)
		result.Items = append(result.Items, MediaItem{
			ID:        person.ID,
			Title:     person.Name,
			Kind:      "person",
			Library:   "People",
			LibraryID: "people",
			Poster:    imageURL(small),
			OpenURL:   spec.Server + "/people/" + url.PathEscape(person.ID),
		})
		images[small] = true
	}
	return result, images, nil
}

type immichPerson struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	IsHidden   bool   `json:"isHidden"`
	IsFavorite bool   `json:"isFavorite"`
	UpdatedAt  string `json:"updatedAt"`
}

// immichPeople lists the people who have a name. Immich sorts them first, so
// one page is enough: nobody is looking for the faces it has not named.
func (h *Handlers) immichPeople(ctx context.Context, server string, credential HealthCredential) ([]immichPerson, error) {
	var page struct {
		People []immichPerson `json:"people"`
	}
	query := url.Values{"size": {strconv.Itoa(immichPeoplePage)}, "page": {"1"}, "withHidden": {"false"}}
	if err := h.immichGet(ctx, server, credential, "/people", query, &page); err != nil {
		return nil, err
	}
	named := page.People[:0]
	for _, person := range page.People {
		if strings.TrimSpace(person.Name) != "" && !person.IsHidden {
			named = append(named, person)
		}
	}
	if len(named) > immichPeopleLimit {
		named = named[:immichPeopleLimit]
	}
	return named, nil
}

// fetchImmichAssetImage asks Immich for a photo's thumbnail or preview.
func (h *Handlers) fetchImmichAssetImage(ctx context.Context, server string, credential HealthCredential, ref mediaImageRef) ([]byte, error) {
	size := "thumbnail"
	if ref.Kind == "backdrop" {
		size = "preview"
	}
	resp, err := h.mediaRequest(ctx, server, credential, "/api/assets/"+mediaPathEscape(ref.Item)+"/thumbnail",
		url.Values{"size": {size}}, "image/*", nil)
	if err != nil {
		return nil, err
	}
	return readMediaImage(resp)
}

// fetchImmichPersonImage asks Immich for a face.
func (h *Handlers) fetchImmichPersonImage(ctx context.Context, server string, credential HealthCredential, ref mediaImageRef) ([]byte, error) {
	resp, err := h.mediaRequest(ctx, server, credential, "/api/people/"+mediaPathEscape(ref.Item)+"/thumbnail",
		nil, "image/*", nil)
	if err != nil {
		return nil, err
	}
	return readMediaImage(resp)
}

// immichAnswerer is one Immich tile's answer, through the shared media cache.
func (h *Handlers) immichAnswerer(service WidgetType, fetch func(*Handlers, context.Context, immichSpec, func(mediaImageRef) string) (MediaResult, map[mediaImageRef]bool, error)) func(context.Context, int, Widget, bool) MediaResult {
	return func(ctx context.Context, pageID int, widget Widget, forced bool) MediaResult {
		spec := immichSpecFrom(service, widget.Config)
		ms := mediaSpec{Service: string(service), Server: spec.Server, CredentialID: spec.CredentialID,
			Fingerprint: spec.fingerprint(), TTL: spec.TTL}
		return h.mediaAnswer(ctx, pageID, widget.ID, ms, func(ctx context.Context, imageURL func(mediaImageRef) string) (MediaResult, map[mediaImageRef]bool, error) {
			return fetch(h, ctx, spec, imageURL)
		}, forced)
	}
}

func (h *Handlers) immichWidgetHandler(service WidgetType) http.HandlerFunc {
	var fetch func(*Handlers, context.Context, immichSpec, func(mediaImageRef) string) (MediaResult, map[mediaImageRef]bool, error)
	switch service {
	case WidgetTypeImmichAlbums:
		fetch = (*Handlers).fetchImmichAlbums
	case WidgetTypeImmichPeople:
		fetch = (*Handlers).fetchImmichPeople
	case WidgetTypeImmichStatus:
		return func(w http.ResponseWriter, r *http.Request) {
			h.serveMediaWidget(w, r, service, h.immichStatusAnswer)
		}
	default:
		fetch = (*Handlers).fetchImmichPhotos
	}
	answer := h.immichAnswerer(service, fetch)
	return func(w http.ResponseWriter, r *http.Request) {
		h.serveMediaWidget(w, r, service, answer)
	}
}

func (h *Handlers) immichImageHandler(service WidgetType) http.HandlerFunc {
	fetch := h.fetchImmichAssetImage
	if service == WidgetTypeImmichPeople {
		fetch = h.fetchImmichPersonImage
	}
	return func(w http.ResponseWriter, r *http.Request) {
		h.serveMediaImage(w, r, string(service), fetch)
	}
}

/*
immichSetupHandler tries an address and a key, and lists the albums and the
people that can be chosen.

Behind the write token, and takes a key that is typed but not yet saved, like
the other media setups: the key is used for this one request and written
nowhere. Who the key belongs to proves it, because the server's version is
public.
*/
func (h *Handlers) immichSetupHandler(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if !h.requireWriteAccess(w, r) || !h.requireSSRFAPIRateLimit(w, r) {
		return
	}
	var body map[string]any
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&body); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	type choice struct {
		ID    string `json:"id"`
		Name  string `json:"name"`
		Count int    `json:"count,omitempty"`
	}
	answer := struct {
		ServerName string `json:"serverName,omitempty"`
		Version    string `json:"version,omitempty"`
		// Admin is absent when the key may not say who it belongs to.
		Admin  *bool    `json:"admin,omitempty"`
		Albums []choice `json:"albums"`
		People []choice `json:"people"`
		Error  string   `json:"error,omitempty"`
	}{Albums: []choice{}, People: []choice{}}
	reply := func(err error) {
		if err != nil {
			logWarn(logComponentWidgets, "Immich setup for %s: %v", hostOf(stringOr(body["server"])), err)
			answer.Error = mediaErrorCode(err)
		}
		_ = json.NewEncoder(w).Encode(answer)
	}

	server := strings.TrimRight(sanitizeWidgetURL(stringOr(body["server"])), "/")
	var credential HealthCredential
	if draft := draftCredentialFrom(body["draftCredential"]); draft != nil {
		credential = *draft
	} else if stored, ok := lookupHealthCredential(stringOr(body["credentialId"])); ok {
		credential = stored
	} else {
		reply(errMediaNotSetUp)
		return
	}
	if server == "" {
		reply(errMediaNotSetUp)
		return
	}
	_, admin, err := h.immichMe(r.Context(), server, credential)
	switch {
	case err == nil:
		answer.Admin = &admin
	case errors.Is(err, errMediaRefused):
		// A key made with only the permissions the photos need is refused
		// here (the user's own record is a permission of its own), which is
		// no reason to refuse the key: the albums prove it.
		var probe []immichAlbum
		if probeErr := h.immichGet(r.Context(), server, credential, "/albums", nil, &probe); probeErr != nil {
			reply(probeErr)
			return
		}
	default:
		reply(err)
		return
	}
	var about struct {
		Version string `json:"version"`
	}
	_ = h.immichGet(r.Context(), server, credential, "/server/about", nil, &about)
	answer.ServerName, answer.Version = "Immich", about.Version

	var albums []immichAlbum
	if err := h.immichGet(r.Context(), server, credential, "/albums", nil, &albums); err == nil {
		sort.SliceStable(albums, func(i, j int) bool {
			return strings.ToLower(albums[i].AlbumName) < strings.ToLower(albums[j].AlbumName)
		})
		for _, album := range albums {
			answer.Albums = append(answer.Albums, choice{ID: album.ID, Name: album.AlbumName, Count: album.AssetCount})
		}
	}
	if people, err := h.immichPeople(r.Context(), server, credential); err == nil {
		for _, person := range people {
			answer.People = append(answer.People, choice{ID: person.ID, Name: person.Name})
		}
	}
	reply(nil)
}
