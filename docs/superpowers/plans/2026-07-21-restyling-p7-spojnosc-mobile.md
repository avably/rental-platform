# Restyling P7 — spójność ekranów i mobile UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ujednolicić geometrię i semantykę wszystkich ekranów panelu oraz domknąć mobilną nawigację, selecty i kalendarz bez zmiany logiki produktu.

**Architecture:** Layout `(panel)` staje się jedynym właścicielem kontenera, paddingu i rezerwy pod bottom bar, a topbar jedynym właścicielem H1. Mały wrapper `PanelSelect` przenosi wszystkie formularze na istniejący Radix Select, `MobileNav` pozostaje jedynym właścicielem drawera i renderuje także bottom bar, a `DateRangeField` przekazuje do istniejącego `Calendar` liczbę miesięcy z reaktywnego media query.

**Tech Stack:** Next.js App Router, React 19, TypeScript strict, next-intl, Tailwind CSS 4, Radix UI przez `@avably/ui`, React DayPicker, Vitest, renderToStaticMarkup.

## Global Constraints

- Pracuj wyłącznie w `/Users/godekmaciej/rental-platform/.claude/worktrees/restyling-p7` na gałęzi `feat/restyling-p7-spojnosc` opartej o `origin/main` `eba9ae3`.
- Node 22: `export PATH=/opt/homebrew/opt/node@22/bin:$PATH`; pnpm wyłącznie przez `corepack`.
- Zakres zapisu: `apps/panel/**` i dokumentacja. `packages/ui` tylko gdy istniejące API jest niewystarczające; plan zakłada, że nie jest potrzebna żadna zmiana tego pakietu.
- Nie dotykaj `packages/pdf`, `apps/storefront`, migracji, CI, actions, zapytań ani walidacji.
- Zero nowych zależności i zero zmian nazw lub wartości pól wysyłanych do server actions.
- Język produktu i dokumentacji: polski; zachowaj parytet `messages/pl.json` i `messages/en.json`.
- Autor każdego commita: `Avably <admin@avably.io>`; bez dodatkowych stopek.
- Po każdej mutacji plików uruchom `git diff --stat` i potwierdź niepusty wynik.
- Testy panelu bez lokalnych zmiennych integracyjnych: `ALLOW_INTEGRATION_SKIP=1 corepack pnpm vitest run`.
- Port dowodów przeglądarkowych: 3048; `.env.local` jest już skopiowany z głównego repo; nie ustawiaj `TURNSTILE_SECRET_KEY`.

---

## Mapa plików

- `apps/panel/test/panel-consistency-contract.test.tsx` — nowy skan kontenerów i natywnych selectów oraz render jednego H1.
- `apps/panel/test/mobile-bottom-nav-contract.test.tsx` — render i kontrakt identyfikatorów bottom bara.
- `apps/panel/test/panel-select-contract.test.tsx` — render wrappera Select oraz zachowanie nazw i wartości formularza.
- `apps/panel/test/panel-date-fields-contract.test.ts` — rozszerzony kontrakt responsywnej liczby miesięcy.
- `apps/panel/components/fields/panel-select.tsx` — jedyny panelowy adapter do `@avably/ui` Select.
- `apps/panel/components/screens/screen-header.tsx` — link powrotu, H2 kontekstu i akcje nad treścią; nigdy H1.
- `apps/panel/components/shell/{panel-topbar,mobile-nav}.tsx` — jedyny H1, odchudzony mobile topbar, wspólny drawer i bottom bar.
- `apps/panel/lib/shell/nav.ts` — resolver tytułu oraz identyfikatory bottom bara rozwiązywane z `PANEL_NAV_ITEMS`.
- `apps/panel/lib/fields/date-fields.tsx` — `useSyncExternalStore` dla breakpointu `md` i `numberOfMonths` 1/2.
- `apps/panel/app/[locale]/(panel)/layout.tsx` — jedyny kontener `max-w-6xl` i padding z safe-area.
- Pliki `(panel)/**` wymienione w zadaniach 1–2 — usunięcie lokalnych kontenerów/H1 i zamiana 12 selectów.
- `apps/panel/messages/{pl,en}.json` — etykiety title overrides i bottom bara/drawera.
- `docs/dokumentacja/index.html` — ADR-060, moduł panelu i wpis dziennika.

---

### Task 1: Kontrakt jednego kontenera i jednego H1

