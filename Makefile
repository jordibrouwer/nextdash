# nextDash — handige Docker-commando's
# Gebruik: `make build` om te herbouwen en op de VOORGROND online te gaan.

.PHONY: build build-clean up down logs fmt fmt-check reset-data doctor rescue-data

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

# ── Data ────────────────────────────────────────────────────────────────────
# `./data` is een bind-mount, en dat is precies waarom je hem niet zomaar mag
# weggooien. Verwijder je hem terwijl de container draait, dan verdwijnt alleen
# de naam op de host: de mount houdt de directory zelf in leven, de container
# schrijft vrolijk door in iets wat op de host niet meer bestaat, en bij de
# eerstvolgende herstart is die data definitief weg.
#
# De volgorde hieronder is de hele truc: `down` eerst, zodat de mount los is
# voordat er iets verdwijnt. nextDash maakt de map en de standaardbestanden
# daarna zelf opnieuw aan.
#
# Alleen de inhoud wissen terwijl de app draait helpt niet: nextDash houdt
# instellingen en bookmarks in geheugen (storeReadCache) en schrijft die er
# weer overheen. Resetten kan dus alleen met de container gestopt, wat je ook
# met de mount doet.
reset-data:
	@printf 'Dit wist ./data volledig. Doorgaan? [j/N] '; read a; [ "$$a" = "j" ] || exit 1
	docker compose down
	rm -rf ./data
	docker compose up -d --build
	@echo "Data gewist; nextDash heeft verse standaardbestanden aangemaakt."

# Controleert de stille toestand waarin bovenstaande fout je achterlaat: een
# container die draait en gezond meldt, terwijl ./data op de host ontbreekt.
# Niets in de app klaagt daarover, want vanuit de container gezien is er niets
# aan de hand.
doctor:
	@if ! docker ps --format '{{.Names}}' | grep -qx nextdash; then 		echo "nextdash draait niet."; 	elif [ ! -d ./data ]; then 		echo "PROBLEEM: nextdash draait, maar ./data bestaat niet op de host."; 		echo "De container schrijft in een directory die losgekoppeld is van je"; 		echo "bestandssysteem. Bij een herstart is die data weg."; 		echo "Redden kan nu nog met: make rescue-data"; 		exit 1; 	else 		echo "In orde: nextdash draait en ./data bestaat."; 	fi

# Haalt de data uit een draaiende container terug naar de host.
#
# Met tar en niet met `docker cp`: die laatste lost de bind-mount op naar het
# host-pad, en juist dat pad is in dit geval verdwenen -- je krijgt dan een
# lege map terug en denkt dat alles weg is. tar leest van binnenuit de
# container en ziet dus wel wat daar staat.
rescue-data:
	@[ ! -d ./data ] || { echo "./data bestaat al; verplaats of verwijder hem eerst."; exit 1; }
	docker exec nextdash tar cf - -C /app data | tar xf - -C .
	@echo "Teruggezet in ./data. Draai nu 'docker compose up -d --force-recreate'"
	@echo "zodat de mount weer aan deze map hangt in plaats van aan de oude."
