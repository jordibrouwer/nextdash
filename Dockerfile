# Build stage
FROM golang:1.24-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .

# Precompute static asset hashes at build time (served from embed in production).
RUN go run scripts/gen-asset-hashes.go

ARG VERSION=dev
ARG COMMIT=unknown
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo \
    -ldflags "-s -w -X main.buildVersion=${VERSION} -X main.buildCommit=${COMMIT}" \
    -o main .

# Final stage — binary only; static/templates/locales come from go:embed.
FROM alpine:3.21

# monolith saves a whole page as one file, for Config -> Data & backups ->
# Sources -> Local copies. Included because a container is not a place anyone
# can install something into afterwards: without it that feature is present in
# the UI and permanently unavailable, which is worse than not offering it.
# Around 6 MB. Alpine ships 2.8, whose quiet flag is -s where 2.10's is -q --
# archive_monolith.go reads --help and uses whichever this build has.
RUN apk --no-cache add ca-certificates tzdata su-exec monolith \
    && addgroup -S nextdash \
    && adduser -S nextdash -G nextdash

WORKDIR /app

COPY --from=builder /app/main .
COPY scripts/docker-entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh \
    && mkdir -p /app/data && chown nextdash:nextdash /app/data

EXPOSE 8080

ENV PORT=8080

ENTRYPOINT ["/entrypoint.sh"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null || exit 1
