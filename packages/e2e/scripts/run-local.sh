#!/usr/bin/env bash
# Lokalne uruchomienie suity e2e: eksportuje zmienne lokalnego Supabase
# (ten sam kontrakt co job `rls`/`e2e` w CI) i odpala Playwrighta.
# Wymaga: uruchomionego lokalnego Supabase, zbudowanych apek (e2e:build)
# i pobranego Chromium (playwright install chromium).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

cd "$ROOT/packages/db"
eval "$(supabase status -o env)"
export SUPABASE_LOCAL_URL="$DB_URL"
export SUPABASE_LOCAL_API_URL="$API_URL"
export SUPABASE_LOCAL_ANON_KEY="$ANON_KEY"
export SUPABASE_LOCAL_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"

cd "$ROOT/packages/e2e"
PNPM_CMD="${PNPM_CMD:-pnpm}"
exec $PNPM_CMD exec playwright test "$@"
