package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

/*
Sonarr and Radarr: what is coming, and what is downloading.

One client for both: they share API v3, the X-Api-Key header and the shape of
their calendar and queue, and differ only in whether a line is an episode of a
series or a film. Drawn through the shared media tile, so the posters come
through the same proxy as Jellyfin's and the key never reaches the browser.

The two parts are the tile's groups: Upcoming and Queue. Either may be
switched off, and one failing leaves the other on screen.
*/

const (
	arrDefaultDays = 7
	arrDefaultRows = 6
	arrDefaultTTL  = 300
	// arrQueuePage bounds one queue read. A tile shows a handful.
	arrQueuePage = 50
)

type arrKind struct {
	Service string
	Name    string
	Series  bool
}

var (
	arrSonarr = arrKind{Service: "sonarr", Name: "Sonarr", Series: true}
	arrRadarr = arrKind{Service: "radarr", Name: "Radarr", Series: false}
)

type arrSpec struct {
	Server       string
	CredentialID string
	Show         string
	Days         int
	Rows         int
	TTL          time.Duration
}

func arrSpecFrom(config map[string]any) arrSpec {
	spec := arrSpec{
		Server:       strings.TrimRight(stringOr(config["server"]), "/"),
		CredentialID: stringOr(config["credentialId"]),
		Show:         stringOr(config["show"]),
		Days:         arrDefaultDays,
		Rows:         arrDefaultRows,
		TTL:          arrDefaultTTL * time.Second,
	}
	if spec.Show == "" {
		spec.Show = "both"
	}
	if days, ok := widgetConfigInt(config["days"]); ok && days > 0 {
		spec.Days = clampInt(days, 1, 30)
	}
	if rows, ok := widgetConfigInt(config["rows"]); ok && rows > 0 {
		spec.Rows = clampInt(rows, widgetMinRows, widgetMaxRows)
	}
	if ttl, ok := widgetConfigInt(config["ttl"]); ok && ttl > 0 {
		spec.TTL = time.Duration(clampInt(ttl, 60, 3600)) * time.Second
	}
	return spec
}

func (spec arrSpec) fingerprint() string {
	return strings.Join([]string{spec.Server, spec.CredentialID, spec.Show,
		strconv.Itoa(spec.Days), strconv.Itoa(spec.Rows)}, "|")
}

type arrImage struct {
	CoverType string `json:"coverType"`
	URL       string `json:"url"`
	RemoteURL string `json:"remoteUrl"`
}

type arrSeries struct {
	ID        int        `json:"id"`
	Title     string     `json:"title"`
	TitleSlug string     `json:"titleSlug"`
	Year      int        `json:"year"`
	Overview  string     `json:"overview"`
	Genres    []string   `json:"genres"`
	Images    []arrImage `json:"images"`
}

type arrMovie struct {
	ID              int        `json:"id"`
	Title           string     `json:"title"`
	TitleSlug       string     `json:"titleSlug"`
	Year            int        `json:"year"`
	Overview        string     `json:"overview"`
	Genres          []string   `json:"genres"`
	Runtime         int        `json:"runtime"`
	InCinemas       string     `json:"inCinemas"`
	DigitalRelease  string     `json:"digitalRelease"`
	PhysicalRelease string     `json:"physicalRelease"`
	Images          []arrImage `json:"images"`
}

type arrEpisode struct {
	ID            int        `json:"id"`
	SeriesID      int        `json:"seriesId"`
	SeasonNumber  int        `json:"seasonNumber"`
	EpisodeNumber int        `json:"episodeNumber"`
	Title         string     `json:"title"`
	AirDateUtc    string     `json:"airDateUtc"`
	Series        *arrSeries `json:"series"`
}

type arrQueueRecord struct {
	ID       int         `json:"id"`
	SeriesID int         `json:"seriesId"`
	MovieID  int         `json:"movieId"`
	Title    string      `json:"title"`
	Size     float64     `json:"size"`
	SizeLeft float64     `json:"sizeleft"`
	TimeLeft string      `json:"timeleft"`
	Series   *arrSeries  `json:"series"`
	Episode  *arrEpisode `json:"episode"`
	Movie    *arrMovie   `json:"movie"`
}

