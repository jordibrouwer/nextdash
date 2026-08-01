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

RUN apk --no-cache add ca-certificates tzdata \
    && addgroup -S nextdash \
    && adduser -S nextdash -G nextdash

WORKDIR /app

COPY --from=builder /app/main .

RUN mkdir -p /app/data && chown nextdash:nextdash /app/data

USER nextdash

EXPOSE 8080

ENV PORT=8080

CMD ["./main"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null || exit 1
