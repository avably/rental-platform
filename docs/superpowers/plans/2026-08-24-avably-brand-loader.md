# Avably Brand Loader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zbudować zatwierdzony, zapętlony loader marki Avably i użyć go wyłącznie w rzeczywistych stanach oczekiwania panelu.

**Architecture:** `BrandLoader` współdzieli zamrożone krzywe Safiro ze statycznym `BrandLogo`, a ruch realizuje czysty CSS pod `prefers-reduced-motion: no-preference`. Dedykowane skeletony zachowują niewidoczną rezerwę geometrii, ale zamiast szyny pokazują centralny loader; ogólny segment panelu zabezpiecza pozostałe trasy. Kompaktowy wariant jest użyty tylko w długiej operacji przejścia do portalu płatności.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS 4, next-intl, Vitest, React Testing Library.

## Global Constraints

- Próg antymigotania wynosi dokładnie 200 ms.
- Sekwencja wejścia pełnego loadera trwa około 2,2 s, a oddech kropki powtarza się co 3,6 s bez resetowania logo.
- Jedynie kropka `BrandLoader` może mieć nową animację `infinite`; `LoadingRail` i pozostałe skeletony zachowują zakaz pętli.
- `prefers-reduced-motion: reduce` pokazuje natychmiast statyczny stan końcowy bez intro i bez ambient loop.
- Gotowa treść nigdy nie czeka na zakończenie animacji.
- Właściwe empty states po zakończonym pobraniu pozostają statyczne.
- Statyczne SVG/PNG, favicony, `BrandLogo` i `BrandSymbol` pozostają wizualnie bez zmian.
- Bez nowych zależności i bez animacyjnego JavaScriptu.
- Bez merge'a, pushu, PR-a i deployu.

---

### Task 1: Współdzielona geometria i komponent `BrandLoader`

**Files:**
- Create: `apps/panel/components/shell/brand-loader.tsx`
- Create: `apps/panel/test/brand-loader.test.tsx`
- Modify: `apps/panel/components/shell/brand-mark.tsx`
- Modify: `apps/panel/app/globals.css`
- Modify: `apps/panel/test/panel-shell-contract.test.tsx`

**Interfaces:**
- Produces: `BrandWordmark({ className?, pathClassName? })`, współdzielone sześć ścieżek Safiro.
- Produces: `BrandLoader({ label, variant?: "full" | "compact", showLabel?: boolean, className? })`.
- Produces: markery `data-brand-loader`, `data-brand-loader-variant`, `data-brand-loader-capsule`, `data-brand-loader-dot-position`, `data-brand-loader-dot`, `data-brand-loader-wordmark` i `data-brand-loader-letter`.

- [ ] **Step 1: Napisać failing test geometrii i semantyki**

  Test renderuje oba warianty i sprawdza jeden `role="status"`, etykietę, pełne `viewBox="0 0 348 93"`, sześć ścieżek z tymi samymi `d` co `BrandLogo`, brak wordmarku w compact oraz brak duplikacji komunikatu.

  ```tsx
  const full = renderToStaticMarkup(<BrandLoader label="Ładowanie…" variant="full" />);
  const compact = renderToStaticMarkup(<BrandLoader label="Przekierowanie…" variant="compact" />);
  expect(full).toContain('data-brand-loader-variant="full"');
  expect(full.match(/data-brand-loader-letter/g)).toHaveLength(6);
  expect(compact).not.toContain("data-brand-loader-wordmark");
  expect(full.match(/role="status"/g)).toHaveLength(1);
  ```

- [ ] **Step 2: Uruchomić test i potwierdzić RED**

  Run: `pnpm --filter panel exec vitest run test/brand-loader.test.tsx test/panel-shell-contract.test.tsx`

  Expected: FAIL, ponieważ `@/components/shell/brand-loader` nie istnieje.