/*
arrPosterRef reads a picture address the service handed out.

Only its own /MediaCover/<id>/<file>?lastWrite=<n> form is accepted: the id
becomes the item, lastWrite the tag, so a changed picture is a new address.
Anything else -- an absolute remote URL, another path -- is left out rather
than proxied, because the proxy only ever fetches from the service itself.

The calendar is the exception that made this necessary: Sonarr v4 sends the
series' pictures there with only a remoteUrl (TVDB), no local address. The
service still holds the picture under /MediaCover/<series id>, so with an id
the ref is made from that, and the tag is a hash of the remote address -- new
artwork, new address. The remote host itself is never asked.
*/
func arrPosterRef(images []arrImage, coverType string, ownerID ...int) (mediaImageRef, bool) {
	kind := "poster"
	if coverType == "fanart" {
		kind = "backdrop"
	}
	for _, image := range images {
		if image.CoverType != coverType {
			continue
		}
		if image.URL == "" && image.RemoteURL != "" && len(ownerID) > 0 && ownerID[0] > 0 {
			sum := sha256.Sum256([]byte(image.RemoteURL))
			return mediaImageRef{Item: strconv.Itoa(ownerID[0]), Kind: kind, Tag: hex.EncodeToString(sum[:])[:12]}, true
		}
		parsed, err := url.Parse(image.URL)
		if err != nil || parsed.Host != "" {
			continue
		}
		parts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
		// Some installs sit under a base path: /sonarr/MediaCover/7/poster.jpg.
		for i := 0; i+2 < len(parts); i++ {
			if parts[i] != "MediaCover" {
				continue
			}
			if _, err := strconv.Atoi(parts[i+1]); err != nil {
				break
			}
			tag := parsed.Query().Get("lastWrite")
			if tag == "" {
				tag = "0"
			}
			return mediaImageRef{Item: parts[i+1], Kind: kind, Tag: tag}, true
		}
	}
	return mediaImageRef{}, false
}

