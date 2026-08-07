#!/usr/bin/env bash
# Buduje PRODUKCYJNE wersje storefrontu i panelu pod testy e2e.
#
# Dlaczego produkcyjny build, nie dev: Next w trybie dev blokuje zasoby dla
# 127.0.0.1 (SSR jest, hydracji nie ma — klik nic nie robi), a dev-Turbopack
# flakuje. E2E ma dowodzić zachowania produkcyjnego builda.
#
# NEXT_PUBLIC_* to stałe BUILD-TIME (wmurowane w bundle): env musi być
# ustawione PRZED `next build`; restart serwera z inną wartością nic nie
# zmienia. Dlatego build bierze adres i klucz lokalnego Supabase z tych samych
# zmiennych SUPABASE_LOCAL_*, których używają testy integracyjne repo.
set -euo pipefail

cd "$(dirname "$0")/../../.."

: "${SUPABASE_LOCAL_API_URL:?Ustaw SUPABASE_LOCAL_API_URL (packages/db: supabase status -o env)}"
: "${SUPABASE_LOCAL_ANON_KEY:?Ustaw SUPABASE_LOCAL_ANON_KEY (packages/db: supabase status -o env)}"

export NEXT_PUBLIC_SUPABASE_URL="$SUPABASE_LOCAL_API_URL"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="$SUPABASE_LOCAL_ANON_KEY"

# Lokalnie wołaj z PNPM_CMD="corepack pnpm" (goły pnpm 8.x psuje lockfile);
# w CI pnpm/action-setup daje właściwą wersję pod nazwą `pnpm`.
PNPM_CMD="${PNPM_CMD:-pnpm}"

$PNPM_CMD --filter storefront run build
$PNPM_CMD --filter panel run build