- [ ] **Step 3: Wydzielić `BrandWordmark` i dodać minimalny komponent**

  `BrandWordmark` renderuje jeden `<g>` i sześć istniejących `<path>` z `data-brand-loader-letter={index}` tylko wtedy, gdy `pathClassName` jest przekazane. `BrandLogo` nadal składa ten sam prostokąt, kropkę i `BrandWordmark`, z identycznym `viewBox`, kolorami i pozycją.

  `BrandLoader` renderuje zewnętrzny `role="status"`, pojedynczą etykietę (`sr-only`, jeśli `showLabel` jest fałszywe) i SVG pod `aria-hidden="true"`. Full ma początkowy kwadrat 93×93 o `rx=46.5`, kropkę na zagnieżdżonym `<g>` i współdzielony wordmark; compact ma wyłącznie koło i kropkę.

- [ ] **Step 4: Dodać zatwierdzony ruch w CSS**

  Reguły bazowe ustawiają statyczny stan końcowy. Wszystkie keyframes intro i pętli stoją wyłącznie w:

  ```css
  @media (prefers-reduced-motion: no-preference) {
    [data-brand-loader] { animation: brand-loader-reveal 1ms linear 200ms both; }
    [data-brand-loader-capsule] { animation: brand-loader-capsule-intro 2200ms var(--ease-out) 200ms both; }
    [data-brand-loader-dot-position] { animation: brand-loader-dot-position 2200ms var(--ease-standard) 200ms both; }
    [data-brand-loader-dot] {
      animation:
        brand-loader-dot-intro 2200ms var(--ease-standard) 200ms both,
        brand-loader-dot-breathe 3600ms var(--ease-standard) 2400ms infinite;
    }
  }
  ```

  Kapsuła animuje SVG `x` i `width`, a nie skaluje gotowego prostokąta po osi X. Litery używają wyłącznie opacity + krótkiego translate z opóźnieniem opartym na `--brand-letter-index`; nie używają stroke.

- [ ] **Step 5: Uruchomić testy i potwierdzić GREEN**

  Run: `pnpm --filter panel exec vitest run test/brand-loader.test.tsx test/panel-shell-contract.test.tsx`

  Expected: PASS; statyczne kontrakty logo nadal przechodzą.

- [ ] **Step 6: Commit**

  ```bash
  git add apps/panel/components/shell/brand-loader.tsx apps/panel/components/shell/brand-mark.tsx apps/panel/app/globals.css apps/panel/test/brand-loader.test.tsx apps/panel/test/panel-shell-contract.test.tsx
  git commit -m "feat(motion): dodaj loader marki Avably"
  ```

### Task 2: Route-level loading bez fałszywych empty states

**Files:**
- Create: `apps/panel/app/[locale]/(panel)/loading.tsx`
- Create: `apps/panel/test/panel-loading-boundary.test.tsx`
- Modify: `apps/panel/components/skeleton/skeleton-primitives.tsx`
- Modify: `apps/panel/test/helpers/skeleton-html.ts`
- Modify: `apps/panel/test/skeleton-parity-contract.test.tsx`
- Modify: `apps/panel/test/customers-skeleton-parity.test.tsx`
- Modify: `apps/panel/messages/pl.json`
- Modify: `apps/panel/messages/en.json`

**Interfaces:**
- Consumes: `BrandLoader({ label, variant: "full", showLabel: true })` z Task 1.
- Produces: ogólny fallback panelu z tłumaczeniem `common.loading`.
- Preserves: `SkeletonScreen({ label, className, children })` i pełną niewidoczną rezerwę geometrii.

- [ ] **Step 1: Zmienić kontrakty na oczekiwany loader**

  Testy skeletonów mają oczekiwać `data-brand-loader-variant="full"`, dokładnie jednego `role="status"`, komunikatu poza rezerwą i braku `data-slot="loading-rail"`. `PAINTED_TAGS` ma opisywać dokładne drzewo loadera, nie dawną szynę. Test granicy ogólnej mockuje `getTranslations` i sprawdza pełny loader z `data-panel-route-loading`.

