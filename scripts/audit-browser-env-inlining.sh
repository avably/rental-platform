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

pnpm --filter panel build

CHUNK_DIR="apps/panel/.next/static/chunks"
MATCH=$(grep -rl "uploadToSignedUrl" "$CHUNK_DIR" --include='*.js' 2>/dev/null || true)

if [ -z "$MATCH" ]; then
  echo "Nie znaleziono chunka klienckiego zawierającego uploadToSignedUrl w $CHUNK_DIR."
  echo "Sprawdź, czy build panelu się powiódł i czy ścieżka chunków się nie zmieniła."
  exit 1
fi

FOUND=0
for FILE in $MATCH; do
  if grep -qF "$NEXT_PUBLIC_SUPABASE_URL" "$FILE"; then
    FOUND=1
    break
  fi
done

if [ "$FOUND" -ne 1 ]; then
  echo "NEXT_PUBLIC_SUPABASE_URL nie jest wmurowana w bundlu klienckim (chunki:"
  echo "$MATCH"
  echo "). Klient przeglądarkowy dostanie w runtime pusty env i padnie po cichu."
  exit 1
fi

echo "browser-env-inlining: NEXT_PUBLIC_SUPABASE_URL wmurowana w bundlu klienckim panelu."
