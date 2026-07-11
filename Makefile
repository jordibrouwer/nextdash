# nextDash — handige Docker-commando's
# Gebruik: `make build` om te herbouwen en op de VOORGROND online te gaan.

.PHONY: build build-clean up down logs

# Herbouw het image en start op de voorgrond (live logs, Ctrl-C stopt).
build:
	docker compose up --build

# Zoals `build`, maar forceert een volledige herbouw zonder layer-cache.
build-clean:
	docker compose build --no-cache
	docker compose up

# Start op de achtergrond.
up:
	docker compose up -d --build

# Stop en ruim de container op.
down:
	docker compose down

# Volg de logs van de draaiende container.
logs:
	docker compose logs -f
