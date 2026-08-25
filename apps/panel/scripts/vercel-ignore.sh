#!/bin/sh
# exit 0 = POMIŃ build, exit 1 = BUDUJ (kontrakt Vercela: kod != 0 => build).
#
# Porównujemy z OSTATNIM WDROŻONYM commitem (VERCEL_GIT_PREVIOUS_SHA), NIE z HEAD^.
# HEAD^ patrzył tylko na jeden, ostatni commit — przy szybkich/naprzemiennych
# merge'ach do main gubił zmiany aplikacji: build dotykający panelu bywał
# auto-anulowany przez kolejny (np. sklep-only) commit, a build tego kolejnego
# pomijał panel, bo JEGO HEAD^..HEAD nie tykał katalogu panelu. Efekt: produkcja
# stała na starym kodzie bez żadnego czerwonego sygnału. Diff od ostatniego
# WDROŻENIA łapie każdą zmianę w oknie, niezależnie od kolejności merge'ów.
#
# Brak sha ostatniego wdrożenia / poza płytkim klonem / błąd => budujemy (bezpiecznie).
base="$VERCEL_GIT_PREVIOUS_SHA"
[ -n "$base" ] || exit 1
git cat-file -e "${base}^{commit}" 2>/dev/null || git fetch --depth=1 origin "$base" >/dev/null 2>&1 || exit 1
git cat-file -e "${base}^{commit}" 2>/dev/null || exit 1
git diff --quiet "$base" HEAD -- :/apps/panel :/packages/core :/packages/db :/packages/emails :/packages/pdf :/packages/review :/packages/security :/packages/ui :/package.json :/pnpm-lock.yaml :/pnpm-workspace.yaml :/turbo.json
