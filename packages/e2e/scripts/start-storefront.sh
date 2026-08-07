#!/usr/bin/env bash
# Startuje PRODUKCYJNY serwer storefrontu pod e2e (env dostaje z playwright.config).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

if [ ! -d "$ROOT/apps/storefront/.next" ]; then
  echo "Brak produkcyjnego builda storefrontu — najpierw: pnpm --filter @avably/e2e e2e:build" >&2
  exit 1
fi

# Bezpośrednio bin Nexta z node_modules apki: proces node dostaje NODE_OPTIONS
# (preload stubu Stripe) wprost, bez pośrednika pnpm w PATH.
exec node "$ROOT/apps/storefront/node_modules/next/dist/bin/next" start "$ROOT/apps/storefront" -p "${PORT:?Brak PORT}"