- [ ] **Step 2: Uruchomić testy i potwierdzić RED**

  Run: `pnpm --filter panel exec vitest run test/skeleton-parity-contract.test.tsx test/customers-skeleton-parity.test.tsx test/panel-loading-boundary.test.tsx`

  Expected: FAIL na starej szynie i brakującym `loading.tsx` segmentu.

- [ ] **Step 3: Zastąpić widoczną ramę skeletonu**

  `SkeletonScreen` usuwa import `LoadingRail`, renderuje centralny `<BrandLoader label={label} variant="full" showLabel />` przed niewidoczną rezerwą i zachowuje `data-skeleton-frame`. Nie zmienia klas ani dzieci `data-skeleton-screen`, więc CLS/parytet geometrii pozostaje bez zmian.

- [ ] **Step 4: Dodać ogólną granicę i i18n**

  Dodać `common.loading` jako `Ładowanie panelu…` / `Loading panel…`. Nowy async server component pobiera `getTranslations("common")` i zwraca:

  ```tsx
  <div data-panel-route-loading className="flex min-h-[50vh] items-center justify-center">
    <BrandLoader label={t("loading")} variant="full" showLabel />
  </div>
  ```

- [ ] **Step 5: Uruchomić testy i potwierdzić GREEN**

  Run: `pnpm --filter panel exec vitest run test/skeleton-parity-contract.test.tsx test/customers-skeleton-parity.test.tsx test/panel-loading-boundary.test.tsx test/messages-parity.test.ts`

  Expected: PASS; obie lokalizacje mają nowy klucz, a rezerwy geometrii nadal spełniają kontrakty.

- [ ] **Step 6: Commit**

  ```bash
  git add apps/panel/app/'[locale]'/'(panel)'/loading.tsx apps/panel/components/skeleton/skeleton-primitives.tsx apps/panel/test/helpers/skeleton-html.ts apps/panel/test/skeleton-parity-contract.test.tsx apps/panel/test/customers-skeleton-parity.test.tsx apps/panel/test/panel-loading-boundary.test.tsx apps/panel/messages/pl.json apps/panel/messages/en.json
  git commit -m "feat(panel): pokaż loader marki podczas ładowania tras"
  ```

### Task 3: Kompaktowy loader w portalu płatności

**Files:**
- Create: `apps/panel/test/billing-portal-button.test.tsx`
- Modify: `apps/panel/components/billing/billing-portal-button.tsx`
- Verify: `apps/panel/test/pending-states-behavior.test.tsx`
- Verify: `apps/panel/test/pending-states-gate.test.ts`

**Interfaces:**
- Consumes: `BrandLoader({ label, variant: "compact" })` z Task 1.
- Preserves: `disabled={pending}`, `aria-busy={pending}` i widoczne `portalRedirecting`.

- [ ] **Step 1: Napisać failing test interakcji**

  React Testing Library klika CTA przy nierozwiązanej obietnicy `openBillingPortalAction`, następnie sprawdza wyłączony przycisk z `aria-busy="true"`, `data-brand-loader-variant="compact"`, pojedynczy komunikat `role="status"` i widoczny tekst przekierowania.

- [ ] **Step 2: Uruchomić test i potwierdzić RED**

  Run: `pnpm --filter panel exec vitest run test/billing-portal-button.test.tsx`

  Expected: FAIL, ponieważ pending renderuje sam tekst i przycisk nie ma `aria-busy`.

- [ ] **Step 3: Zaimplementować minimalną zmianę**

  Przycisk dostaje `aria-busy={pending}`. Pending renderuje jeden `BrandLoader` compact z `label={t("portalRedirecting")}` i `showLabel`, ułożony w wierszu pod CTA. Nie zmienia logiki akcji, przekierowania ani błędów.

