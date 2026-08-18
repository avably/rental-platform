#!/bin/sh
# exit 0 = POMIŃ build, exit 1 = BUDUJ (kontrakt Vercela).
# Brak rodzica (pierwszy build, płytki klon) => budujemy.
git rev-parse HEAD^ >/dev/null 2>&1 || exit 1
git diff --quiet HEAD^ HEAD -- :/apps/panel :/packages/core :/packages/db :/packages/emails :/packages/pdf :/packages/review :/packages/security :/packages/ui :/package.json :/pnpm-lock.yaml :/pnpm-workspace.yaml :/turbo.json
