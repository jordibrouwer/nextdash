package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"regexp"
	"strings"
	"time"
)

/*
Glances: how one machine is doing, read from its REST API.

Glances is read only and speaks plain JSON under /api/4. It can sit behind
nothing or a Basic login, so the login is optional; a login it refuses is told
apart from a key (errMediaLogin). Version 3 answers under /api/3 and 404s every
/api/4 path, which is the one thing worth telling the reader in words: needs
Glances 4.

A plugin the server has switched off 404s on its own. That is not a failure:
the part is skipped and the page draws what is there.
*/

const (
	// glancesAPI is the prefix every path is asked under.
	glancesAPI = "/api/4"
	// glancesLargeBody caps the two answers that grow with the machine: every
	// process, every container. Other paths keep the media cap.
	glancesLargeBody = 16 << 20
)

var (
	errGlancesNotFound = errors.New("not available")
	errGlancesNeedsV4  = errors.New("needs Glances 4")
	// errGlancesV5 is a server that answers under /api/5: Glances 5 rewrote the
	// API and its data model, which nextDash does not read yet.
	errGlancesV5 = errors.New("Glances 5 not supported")
)

// Every reading is a pointer: a plugin that leaves one out is absent, not 0.
type glancesQuicklook struct {
	CPU    *float64 `json:"cpu"`
	Mem    *float64 `json:"mem"`
	Swap   *float64 `json:"swap"`
	PerCPU []struct {
		Number *float64 `json:"cpu_number"`
		Total  *float64 `json:"total"`
	} `json:"percpu"`
}

// glancesMaxCores is how many cores get a series of their own.
const glancesMaxCores = 32

type glancesLoad struct {
	Min1  *float64 `json:"min1"`
	Min5  *float64 `json:"min5"`
	Min15 *float64 `json:"min15"`
}

type glancesFS struct {
	MntPoint string   `json:"mnt_point"`
	FSType   string   `json:"fs_type"`
	Percent  *float64 `json:"percent"`
}

// glancesNet carries the rates only when Glances has had two samples to
// subtract. Glances 4 does not report is_up on every build, so a missing
// answer means up.
type glancesNet struct {
	Name     string   `json:"interface_name"`
	IsUp     *bool    `json:"is_up"`
	RecvRate *float64 `json:"bytes_recv_rate_per_sec"`
	SentRate *float64 `json:"bytes_sent_rate_per_sec"`
}

type glancesDiskIO struct {
	Name      string   `json:"disk_name"`
	ReadRate  *float64 `json:"read_bytes_rate_per_sec"`
	WriteRate *float64 `json:"write_bytes_rate_per_sec"`
}

type glancesSensor struct {
	Label    string   `json:"label"`
	Type     string   `json:"type"`
	Value    *float64 `json:"value"`
	Warning  *float64 `json:"warning"`
	Critical *float64 `json:"critical"`
}

// glancesPlausibleLimit is a sensor limit that can be a temperature: Glances
// reports 65261 for sensors that have none, which is a marker, not a limit.
func glancesPlausibleLimit(limit *float64) *float64 {
	if limit == nil || *limit <= 0 || *limit > 150 {
		return nil
	}
	return limit
}

// glancesVirtualNIC is an interface that only carries traffic between things on
// this machine, which would count the same bytes twice.
func glancesVirtualNIC(name string) bool {
	if name == "lo" || name == "tunl0" {
		return true
	}
	// A bond, a bridge and Unraid's shim carry what the physical port under them
	// already carried (eth0 -> bond0 -> br0 would count every byte three times).
	if glancesStackedNIC.MatchString(name) {
		return true
	}
	for _, prefix := range []string{"docker", "veth", "br-", "virbr", "vnet", "vhost", "shim-"} {
		if strings.HasPrefix(name, prefix) {
			return true
		}
	}
	return false
}

var glancesStackedNIC = regexp.MustCompile(`^(bond\d+|br\d+|team\d+)$`)

func (n glancesNet) up() bool { return n.IsUp == nil || *n.IsUp }

// glancesDiskNoise is a block device that is not storage anyone reads: loop,
// RAM and compressed-RAM disks. Unraid alone shows a dozen loop devices.
var glancesDiskNoise = regexp.MustCompile(`^(loop|ram|zram|nbd)\d+$`)

// glancesGet asks one path under /api/4. A 404 is a plugin that is off, except
// for /status, whose 404 is a server that is not version 4: version 5 when
// /api/5/status answers, older otherwise. A refused login is not a refused key.
func (h *Handlers) glancesGet(ctx context.Context, server string, credential HealthCredential, path string, query url.Values, out any) error {
	ctx, cancel := context.WithTimeout(withOutboundLimiter(ctx, glancesOutboundLimiter), mediaRequestTimeout)
	defer cancel()
	resp, err := h.mediaRequest(ctx, server, credential, glancesAPI+path, query, "application/json", nil)
	if err != nil {
		var status *mediaHTTPError
		switch {
		case errors.As(err, &status) && status.Status == 404 && path == "/status":
			if h.glancesAnswersV5(ctx, server, credential) {
				return errGlancesV5
			}
			return errGlancesNeedsV4
		case errors.As(err, &status) && status.Status == 404:
			return errGlancesNotFound
		case errors.Is(err, errMediaRefused):
			return fmt.Errorf("%w: %v", errMediaLogin, err)
		}
		return err
	}
	defer resp.Body.Close()
	limit := int64(jellyfinMaxBody)
	if path == "/processlist" || path == "/containers" {
		limit = glancesLargeBody
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, limit)).Decode(out); err != nil {
		return fmt.Errorf("%w: %v", errMediaUnreachable, err)
	}
	return nil
}

// glancesAnswersV5 reports whether the server answers /api/5/status.
func (h *Handlers) glancesAnswersV5(ctx context.Context, server string, credential HealthCredential) bool {
	resp, err := h.mediaRequest(ctx, server, credential, "/api/5/status", nil, "application/json", nil)
	if err != nil {
		return false
	}
	resp.Body.Close()
	return true
}

// glancesOutboundLimiter is what the page may ask of its one host. The shared
// outbound limit (a minute's worth of requests for everything nextDash fetches)
// is meant for addresses somebody typed in; an open page reads a dozen paths
// every beat from the address in Config, which is its own, much wider, budget.
var glancesOutboundLimiter = newSlidingWindowLimiter(3000, time.Minute)