- [ ] **Step 4: Uruchomić testy i potwierdzić GREEN**

  Run: `pnpm --filter panel exec vitest run test/billing-portal-button.test.tsx test/manage-billing-controls.test.tsx test/pending-states-behavior.test.tsx test/pending-states-gate.test.ts`

  Expected: PASS; globalny kontrakt przycisków pending nie został rozluźniony.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/panel/components/billing/billing-portal-button.tsx apps/panel/test/billing-portal-button.test.tsx
  git commit -m "feat(billing): pokaż kompaktowy loader portalu"
  ```

### Task 4: Galeria, audyt oraz pełna weryfikacja

**Files:**
- Modify: `apps/panel/app/[locale]/design-system/page.tsx`
- Create: `apps/panel/test/brand-loader-gallery.test.tsx`
- Modify: `docs/superpowers/specs/2026-08-24-avably-brand-loader-design.md` tylko jeśli QA ujawni rozbieżność wymagającą jawnego doprecyzowania.

**Interfaces:**
- Consumes: oba warianty `BrandLoader`.
- Produces: statycznie dostępna dokumentacja zastosowania oraz opis reduced motion.

- [ ] **Step 1: Napisać failing test galerii**

  Test źródłowy wymaga sekcji `id="brand-loader"`, dwóch wariantów komponentu oraz tekstu, że reduced motion pokazuje stan końcowy. Test zabrania używania loadera w rozpoznanych źródłach true empty state (`orders-list`, `customers-table`, katalog/no-results`).

- [ ] **Step 2: Uruchomić test i potwierdzić RED**

  Run: `pnpm --filter panel exec vitest run test/brand-loader-gallery.test.tsx`

  Expected: FAIL, ponieważ galeria dokumentuje dawną szynę i nie ma sekcji brand loadera.

- [ ] **Step 3: Zaktualizować galerię**

  Usunąć import i przykład `LoadingRail`. Dodać `BrandLoader`, pełny przykład dla stron, compact dla dłuższych operacji oraz krótki opis: próg 200 ms, logo nie resetuje się, reduced motion jest statyczny, empty state nie jest loadingiem.

- [ ] **Step 4: Uruchomić testy funkcji**

  Run: `pnpm --filter panel exec vitest run test/brand-loader.test.tsx test/brand-loader-gallery.test.tsx test/panel-loading-boundary.test.tsx test/skeleton-parity-contract.test.tsx test/customers-skeleton-parity.test.tsx test/billing-portal-button.test.tsx test/manage-billing-controls.test.tsx test/panel-shell-contract.test.tsx test/pending-states-behavior.test.tsx test/pending-states-gate.test.ts test/messages-parity.test.ts`

  Expected: PASS.

- [ ] **Step 5: Uruchomić pełne bramki repo**

  Run kolejno:

  ```bash
  pnpm --filter panel typecheck
  pnpm --filter panel lint
  pnpm --filter panel test
  pnpm --filter panel build
  ```

  Expected: wszystkie polecenia kończą się kodem 0. Jeżeli build wymaga zewnętrznej infrastruktury, raport musi podać dokładny etap i komunikat zamiast udawać sukces.

- [ ] **Step 6: QA w przeglądarce**

  Uruchomić panel lokalnie i sprawdzić loader na 1440 px oraz 375 px, a następnie z emulacją `prefers-reduced-motion: reduce`. Potwierdzić: idealne koło, płynne rozszerzenie do kapsuły, miękkie pojawianie liter, brak resetu logo, subtelny ambient dot, brak deformacji i brak overflow.

- [ ] **Step 7: Commit**

  ```bash
  git add apps/panel/app/'[locale]'/design-system/page.tsx apps/panel/test/brand-loader-gallery.test.tsx
  git commit -m "docs(panel): pokaż warianty loadera Avably"
  ```

- [ ] **Step 8: Zatrzymać się przed integracją**

  Pokazać status gałęzi, listę commitów i wyniki testów. Nie wykonywać merge, push, PR ani deploy.