func (h *Handlers) arrGet(ctx context.Context, spec arrSpec, credential HealthCredential, path string, query url.Values, out any) error {
	ctx, cancel := context.WithTimeout(ctx, mediaRequestTimeout)
	defer cancel()
	resp, err := h.mediaRequest(ctx, spec.Server, credential, path, query, "application/json", nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if err := json.NewDecoder(io.LimitReader(resp.Body, jellyfinMaxBody)).Decode(out); err != nil {
		return fmt.Errorf("%w: %v", errMediaUnreachable, err)
	}
	return nil
}

// arrItem fills what a calendar line and a queue line share: the title and
// pictures of the series or film, and where a click goes.
// ownerID is the series or film id the service files its pictures under,
// for lines whose pictures carry only a remote address.
func arrItem(kind arrKind, spec arrSpec, series *arrSeries, movie *arrMovie, ownerID int, imageURL func(mediaImageRef) string, images map[mediaImageRef]bool) MediaItem {
	var item MediaItem
	var pictures []arrImage
	if series != nil {
		item.Title, item.Year, item.Overview, item.Genres = series.Title, series.Year, series.Overview, series.Genres
		item.Kind = "episode"
		item.OpenURL = spec.Server + "/series/" + url.PathEscape(series.TitleSlug)
		pictures = series.Images
		if series.ID > 0 {
			ownerID = series.ID
		}
	}
	if movie != nil {
		item.Title, item.Year, item.Overview, item.Genres = movie.Title, movie.Year, movie.Overview, movie.Genres
		item.RuntimeMinutes = movie.Runtime
		item.Kind = "movie"
		item.OpenURL = spec.Server + "/movie/" + url.PathEscape(movie.TitleSlug)
		pictures = movie.Images
		if movie.ID > 0 {
			ownerID = movie.ID
		}
	}
	if item.Overview != "" {
		item.Overview = trimToLength(strings.TrimSpace(item.Overview), jellyfinMaxOverview)
	}
	if ref, ok := arrPosterRef(pictures, "poster", ownerID); ok {
		item.Poster = imageURL(ref)
		images[ref] = true
	}
	if ref, ok := arrPosterRef(pictures, "fanart", ownerID); ok {
		item.Backdrop = imageURL(ref)
		images[ref] = true
	}
	return item
}

func episodeLabel(episode *arrEpisode) string {
	if episode == nil {
		return ""
	}
	return fmt.Sprintf("S%02dE%02d · %s", episode.SeasonNumber, episode.EpisodeNumber, episode.Title)
}

// radarrDate is when a film arrives within the window: the digital release
// first, then the physical one, then the cinema. Zero if none falls inside.
func radarrDate(movie arrMovie, start, end time.Time) time.Time {
	for _, raw := range []string{movie.DigitalRelease, movie.PhysicalRelease, movie.InCinemas} {
		if at, err := time.Parse(time.RFC3339, raw); err == nil && !at.Before(start) && !at.After(end) {
			return at
		}
	}
	return time.Time{}
}

func (h *Handlers) arrUpcoming(ctx context.Context, kind arrKind, spec arrSpec, credential HealthCredential, now time.Time,
	imageURL func(mediaImageRef) string, images map[mediaImageRef]bool, group MediaGroup) ([]MediaItem, error) {
	start, end := now.UTC(), now.UTC().AddDate(0, 0, spec.Days)
	query := url.Values{"start": {start.Format(time.RFC3339)}, "end": {end.Format(time.RFC3339)}}
	var items []MediaItem
	if kind.Series {
		query.Set("includeSeries", "true")
		var episodes []arrEpisode
		if err := h.arrGet(ctx, spec, credential, "/api/v3/calendar", query, &episodes); err != nil {
			return nil, err
		}
		for _, episode := range episodes {
			at, err := time.Parse(time.RFC3339, episode.AirDateUtc)
			if err != nil {
				continue
			}
			item := arrItem(kind, spec, episode.Series, nil, episode.SeriesID, imageURL, images)
			item.ID = "e" + strconv.Itoa(episode.ID)
			item.Subtitle = episodeLabel(&episode)
			item.When, item.AddedAt = at.UnixMilli(), at.UnixMilli()
			item.Library, item.LibraryID = group.Name, group.ID
			items = append(items, item)
		}
	} else {
		// Release dates are date-only (midnight UTC): from "now" a film out today
		// would drop off after 00:00 UTC, so the window starts at the day.
		start = now.UTC().Truncate(24 * time.Hour)
		query.Set("start", start.Format(time.RFC3339))
		var movies []arrMovie
		if err := h.arrGet(ctx, spec, credential, "/api/v3/calendar", query, &movies); err != nil {
			return nil, err
		}
		for _, movie := range movies {
			at := radarrDate(movie, start, end)
			if at.IsZero() {
				continue
			}
			movie := movie
			item := arrItem(kind, spec, nil, &movie, movie.ID, imageURL, images)
			item.ID = "m" + strconv.Itoa(movie.ID)
			item.When, item.AddedAt = at.UnixMilli(), at.UnixMilli()
			item.Library, item.LibraryID = group.Name, group.ID
			items = append(items, item)
		}
	}
	// Soonest first: a calendar reads forwards.
	sort.SliceStable(items, func(i, j int) bool { return items[i].When < items[j].When })
	if len(items) > spec.Rows {
		items = items[:spec.Rows]
	}
	return items, nil
}

func (h *Handlers) arrQueue(ctx context.Context, kind arrKind, spec arrSpec, credential HealthCredential, now time.Time,
	imageURL func(mediaImageRef) string, images map[mediaImageRef]bool, group MediaGroup) ([]MediaItem, error) {
	query := url.Values{"pageSize": {strconv.Itoa(arrQueuePage)}}
	if kind.Series {
		query.Set("includeSeries", "true")
		query.Set("includeEpisode", "true")
	} else {
		query.Set("includeMovie", "true")
	}
	var page struct {
		Records []arrQueueRecord `json:"records"`
	}
	if err := h.arrGet(ctx, spec, credential, "/api/v3/queue", query, &page); err != nil {
		return nil, err
	}
	var items []MediaItem
	for i, record := range page.Records {
		item := arrItem(kind, spec, record.Series, record.Movie, record.SeriesID+record.MovieID, imageURL, images)
		if item.Title == "" {
			item.Title = record.Title
		}
		item.ID = "q" + strconv.Itoa(record.ID)
		item.Subtitle = episodeLabel(record.Episode)
		// Unknown size is no progress, not a division by zero.
		progress := 0.0
		if record.Size > 0 {
			progress = 1 - record.SizeLeft/record.Size
			if progress < 0 {
				progress = 0
			} else if progress > 1 {
				progress = 1
			}
		}
		item.Progress = &progress
		item.Left = record.TimeLeft
		// The service's own order, kept: a queue is not a timeline.
		item.AddedAt = now.UnixMilli() - int64(i)
		item.Library, item.LibraryID = group.Name, group.ID
		items = append(items, item)
		if len(items) == spec.Rows {
			break
		}
	}
	return items, nil
}

func (h *Handlers) fetchArr(ctx context.Context, kind arrKind, spec arrSpec, now time.Time, imageURL func(mediaImageRef) string) (MediaResult, map[mediaImageRef]bool, error) {
	result := MediaResult{Items: []MediaItem{}, Libraries: []MediaGroup{}}
	images := map[mediaImageRef]bool{}
	if spec.Server == "" || spec.CredentialID == "" {
		return result, images, errMediaNotSetUp
	}
	credential, ok := lookupHealthCredential(spec.CredentialID)
	if !ok {
		return result, images, errMediaNotSetUp
	}

	type part struct {
		group MediaGroup
		read  func(context.Context, arrKind, arrSpec, HealthCredential, time.Time, func(mediaImageRef) string, map[mediaImageRef]bool, MediaGroup) ([]MediaItem, error)
	}
	var parts []part
	if spec.Show != "queue" {
		parts = append(parts, part{MediaGroup{ID: "upcoming", Name: "Upcoming"}, h.arrUpcoming})
	}
	if spec.Show != "upcoming" {
		parts = append(parts, part{MediaGroup{ID: "queue", Name: "Queue"}, h.arrQueue})
	}

	// Both parts at once, each with its own picture set so they do not race.
	type answer struct {
		items  []MediaItem
		images map[mediaImageRef]bool
		err    error
	}
	answers := make([]answer, len(parts))
	var wg sync.WaitGroup
	for i, p := range parts {
		wg.Add(1)
		go func(i int, p part) {
			defer wg.Done()
			own := map[mediaImageRef]bool{}
			items, err := p.read(ctx, kind, spec, credential, now, imageURL, own, p.group)
			answers[i] = answer{items, own, err}
		}(i, p)
	}
	wg.Wait()

	var firstErr error
	for i, p := range parts {
		result.Libraries = append(result.Libraries, p.group)
		if answers[i].err != nil {
			if firstErr == nil {
				firstErr = answers[i].err
			}
			result.Partial = true
			logWarn(logComponentWidgets, "%s %s: %v", kind.Name, p.group.ID, answers[i].err)
			continue
		}
		result.Items = append(result.Items, answers[i].items...)
		for ref := range answers[i].images {
			images[ref] = true
		}
	}
	// One part failing is a gap, flagged Partial; every part failing is the
	// answer.
	failed := 0
	for _, a := range answers {
		if a.err != nil {
			failed++
		}
	}
	if failed > 0 && failed == len(answers) {
		result.Partial = false
		return result, images, firstErr
	}
	return result, images, nil
}

/*
fetchArrImage asks the service for a picture, a 500 px wide copy for a poster.

Through /api/v3/mediacover, not the /MediaCover path the images list names:
that one belongs to the web UI, and to a request carrying only an API key it
answers 200 with the UI's HTML page instead of the picture.
*/
func (h *Handlers) fetchArrImage(ctx context.Context, server string, credential HealthCredential, ref mediaImageRef) ([]byte, error) {
	file := "poster-500.jpg"
	if ref.Kind == "backdrop" {
		file = "fanart.jpg"
	}
	path := "/api/v3/mediacover/" + mediaPathEscape(ref.Item) + "/" + file
	resp, err := h.mediaRequest(ctx, server, credential, path, url.Values{"lastWrite": {ref.Tag}}, "image/*", nil)
	if err != nil {
		return nil, err
	}
	return readMediaImage(resp)
}