**Files:**
- Create: `apps/panel/test/panel-consistency-contract.test.tsx`
- Modify: `apps/panel/app/[locale]/(panel)/layout.tsx`
- Modify: `apps/panel/components/shell/panel-topbar.tsx`
- Modify: `apps/panel/components/screens/screen-header.tsx`
- Modify: `apps/panel/components/screens/not-found-screen.tsx`
- Modify: `apps/panel/lib/shell/nav.ts`
- Modify: `apps/panel/messages/pl.json`
- Modify: `apps/panel/messages/en.json`
- Modify: wszystkie pliki z listy `rg -l '<h1|max-w-' apps/panel/app/'[locale]'/'(panel)'`

**Interfaces:**
- Consumes: `PANEL_NAV_ITEMS`, `PANEL_NAV_PLACEHOLDER`, `matchNavItem(pathname)` i `nav.*`.
- Produces: `panelTitleKey(pathname: string): string`; layout z `data-panel-container="true"`; `ScreenHeader` renderujący H2; dokładnie jeden H1 w `PanelTopbar`.

- [ ] **Step 1: Napisz czerwony kontrakt skanu i renderu**

Dodaj `panel-consistency-contract.test.tsx` z rekurencyjnym `collectSources`, stripperem komentarzy oraz whitelistą wyłącznie elementów wewnętrznych:

```tsx
const allowedMaxWidth = new Map([
  ["katalog/[id]/zdjecia/photo-forms.tsx", ["max-w-[10rem]"]],
  ["katalog/product-form.tsx", ["max-w-2xl"]],
  ["katalog/punkty-odbioru/location-form.tsx", ["max-w-2xl"]],
  ["zamowienia/[id]/extension-form.tsx", ["max-w-sm"]],
  ["zamowienia/nowe/order-wizard.tsx", ["max-w-2xl"]],
]);

it("pliki ekranów nie definiują własnego kontenera max-w", () => {
  const offenders = sources.flatMap(({ path, code }) => {
    const relativePath = relative(path);
    const allowed = allowedMaxWidth.get(relativePath) ?? [];
    return [...code.matchAll(/\bmax-w-(?:\[[^\]]+\]|[\w-]+)/g)]
      .map((match) => match[0])
      .filter((token) => !allowed.includes(token))
      .map((token) => `${relativePath}: ${token}`);
  });
  expect(offenders, `własny kontener ekranu: ${offenders.join(", ")}`).toEqual([]);
});

it("layout jest jedynym właścicielem standardu max-w-6xl i paddingu", () => {
  expect(layout).toContain('data-panel-container="true"');
  expect(layout).toContain("max-w-6xl");
  expect(layout).toContain("px-4");
  expect(layout).toContain("md:px-6");
});

it.each(PANEL_NAV_ITEMS)("render trasy $href ma dokładnie jeden h1", (item) => {
  pathname.current = item.href;
  const html = render(<PanelTopbar userEmail="operator@example.test" />);
  expect(html.match(/<h1\b/g) ?? []).toHaveLength(1);
  expect(html).toContain(messages.nav[item.labelKey as keyof typeof messages.nav]);
});

it("źródła ekranów nie renderują drugiego h1", () => {
  const offenders = sources.filter(({ code }) => /<h1\b/.test(code)).map(({ path }) => relative(path));
  expect(offenders, `drugi h1 w treści: ${offenders.join(", ")}`).toEqual([]);
});
```

Mock `@/i18n/navigation` ma używać hoistowanego `pathname.current`, a render ma opakować `PanelTopbar` w `NextIntlClientProvider` z `messages/pl.json`, jak w `sidebar-active-contract.test.tsx`.

- [ ] **Step 2: Uruchom celowany test i potwierdź kontrolowaną czerwień**

Run:

```bash
cd apps/panel
export PATH=/opt/homebrew/opt/node@22/bin:$PATH
corepack pnpm vitest run test/panel-consistency-contract.test.tsx
```

Expected: FAIL z listą lokalnych `max-w-*`, H1 w ekranach oraz brakiem `data-panel-container`.

- [ ] **Step 3: Dodaj resolver tytułu i jedyny H1**

W `lib/shell/nav.ts` dodaj:

