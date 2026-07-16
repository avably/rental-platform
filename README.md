# Avably

Monorepo platformy SaaS do zarządzania wynajmem (multi-tenant).

Produkt międzynarodowy: interfejs EN+PL od startu, kanoniczna domena
`https://www.avably.io`, storefronty tenantów na `*.avably.io`.

## Struktura

```
apps/
  panel/        # Next.js 16 — panel administracyjny (port 3000)
  storefront/   # Next.js 16 — front sklepowy dla klientów (port 3001)
packages/
  db/           # migracje Supabase + wygenerowane typy
  core/         # logika domenowa, wspólna dla apps
  ui/           # współdzielone komponenty UI
```

## Wymagania

- Node 20 (patrz `.nvmrc`)
- pnpm 8.15.8 (patrz `packageManager` w `package.json`)

## Instalacja

```bash
pnpm install
```

## Komendy

```bash
pnpm dev         # uruchamia wszystkie apps w trybie deweloperskim
pnpm build       # buduje wszystkie apps i packages
pnpm typecheck   # sprawdza typy w całym monorepo
pnpm lint        # lintuje całe monorepo
pnpm test        # uruchamia testy (Vitest) we wszystkich packages
```

## Stack

Next.js 16, React 19, TypeScript (strict), Tailwind 4, Supabase (Postgres + Auth),
Turborepo, pnpm workspaces, Vitest.

## CI

Każdy PR i push na `main` uruchamia workflow `ci` (typecheck, lint, test,
`pnpm audit`, audyt publicznych zmiennych środowiskowych) oraz osobny,
równoległy job `rls` — macierz testów izolacji RLS na lokalnym Supabase
uruchomionym w kontenerach (`packages/db/test/rls-isolation.test.ts`,
patrz `docs/konwencje-migracji.md`). Oba joby muszą być zielone przed
mergem.
