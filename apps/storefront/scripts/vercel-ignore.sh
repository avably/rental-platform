#!/bin/sh
# exit 0 = POMIŃ build, exit 1 = BUDUJ (kontrakt Vercela: kod != 0 => build).
#
# Porównujemy z OSTATNIM WDROŻONYM commitem (VERCEL_GIT_PREVIOUS_SHA), NIE z HEAD^.
# HEAD^ patrzył tylko na jeden, ostatni commit — przy szybkich/naprzemiennych
# merge'ach do main gubił zmiany aplikacji: build dotykający sklepu bywał
# auto-anulowany przez kolejny (np. panel-only) commit, a build tego kolejnego
# pomijał sklep, bo JEGO HEAD^..HEAD nie tykał katalogu sklepu. Efekt: produkcja
# stała na starym kodzie bez żadnego czerwonego sygnału (incydent 2026-08-25:
# sekcja kategorii i wyszukiwarka nie trafiły na prod przez ~7h). Diff od
# ostatniego WDROŻENIA łapie każdą zmianę w oknie, niezależnie od kolejności.
#
# Brak sha ostatniego wdrożenia / poza płytkim klonem / błąd => budujemy (bezpiecznie).
base="$VERCEL_GIT_PREVIOUS_SHA"
[ -n "$base" ] || exit 1
git cat-file -e "${base}^{commit}" 2>/dev/null || git fetch --depth=1 origin "$base" >/dev/null 2>&1 || exit 1
git cat-file -e "${base}^{commit}" 2>/dev/null || exit 1
git diff --quiet "$base" HEAD -- :/apps/storefront :/packages/core :/packages/db :/packages/emails :/packages/review :/packages/security :/packages/ui :/package.json :/pnpm-lock.yaml :/pnpm-workspace.yaml :/turbo.json
