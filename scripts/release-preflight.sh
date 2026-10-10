#!/usr/bin/env bash
# The two vulnerability checks a release has to pass, run on this machine
# before anything is merged, tagged or pushed: govulncheck on the Go code and
# Trivy on the built image, with the same thresholds as ci.yml and
# docker-publish.yml. docker-publish.yml scans again, but only after the
# GitHub Release exists, and a finding there leaves a release with no image.
#
# Builds for this machine's own platform. CI scans amd64; the Alpine packages
# and the Go modules are the same on both, so a clean arm64 scan stands for it.
#
# Usage: bash scripts/release-preflight.sh   (from the repository root)
# Exit 0 when clean, 1 on a finding or when Docker is not running.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

IMAGE="nextdash:preflight"
TRIVY_IMAGE="aquasec/trivy:0.75.0"

echo "Preflight 1/2: govulncheck..."
if ! go run golang.org/x/vuln/cmd/govulncheck@v1.1.4 ./...; then
  echo "Preflight: govulncheck found known vulnerabilities (see above). Fix them on dev first." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "Preflight: Docker is not running, so the image cannot be scanned. Start Docker and run this again." >&2
  exit 1
fi

echo "Preflight 2/2: building ${IMAGE} and scanning it with Trivy..."
docker build -q -t "$IMAGE" . >/dev/null
status=0
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock "$TRIVY_IMAGE" \
  image --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 --no-progress "$IMAGE" || status=$?
docker image rm "$IMAGE" >/dev/null 2>&1 || true
if [[ "$status" -ne 0 ]]; then
  echo "Preflight: Trivy found HIGH or CRITICAL vulnerabilities that have a fix (see above). Fix them on dev first." >&2
  exit 1
fi

echo "Preflight: clean."
