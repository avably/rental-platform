#!/usr/bin/env bash
#
# Bramka CI: klient SERVICE-ROLE żyje wyłącznie w webhookach i jobach.
#
# DLACZEGO OSOBNY SKRYPT, SKORO JEST REGUŁA ESLINTA. Reguła
# `no-restricted-imports` (apps/*/eslint.config.mjs) łapie IMPORT
# `@avably/db/service` — i to dobrze. Ale nie łapie drugiej drogi do tej samej
# władzy: sięgnięcia po `SUPABASE_SERVICE_ROLE_KEY` wprost i zbudowania
# klienta ręcznie przez `createClient(url, key)`. To dwie linijki, przechodzą
# lint na zielono i omijają RLS tak samo skutecznie. Ta bramka pilnuje NAZWY
# SEKRETU, nie nazwy importu — czyli tego, co realnie daje uprawnienia.
#
# Druga rzecz: reguła ESLinta jest konfigurowana PER APLIKACJA. Nowa aplikacja
# w `apps/` startuje bez niej i nikt tego nie zauważy. Ten skrypt skanuje całe
# drzewo, więc nowa aplikacja jest objęta od pierwszego commita.
#
# CO WOLNO (i tylko to):
#   packages/db/src/service.ts        — JEDYNA fabryka klienta service-role,
#   apps/*/app/api/webhooks/**        — webhooki dostawców (ADR-054, ADR-067),
#   apps/*/src/jobs/**                — zadania uruchamiane poza żądaniem.
#
# CZEGO SKRYPT ŚWIADOMIE NIE ŁAPIE: `SUPABASE_LOCAL_SERVICE_ROLE_KEY`. To inna
# zmienna — harness testów integracyjnych, który MUSI widzieć obie strony
# izolacji, żeby móc udowodnić, że ona działa (patrz nagłówek
# packages/db/test/rls-isolation.test.ts). Klucz lokalnego Supabase nie
# istnieje na produkcji.
#
# Linie komentarza są pomijane: ten plik i nagłówki modułów muszą móc
# NAZWAĆ regułę, nie łamiąc jej.
set -euo pipefail

# `eslint.config.mjs` musi NAZWAĆ zakazany moduł, żeby go zakazać — to
# definicja reguły, nie jej złamanie. Wpis jest wąski (dokładnie ten plik),
# więc nie da się pod nim przemycić kodu.
ALLOWED='^(packages/db/src/service\.ts|apps/[^/]+/app/api/webhooks/|apps/[^/]+/src/jobs/|apps/[^/]+/eslint\.config\.mjs)'

# Wzorce, z których każdy oznacza „ta ścieżka może omijać RLS".
PATTERNS='SUPABASE_SERVICE_ROLE_KEY|@avably/db/service|createServiceClient'

HITS=$(
  grep -rnE "$PATTERNS" apps packages \
    --include='*.ts' --include='*.tsx' --include='*.mjs' \
    2>/dev/null \
  | grep -vE 'SUPABASE_LOCAL_SERVICE_ROLE_KEY' \
  | awk -F: '{ line = $0; sub(/^[^:]*:[^:]*:/, "", line); gsub(/^[ \t]*/, "", line);
               if (line ~ /^(\/\/|\*|\/\*)/) next; print }' \
  | grep -vE "^($ALLOWED)" \
  || true
)

if [ -n "$HITS" ]; then
  echo "Klient service-role omija RLS — dozwolony wyłącznie w packages/db/src/service.ts,"
  echo "apps/*/app/api/webhooks/** i apps/*/src/jobs/**. Znaleziono poza tymi ścieżkami:"
  echo "$HITS"
  exit 1
fi

echo "service-role: brak wystąpień poza webhookami, jobami i fabryką klienta."
