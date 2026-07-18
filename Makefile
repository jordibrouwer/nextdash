# nextDash — handige Docker-commando's
# Gebruik: `make build` om te herbouwen en op de VOORGROND online te gaan.

.PHONY: build build-clean up down logs fmt fmt-check

# Formatteer alle Go-bestanden.
fmt:
	gofmt -w .

# Faalt als er ongeformatteerde Go-bestanden zijn (voor CI/pre-commit).
fmt-check:
	@unformatted="$$(gofmt -l .)"; \
	if [ -n "$$unformatted" ]; then \
		echo "gofmt: de volgende bestanden zijn niet geformatteerd:"; \
		echo "$$unformatted"; \
		echo "Draai 'make fmt' om dit te herstellen."; \
		exit 1; \
	fi

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
