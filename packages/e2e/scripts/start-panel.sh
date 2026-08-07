#!/usr/bin/env bash
# Startuje PRODUKCYJNY serwer panelu pod e2e (env dostaje z playwright.config).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

if [ ! -d "$ROOT/apps/panel/.next" ]; then
  echo "Brak produkcyjnego builda panelu — najpierw: pnpm --filter @avably/e2e e2e:build" >&2
  exit 1
fi

exec node "$ROOT/apps/panel/node_modules/next/dist/bin/next" start "$ROOT/apps/panel" -p "${PORT:?Brak PORT}"
