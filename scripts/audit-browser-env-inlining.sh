#!/usr/bin/env bash
#
# Bramka CI: NEXT_PUBLIC_SUPABASE_URL musi być WMUROWANA w bundlu
# klienckim panelu, nie tylko dostępna serwerowi.
#
# DLACZEGO. Bug: `createBrowserClient()` (packages/db/src/client.ts)
# czytał env DYNAMICZNIE (`process.env[name]`). Turbopack inlinuje
# `NEXT_PUBLIC_*` do bundla przeglądarki wyłącznie przy dostępie
# STATYCZNYM (`process.env.NEXT_PUBLIC_X`) — dynamiczny odczyt kompiluje
# się do pustego shima w przeglądarce. Skutek na produkcji: klient
# przeglądarkowy rzucał w środku uploadu zdjęć, po cichu (photo-forms.tsx
# miał try/finally bez catch) — build i typecheck były zielone, bo env
# na serwerze Vercela jest poprawny i serwer nigdy nie widział bundla
# klienta.
#
# Bramka na NAMALOWANE, nie zadeklarowane: buduje panel z jawnym env,
# potem szuka w SKOMPILOWANYM chunku klienckim, który zawiera
# `uploadToSignedUrl`, pełnej wartości NEXT_PUBLIC_SUPABASE_URL — nie
# samej nazwy zmiennej (deklaracja w kodzie źródłowym nic nie mówi o tym,
# czy bundler ją wmurował) i nie samego hosta (127.0.0.1 występuje w
# chunku także jako wnętrzności @supabase/supabase-js — allowlista
# tracingu — więc szukanie samego hosta byłoby fałszywie zielone z
# konstrukcji).
set -euo pipefail

: "${NEXT_PUBLIC_SUPABASE_URL:?ustaw NEXT_PUBLIC_SUPABASE_URL przed budową panelu}"
: "${NEXT_PUBLIC_SUPABASE_ANON_KEY:?ustaw NEXT_PUBLIC_SUPABASE_ANON_KEY przed budową panelu}"
# ADR-142: warstwa kluczy czyta NOWĄ nazwę z fallbackiem na starą — OBA
# statyczne odczyty muszą przetrwać do bundla, inaczej fallback dwu-nazwowy
# istnieje tylko w źródle, a wyłączenie legacy wywróci produkcję po cichu.
: "${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:?ustaw NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY przed budową panelu}"

pnpm --filter panel build

CHUNK_DIR="apps/panel/.next/static/chunks"
MATCH=$(grep -rl "uploadToSignedUrl" "$CHUNK_DIR" --include='*.js' 2>/dev/null || true)

if [ -z "$MATCH" ]; then
  echo "Nie znaleziono chunka klienckiego zawierającego uploadToSignedUrl w $CHUNK_DIR."
  echo "Sprawdź, czy build panelu się powiódł i czy ścieżka chunków się nie zmieniła."
  exit 1
fi

# CO DOKŁADNIE MA BYĆ WMUROWANE — semantyka fallbacku ADR-142 przy inliningu:
# Turbopack podstawia OBA statyczne odczyty warstwy i CONSTANT-FOLDUJE wynik,
# więc artefakt niesie WYNIK fallbacku (przy obu zmiennych = wartość NOWEJ
# nazwy), a nie obie wartości. Sprawdzamy więc URL + wartość nowej nazwy.
# Wartości legacy w artefakcie NIE wymagamy (byłoby to przypinanie wnętrz
# minifikatora, nie naszego kontraktu); gałąź legacy-only ma dowód budowy
# w dzienniku ADR-142, a mechanika fallbacku — testy jednostkowe warstwy.
for VAR_NAME in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY; do
  VAR_VALUE="${!VAR_NAME}"
  FOUND=0
  for FILE in $MATCH; do
    if grep -qF "$VAR_VALUE" "$FILE"; then
      FOUND=1
      break
    fi
  done

  if [ "$FOUND" -ne 1 ]; then
    echo "$VAR_NAME nie jest wmurowana w bundlu klienckim (chunki:"
    echo "$MATCH"
    echo "). Klient przeglądarkowy dostanie w runtime pusty env i padnie po cichu."
    exit 1
  fi
done

# MIDDLEWARE TEŻ (lekcja: NEXT_PUBLIC_* jest build-time również w proxy.ts).
# Panel woła createServerClient w proxy — warstwa ADR-142 musi być wmurowana
# także w skompilowany artefakt middleware'u, inaczej odświeżanie sesji
# dostanie pusty env mimo zielonego bundla klienckiego. `middleware.js` jest
# LOADEREM (Turbopack): realny kod żyje w chunkach, które loader wymienia —
# listę bierzemy z niego, nie z założeń o nazwach plików.
MIDDLEWARE_LOADER="apps/panel/.next/server/middleware.js"
if [ ! -f "$MIDDLEWARE_LOADER" ]; then
  echo "Nie znaleziono skompilowanego middleware'u ($MIDDLEWARE_LOADER)."
  echo "Sprawdź, czy build panelu wyemitował artefakt proxy i zaktualizuj ścieżkę bramki."
  exit 1
fi
MIDDLEWARE_CHUNKS=$(grep -o 'server/chunks/[^"]*\.js' "$MIDDLEWARE_LOADER" | sort -u)
if [ -z "$MIDDLEWARE_CHUNKS" ]; then
  echo "Loader middleware'u nie wymienia żadnych chunków — format artefaktu się zmienił, zaktualizuj bramkę."
  exit 1
fi
for VAR_NAME in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY; do
  VAR_VALUE="${!VAR_NAME}"
  FOUND=0
  while IFS= read -r CHUNK; do
    if grep -qF "$VAR_VALUE" "apps/panel/.next/$CHUNK"; then
      FOUND=1
      break
    fi
  done <<< "$MIDDLEWARE_CHUNKS"

  if [ "$FOUND" -ne 1 ]; then
    echo "$VAR_NAME nie jest wmurowana w chunkach middleware'u:"
    echo "$MIDDLEWARE_CHUNKS"
    echo "Proxy dostanie w runtime pusty env — sesje/rozwiązywanie tenanta padną po cichu."
    exit 1
  fi
done

echo "browser-env-inlining: NEXT_PUBLIC_SUPABASE_URL i wynik warstwy kluczy (NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) wmurowane w bundlu klienckim i middleware panelu."
