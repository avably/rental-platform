#!/usr/bin/env bash
#
# Sprzątanie po jobie na WŁASNYM sprzęcie (runner mac-pm): efemeryczny stack
# Supabase CI nie może przeżyć joba ani zostawiać wolumenów — dysk i 4 GiB
# pamięci colimy są współdzielone z deweloperskim Supabase i kontenerami WP.
#
# GUARD: `supabase stop` wykonujemy WYŁĄCZNIE, gdy config wskazuje instancję
# CI (project_id "db-ci"). Gdyby łatka izolacji nie doszła do skutku, stop na
# niepatchowanym configu zatrzymałby WSPÓŁDZIELONEGO Supabase deweloperów.
#
# Pas bezpieczeństwa: cokolwiek zostało z projektu db-ci (padnięty stop,
# ubity job), zdejmujemy po nazwach — filtr "_db-ci" NIE pasuje do zasobów
# współdzielonych (te kończą się na "_db", bez sufiksu "-ci").
#
# Krok stoi pod `if: always()` — bez `set -e`, sprzątanie ma dosprzątać ile
# się da, nie wywracać się na pierwszym braku.
set -uo pipefail

CONFIG="packages/db/supabase/config.toml"
if grep -qE '^project_id = "db-ci"$' "$CONFIG" 2>/dev/null; then
  (cd packages/db && supabase stop --no-backup) \
    || echo "supabase stop nie powiódł się — dosprzątam po nazwach zasobów"
else
  echo 'Pomijam `supabase stop`: config nie wskazuje instancji CI (db-ci) — nie tykam instancji współdzielonej.'
fi

LEFTOVER=$(docker ps -aq --filter "name=_db-ci" 2>/dev/null || true)
[ -n "$LEFTOVER" ] && docker rm -f $LEFTOVER

VLEFT=$(docker volume ls -q --filter "name=_db-ci" 2>/dev/null || true)
[ -n "$VLEFT" ] && docker volume rm -f $VLEFT

NLEFT=$(docker network ls -q --filter "name=_db-ci" 2>/dev/null || true)
[ -n "$NLEFT" ] && docker network rm $NLEFT 2>/dev/null

echo "Zasoby db-ci po sprzątaniu: kontenery=$(docker ps -aq --filter 'name=_db-ci' | grep -c . || true)," \
  "wolumeny=$(docker volume ls -q --filter 'name=_db-ci' | grep -c . || true)," \
  "sieci=$(docker network ls -q --filter 'name=_db-ci' | grep -c . || true)"
exit 0