```ts
const PANEL_ROUTE_TITLE_OVERRIDES = [
  { path: "/historia-emaili", labelKey: "emailHistory" },
  { path: "/organizacja/nowa", labelKey: "newOrganization" },
  { path: "/bezpieczenstwo/wyzwanie", labelKey: "securityChallenge" },
] as const;

export function panelTitleKey(pathname: string): string {
  const active = matchNavItem(pathname);
  if (active) return active.labelKey;
  if (pathname === "/") return PANEL_NAV_PLACEHOLDER.labelKey;
  return (
    PANEL_ROUTE_TITLE_OVERRIDES.find(
      ({ path }) => pathname === path || pathname.startsWith(`${path}/`),
    )?.labelKey ?? "panelNavigation"
  );
}
```

W `PanelTopbar` zamień obliczanie `sectionKey` na `panelTitleKey(pathname)` i renderuj:

```tsx
<h1 className="min-w-0 truncate text-sm font-semibold md:text-base">
  {t(panelTitleKey(pathname))}
</h1>
```

Dodaj pary kluczy PL/EN: `emailHistory`, `newOrganization`, `securityChallenge`.

- [ ] **Step 4: Przenieś standard kontenera do layoutu**

Zmień `main` na:

```tsx
<main
  id={MAIN_CONTENT_ID}
  tabIndex={-1}
  className="min-w-0 flex-1 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-0"
>
  <div
    data-panel-container="true"
    className="mx-auto w-full max-w-6xl px-4 py-4 md:px-6 md:py-6"
  >
    {children}
  </div>
</main>
```

Usuń kontenery stron (`mx-auto`, `w-full`, `max-w-*`) z page.tsx: `bezpieczenstwo`, `bezpieczenstwo/wyzwanie`, `historia-emaili`, dashboard, `organizacja/nowa`, `strona`, `ustawienia-domen`, `ustawienia-dostaw`, `ustawienia-emaili`, `zamowienia/nowe`, `zaproszenia`. Zachowaj ich `flex`, `gap-*` i logikę warunkową.

- [ ] **Step 5: Usuń H1 z treści i zachowaj kontekst jako H2**

W `ScreenHeader` zamień `<h1>` na `<h2>`. W szczególe zamówienia i `site-editor.tsx` zamień kontekstowy H1 na H2. W ekranach głównych (`katalog`, `zamowienia`, `organizacja`, `strona`, ustawienia, zaproszenia, bezpieczeństwo, historia e-maili, dashboard) usuń powtórzone nagłówki, zachowując opisy i akcje w pierwszym wierszu treści. W panelowych not-found zamień tytuł na H2; jeżeli wspólny `NotFoundScreen` obsługuje też powierzchnię bez shella, dodaj prop `headingLevel?: 1 | 2` z domyślnym `1` i przekaż `headingLevel={2}` tylko z panelu.

- [ ] **Step 6: Sprawdź niepusty diff i zielony kontrakt**

Run:

```bash
git diff --stat
cd apps/panel
corepack pnpm vitest run test/panel-consistency-contract.test.tsx test/panel-shell-contract.test.tsx test/sidebar-active-contract.test.tsx
```

Expected: niepusty stat; wszystkie testy PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/panel
git -c user.name=Avably -c user.email=admin@avably.io commit -m "feat(panel): ujednolić kontener i tytuły stron"
```

---

### Task 2: Wszystkie selecty przez `@avably/ui`

**Files:**
- Create: `apps/panel/components/fields/panel-select.tsx`
- Create: `apps/panel/test/panel-select-contract.test.tsx`
- Modify: `apps/panel/test/panel-consistency-contract.test.tsx`
- Modify: 8 plików wskazanych niżej zawierających 12 natywnych `<select>`

**Interfaces:**
- Consumes: `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem`, `cn` z `@avably/ui`.
- Produces: `PanelSelectOption`; `PanelSelect(props)` z `name`, `value/defaultValue`, `onValueChange`, `options`, atrybutami ARIA i pełną szerokością.

- [ ] **Step 1: Dodaj czerwony zakaz `<select` i test adaptera**

W `panel-consistency-contract.test.tsx` dodaj:

```ts
it("żaden ekran tenanta nie używa natywnego selecta", () => {
  const offenders = sources.filter(({ code }) => /<select\b/.test(code)).map(({ path }) => relative(path));
  expect(offenders, `natywny <select> zamiast @avably/ui: ${offenders.join(", ")}`).toEqual([]);
});
```

W `panel-select-contract.test.tsx` wyrenderuj adapter z opcjami `""`, `customer-a`, `customer-b`; asercje wymagają `data-slot="select-trigger"`, widocznej wybranej etykiety i braku jawnego natywnego `<select>` w źródłach panelu.

- [ ] **Step 2: Uruchom test i potwierdź 8 plików naruszających zakaz**

```bash
cd apps/panel
corepack pnpm vitest run test/panel-select-contract.test.tsx test/panel-consistency-contract.test.tsx
```

Expected: FAIL z plikami `historia-emaili/page.tsx`, `strona/site-editor.tsx`, `ustawienia-dostaw/delivery-settings-forms.tsx`, `zamowienia/[id]/delivery-forms.tsx`, `zamowienia/[id]/deposit-forms.tsx`, `zamowienia/nowe/order-wizard.tsx`, `zamowienia/orders-filters.tsx`, `zaproszenia/form.tsx`.

- [ ] **Step 3: Zaimplementuj adapter**

Utwórz `components/fields/panel-select.tsx`:

```tsx
"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, cn } from "@avably/ui";
import * as React from "react";

export type PanelSelectOption = { value: string; label: string; disabled?: boolean };

const EMPTY_VALUE = "__panel_empty__";

export function PanelSelect({
  id, name, value, defaultValue, onValueChange, options, placeholder,
  disabled, invalid, describedBy, className,
}: {
  id?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  options: readonly PanelSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  className?: string;
}) {
  const hasEmptyOption = options.some((option) => option.value === "");
  const [internalValue, setInternalValue] = React.useState(defaultValue ?? "");
  const selectedValue = value ?? internalValue;
  const radixValue = hasEmptyOption && selectedValue === "" ? EMPTY_VALUE : selectedValue;

  function change(nextValue: string) {
    const decoded = nextValue === EMPTY_VALUE ? "" : nextValue;
    if (value === undefined) setInternalValue(decoded);
    onValueChange?.(decoded);
  }

  return (
    <>
      {hasEmptyOption && name ? <input type="hidden" name={name} value={selectedValue} /> : null}
      <Select
        name={hasEmptyOption ? undefined : name}
        value={radixValue}
        onValueChange={change}
        disabled={disabled}
      >
        <SelectTrigger
          id={id}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={cn("w-full", className)}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent position="popper" align="start">
          {options.map((option) => (
            <SelectItem
              key={option.value || EMPTY_VALUE}
              value={option.value || EMPTY_VALUE}
              disabled={option.disabled}
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}
```

Radix nie dopuszcza pustego `SelectItem`, dlatego adapter zawsze mapuje pustą opcję na prywatny sentinel tylko wewnątrz widżetu. Dla takich pól jawny ukryty input niesie oryginalny pusty string; test i submit przeglądarkowy muszą dowieść, że `FormData` nigdy nie zawiera sentinela.

- [ ] **Step 4: Przepnij 12 selectów bez zmiany kontraktu danych**

Użyj mapowań:

| Plik | `name` / stan | Wartości |
|---|---|---|
| `historia-emaili/page.tsx` | `status` | `""` + `EMAIL_LOG_STATUSES` |
| `strona/site-editor.tsx` | kontrolowany `sectionType` | `SECTION_TYPES`; po wyborze `addSection(value)` i reset do `freeform` |
| `ustawienia-dostaw/delivery-settings-forms.tsx` | dotychczasowa nazwa środowiska | identyczne opcje dev/prod |
| `zamowienia/[id]/delivery-forms.tsx` | dotychczasowa nazwa usługi/metody | identyczne wartości |
| `zamowienia/[id]/deposit-forms.tsx` | dotychczasowa nazwa sposobu zwrotu | identyczne wartości |
| `zamowienia/nowe/order-wizard.tsx` | `customerId`, kontrolowane product IDs, `deliveryMethod`, `pickupLocationId` | identyczne ID i enumy |
| `zamowienia/orders-filters.tsx` | `klient` | `""` + ID klientów |
| `zaproszenia/form.tsx` | `role` | `staff`, `owner` |

Każdy adapter dostaje istniejące `aria-invalid`, `aria-describedby`, `disabled`, tłumaczenia i `className`. Nie zmieniaj actions, schematów ani nazw pól.

- [ ] **Step 5: Sprawdź diff i uruchom kontrakty**

```bash
git diff --stat
cd apps/panel
corepack pnpm vitest run test/panel-select-contract.test.tsx test/panel-consistency-contract.test.tsx test/orders.test.ts test/delivery-settings-validation.test.ts test/deposit-validation.test.ts test/messages-parity.test.ts
```

Expected: niepusty stat; PASS, integracyjne pliki mogą zostać jawnie pominięte tylko przez pełny run z `ALLOW_INTEGRATION_SKIP=1`.

- [ ] **Step 6: Commit**

```bash
git add apps/panel
git -c user.name=Avably -c user.email=admin@avably.io commit -m "feat(panel): zastąpić natywne selecty systemowymi"
```

---

### Task 3: Mobilny bottom bar i odchudzony topbar

**Files:**
- Create: `apps/panel/test/mobile-bottom-nav-contract.test.tsx`
- Modify: `apps/panel/components/shell/mobile-nav.tsx`
- Modify: `apps/panel/components/shell/panel-topbar.tsx`
- Modify: `apps/panel/lib/shell/nav.ts`
- Modify: `apps/panel/messages/pl.json`
- Modify: `apps/panel/messages/en.json`

**Interfaces:**
- Consumes: `PANEL_NAV_ITEMS`, `matchNavItem`, `Link`, `LocaleSwitcher`, `ThemeToggle`, `logoutAction`.
- Produces: `PANEL_BOTTOM_NAV_ITEMS`; `resolvePanelNavItem(id: string): PanelNavItem`; jeden kontrolowany Sheet z dwoma przyciskami otwarcia; `nav.mobileMenu`, `nav.newOrder`.

- [ ] **Step 1: Napisz czerwony kontrakt bottom bara**

Test ma wyrenderować `MobileNav userEmail="operator@example.test"` dla `/zamowienia` i sprawdzić:

```tsx
expect(html).toContain('data-mobile-bottom-nav="true"');
expect(html).toContain('aria-current="page"');
expect(html).toContain(messages.nav.orders);
expect(html).toContain(messages.nav.catalog);
expect(html).toContain(messages.nav.newOrder);
expect(html).toContain(messages.nav.mobileMenu);
expect(PANEL_BOTTOM_NAV_ITEMS.every((item) => PANEL_NAV_ITEMS.includes(item))).toBe(true);
expect(html).toContain("env(safe-area-inset-bottom)");
expect(html).not.toMatch(/shadow-/);
```

Dodaj kontrolę pozytywną walidatora:

```ts
expect(() => resolvePanelNavItem("spoza-nav")).toThrow(/spoza PANEL_NAV_ITEMS/);
```

- [ ] **Step 2: Uruchom test i potwierdź brak komponentu**

```bash
cd apps/panel
corepack pnpm vitest run test/mobile-bottom-nav-contract.test.tsx
```

Expected: FAIL — brak eksportów i `data-mobile-bottom-nav`.

- [ ] **Step 3: Dodaj resolver pozycji z twardą walidacją**

W `nav.ts`:

```ts
export function resolvePanelNavItem(id: string): PanelNavItem {
  const item = PANEL_NAV_ITEMS.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`Bottom bar id spoza PANEL_NAV_ITEMS: ${id}`);
  return item;
}

export const PANEL_BOTTOM_NAV_ITEMS = [
  resolvePanelNavItem("orders"),
  resolvePanelNavItem("catalog"),
] as const;
```

- [ ] **Step 4: Rozbuduj `MobileNav` o bottom bar i stopkę drawera**

`MobileNav` przyjmuje `userEmail` tylko do dostępnej etykiety konta. Komponent nadal ma jeden `open`/`setOpen`; hamburger i Menu wywołują `setOpen(true)`. W `SheetContent` zastosuj `flex h-full flex-col`, scrollowalny sidebar oraz stopkę:

```tsx
<div className="border-border mt-auto flex flex-col gap-3 border-t p-4">
  <span className="text-muted-foreground truncate text-xs">{userEmail}</span>
  <LocaleSwitcher />
  <form action={logoutAction}>
    <button type="submit" className={drawerActionClass}>{tCommon("logout")}</button>
  </form>
</div>
```

Bottom bar ma:

```tsx
<nav
  data-mobile-bottom-nav="true"
  aria-label={t("mobileNavigation")}
  className="border-border bg-background fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t pb-[env(safe-area-inset-bottom)] md:hidden"
>
  {/* orders, catalog, CTA /zamowienia/nowe, Menu */}
</nav>
```

CTA używa tożsamości `resolvePanelNavItem("orders")`, jawnego href `/zamowienia/nowe`, tokenów `bg-accent text-accent-foreground` i obrysu zamiast cienia. Linki używają `aria-current={matchNavItem(pathname)?.id === item.id ? "page" : undefined}`; CTA jest bieżące tylko na `/zamowienia/nowe`, aby nie oznaczać dwóch linków jako current na całej sekcji zamówień.

- [ ] **Step 5: Odchudź topbar mobile bez regresji desktopu**

Przekaż `userEmail` do `MobileNav`. Usuń `BrandSymbol` z topbara. `LocaleSwitcher`, e-mail i formularz logout opakuj klasami `hidden md:flex`/`hidden lg:inline`; `ThemeToggle` pozostaje widoczny. Na mobile wynik to hamburger + H1 + motyw.

- [ ] **Step 6: Uruchom kontrakty shella i wiadomości**

```bash
git diff --stat
cd apps/panel
corepack pnpm vitest run test/mobile-bottom-nav-contract.test.tsx test/panel-nav-contract.test.ts test/panel-shell-contract.test.tsx test/sidebar-active-contract.test.tsx test/messages-parity.test.ts
```

Expected: niepusty stat; PASS; istniejący kontrakt 1+9+3 bez zmian.

- [ ] **Step 7: Commit**

```bash
git add apps/panel
git -c user.name=Avably -c user.email=admin@avably.io commit -m "feat(panel): dodać mobilną nawigację dolną"
```

---

### Task 4: Jeden miesiąc kalendarza na mobile

**Files:**
- Modify: `apps/panel/lib/fields/date-fields.tsx`
- Modify: `apps/panel/test/panel-date-fields-contract.test.ts`

**Interfaces:**
- Consumes: `window.matchMedia("(min-width: 768px)")`, React `useSyncExternalStore`, `Calendar numberOfMonths`.
- Produces: `useDesktopCalendar(): boolean`; `DateRangeField` z `numberOfMonths={desktop ? 2 : 1}`.

- [ ] **Step 1: Rozszerz kontrakt o prop/hook i zakaz CSS-hide**

```ts
it("zakres renderuje 1 miesiąc mobile i 2 desktop przez prop", () => {
  const fields = sources.find((file) => file.path.endsWith("lib/fields/date-fields.tsx"))!;
  expect(fields.code).toContain('matchMedia("(min-width: 768px)")');
  expect(fields.code).toMatch(/numberOfMonths=\{[^}]+\? 2 : 1\}/);
  expect(fields.code).not.toMatch(/hidden[^\n]*month|month[^\n]*hidden/);
});
```

- [ ] **Step 2: Uruchom test i potwierdź stałe dwa miesiące jako błąd**

```bash
cd apps/panel
corepack pnpm vitest run test/panel-date-fields-contract.test.ts
```

Expected: FAIL — brak matchMedia i nadal `numberOfMonths={2}`.

- [ ] **Step 3: Dodaj stabilny hook i przekaż prop**

```tsx
const DESKTOP_CALENDAR_QUERY = "(min-width: 768px)";

function subscribeDesktopCalendar(onChange: () => void): () => void {
  const query = window.matchMedia(DESKTOP_CALENDAR_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function useDesktopCalendar(): boolean {
  return React.useSyncExternalStore(
    subscribeDesktopCalendar,
    () => window.matchMedia(DESKTOP_CALENDAR_QUERY).matches,
    () => false,
  );
}
```

W `DateRangeField`:

```tsx
const desktopCalendar = useDesktopCalendar();
// ...
<Calendar mode="range" numberOfMonths={desktopCalendar ? 2 : 1} />
```

- [ ] **Step 4: Uruchom kontrakty dat i typecheck panelu**

```bash
git diff --stat
cd apps/panel
corepack pnpm vitest run test/panel-date-fields-contract.test.ts
corepack pnpm tsc --noEmit
```

Expected: niepusty stat; PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/panel/lib/fields/date-fields.tsx apps/panel/test/panel-date-fields-contract.test.ts
git -c user.name=Avably -c user.email=admin@avably.io commit -m "feat(panel): dostosować kalendarz do mobile"
```

---

### Task 5: ADR-060, moduł i dziennik

**Files:**
- Modify: `docs/dokumentacja/index.html`

**Interfaces:**
- Consumes: decyzje i dowody z Tasks 1–4.
- Produces: ADR-060, zaktualizowana karta modułu panelu, wpis dziennika P7 na górze.

- [ ] **Step 1: Dodaj dokumentację dopiero po zielonych kontraktach**

W karcie modułu panelu dopisz:

- `max-w-6xl` i padding wyłącznie w layoutcie;
- H1 w topbarze, H2 kontekstowe w treści, akcje nad treścią;
- `PanelSelect` jako adapter zachowujący `FormData`;
- bottom bar orders/catalog/new order/menu, safe-area i jeden drawer;
- 1 miesiąc poniżej `md`, 2 od `md`.

Dodaj ADR-060 z sekcjami Kontekst, Decyzje 1–5, Konsekwencje i Dowody. Jawnie zapisz, że bottom bar i responsywny kalendarz są rozszerzeniami właściciela poza artefaktem Fazy 2, lecz używają jego tokenów, obrysów i motion.

Dodaj wpis dziennika `2026-07-21 · Restyling P7 — spójność ekranów i mobile UX · PR bieżący`, opisujący wdrożone kontrakty i decyzje bez przewidywania późniejszych wyników. Faktyczne liczby mutacji, computed styles i ścieżki zrzutów trafią do raportu PR po Task 6.

- [ ] **Step 2: Sprawdź diff i brak niepełnych oznaczeń**

```bash
git diff --stat
git diff --check
git grep -n 'BRAK_DOWODU' -- docs/dokumentacja/index.html
```

Expected: niepusty stat, brak błędów whitespace, brak `BRAK_DOWODU`.

- [ ] **Step 3: Commit**

```bash
git add docs/dokumentacja/index.html
git -c user.name=Avably -c user.email=admin@avably.io commit -m "docs: opisać spójność panelu w ADR-060"
```

---

### Task 6: Pełna weryfikacja, mutacje i dowody przeglądarkowe

**Files:**
- Modify only if evidence reveals a defect: files from Tasks 1–5
- Create screenshots under an ignored evidence directory, e.g. `/tmp/avably-p7-evidence/`
- Modify: `docs/dokumentacja/index.html` only to replace factual evidence counts/paths before its final commit or amend

**Interfaces:**
- Consumes: kompletny P7 i lokalne środowisko na 3048.
- Produces: zielona suita, cztery czerwone mutacje z restore, tabela computed styles, screenshoty 390/1440, gotowa gałąź do PR.

- [ ] **Step 1: Uruchom pełną suitę panelu**

```bash
cd apps/panel
export PATH=/opt/homebrew/opt/node@22/bin:$PATH
ALLOW_INTEGRATION_SKIP=1 corepack pnpm vitest run
corepack pnpm tsc --noEmit
```

Expected: wszystkie uruchomione testy PASS; testy integracyjne jawnie skipped z powodu braku trzech zmiennych lokalnego Supabase.

- [ ] **Step 2: Wykonaj mutację A — natywny select**

Wstaw do `app/[locale]/(panel)/page.tsx` przed końcem root `<div>`:

```tsx
<select aria-label="mutacja select"><option>mutacja</option></select>
```

Run:

```bash
git diff --stat
corepack pnpm vitest run test/panel-consistency-contract.test.tsx
git restore apps/panel/app/'[locale]'/'(panel)'/page.tsx
```

Expected: niepusty stat; FAIL zawiera `natywny <select> zamiast @avably/ui` i `page.tsx`; po restore czysto.

- [ ] **Step 3: Wykonaj mutację B — drugi H1**

Wstaw `<h1>mutacja</h1>` w ten sam ekran, pokaż niepusty stat, uruchom ten sam test, oczekuj FAIL `drugi h1 w treści: page.tsx`, przywróć plik.

- [ ] **Step 4: Wykonaj mutację C — własny max-w**

Dodaj `max-w-3xl` do klasy root dashboardu, pokaż niepusty stat, uruchom kontrakt, oczekuj FAIL `własny kontener ekranu: page.tsx: max-w-3xl`, przywróć plik.

- [ ] **Step 5: Wykonaj mutację D — obcy id bottom bara**

Dodaj `resolvePanelNavItem("spoza-nav")` do `PANEL_BOTTOM_NAV_ITEMS`, pokaż niepusty stat, uruchom `mobile-bottom-nav-contract.test.tsx`, oczekuj FAIL/throw `Bottom bar id spoza PANEL_NAV_ITEMS: spoza-nav`, przywróć `nav.ts`.

- [ ] **Step 6: Uruchom aplikację na 3048 i przygotuj wyłącznie seed `p7-`**

```bash
cd apps/panel
export PATH=/opt/homebrew/opt/node@22/bin:$PATH
corepack pnpm next dev --turbopack --port 3048
```

Seed utwórz przez `docker exec -i supabase_db_db psql -U postgres` zgodnie z istniejącym wzorcem P4: użytkownik i tenant z prefiksem `p7-`, claim `app_metadata.tenant_id`, produkty i zamówienia realną ścieżką. Nie dotykaj kont demo/admin. Po dowodach usuń wyłącznie rekordy z prefiksem `p7-`.

- [ ] **Step 7: Zbierz dowody 390 px**

W przeglądarce na `http://localhost:3048/pl/zamowienia` sprawdź i zapisz screenshoty do `/tmp/avably-p7-evidence/`:

- `390-orders-light.png` i `390-orders-dark.png`: bottom bar, CTA, `aria-current`, brak zasłoniętej treści;
- `390-drawer.png`: otwarty jeden drawer, język i Wyloguj na dole;
- `390-calendar.png`: otwarty DateRangeField, dokładnie jeden `[data-slot="calendar"] .rdp-month`;
- `390-select.png`: otwarty filtr klienta, obecny `[data-slot="select-content"]`, brak systemowego pickera;
- realny wybór klienta i submit: URL lub wyniki muszą potwierdzić ten sam `klient=<id>`;
- `document.querySelectorAll("h1").length === 1` na każdej trasie z `PANEL_NAV_ITEMS`;
- computed bottom bar: `position: fixed`, `borderTopWidth: 1px`, `boxShadow: none`, padding bottom zawiera safe-area; konsola czysta poza znanym CSP `loading.tsx`.

- [ ] **Step 8: Zbierz dowody 1440 px i tabelę szerokości**

Przejdź dziewięć tras `PANEL_NAV_ITEMS` i zapisz dla `[data-panel-container="true"]`: `getBoundingClientRect().width`, computed `maxWidth`, `paddingLeft`, `paddingRight`. Wszystkie wiersze muszą być identyczne. Zapisz `1440-orders.png` i `1440-settings.png` dla dwóch różnych tras. Otwórz DateRangeField i potwierdź dwa `.rdp-month`.

Tabela raportu ma kolumny: trasa, szerokość przed (z inwentaryzacji klas), szerokość po, max-width, padding L/R.

- [ ] **Step 9: Posprzątaj seed i sprawdź końcowy stan**

Usuń tylko rekordy `p7-`, zatrzymaj dev server, potem:

```bash
git status --short
git diff --check
git log --oneline origin/main..HEAD
```

Expected: brak niecommitowanych zmian; historia zawiera spec, plan i commity Tasks 1–5; żadnych zmian w `packages/pdf`.

- [ ] **Step 10: Rebase, końcowa suita, push i draft PR**

```bash
git fetch origin main
git rebase origin/main
cd apps/panel
ALLOW_INTEGRATION_SKIP=1 corepack pnpm vitest run
cd ../..
git push -u origin feat/restyling-p7-spojnosc
```

Otwórz draft PR do `main` z tytułem `Restyling P7: spójność ekranów i mobile UX panelu (ADR-060)`. Opis zawiera zakres, brak zmian logiki, testy, cztery mutacje, tabelę computed styles, ścieżki screenshotów, propozycję bottom bara i jawne pominięcie lokalnych testów integracyjnych. Merge wykonuje PM.

---

## Self-review planu

- Pokrycie specyfikacji: kontener/H1 — Task 1; selecty i submit — Task 2 + Task 6; bottom bar/topbar/drawer — Task 3 + Task 6; kalendarz — Task 4 + Task 6; ADR/moduł/dziennik — Task 5; mutacje a–d i dowody e — Task 6.
- Granice: brak planowanych zmian w `packages/ui`, `packages/pdf`, storefront, DB, CI, actions, zapytaniach i walidacji.
- Typy i nazwy: `panelTitleKey`, `PanelSelect`, `PanelSelectOption`, `resolvePanelNavItem`, `PANEL_BOTTOM_NAV_ITEMS`, `useDesktopCalendar` są zdefiniowane przed użyciem w kolejnych zadaniach.
- Brak placeholderów wykonawczych: wszystkie komendy, oczekiwane wyniki, ścieżki i kryteria dowodów są jawne.
