# Kierunek panelu zgodny z LP — plan wdrożenia

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wdrożyć w panelu zatwierdzony kierunek wizualny: Geist bez zmiany kroju, neutralne bardzo jasne tło, białe sekcje, promienie 3–6 px, lekkie obrysy i limonkę ograniczoną do akcji oraz aktywnego kontekstu.

**Architecture:** Paleta i geometria zostaną nadpisane wyłącznie w `apps/panel/app/globals.css`, po imporcie `@avably/ui/styles.css`, aby wszystkie istniejące prymitywy panelu korzystały z jednego kontraktu bez zmiany storefrontu. Shell dostanie białą belkę, a aktywna pozycja nawigacji neutralną powierzchnię z małym limonkowym znacznikiem; logika nawigacji i ekranów pozostanie nietknięta.

**Tech Stack:** Next.js 16, React 19, Tailwind CSS 4, CSS custom properties, Vitest, Testing Library.

## Global Constraints

- Node `>=22.13`; polecenia przez `PATH=/opt/homebrew/opt/node@22/bin:$PATH corepack pnpm`.
- Osobny branch `feat/panel-kierunek-lp` i osobny draft PR do `main`.
- Bez migracji, zmian backendu, RLS, i18n i logiki biznesowej.
- Nie zmieniać `packages/ui/src/styles.css`: storefront zachowuje dotychczasowe tokeny.
- Zachować Geist Sans oraz istniejący zakres wag 400–600.
- Jasne tło `#FAFAFA`, powierzchnie `#FFFFFF`, opis `#6F737A`, obrys strukturalny `#ECEEEB`, promienie 3/4/5/6 px.
- Limonka opisuje akcję i aktywny kontekst; statusy wysyłki korzystają z `StatusBadge`, nie z domyślnego badge'a primary.
- Ciemny motyw zachowuje obecną paletę; nowa geometria obowiązuje oba motywy.
- Zatrzymać się przed merge’em; merge wykonuje PM.

---

### Task 1: Kontrakt tokenów panelu

**Files:**
- Create: `apps/panel/test/panel-visual-direction-contract.test.ts`
- Modify: `apps/panel/app/globals.css`

**Interfaces:**
- Consumes: semantyczne zmienne z `@avably/ui/styles.css` (`--background`, `--card`, `--border`, `--input`, `--primary`, `--radius-*`).
- Produces: panelowy kontrakt jasnego motywu i geometrii, automatycznie konsumowany przez klasy Tailwind `bg-background`, `bg-card`, `border-border`, `border-input`, `rounded-*`.

- [ ] **Step 1: Napisać czerwony test kontraktu**

Test ma odczytać `app/globals.css` i sprawdzić dokładnie: selektor `:root:not(.dark)`, `--background: #fafafa`, `--card: #ffffff`, `--border: #eceeeb`, `--input: #8f958d`, `--primary: #d7ff5f`, `--radius-sm: 0.1875rem`, `--radius-md: 0.25rem`, `--radius-lg: 0.3125rem`, `--radius-xl: 0.375rem`. Osobna asercja ma potwierdzić, że `packages/ui/src/styles.css` nie zawiera panelowych komentarzy ani selektora `:root:not(.dark)`.

- [ ] **Step 2: Uruchomić test i potwierdzić oczekiwaną porażkę**

Run: `PATH=/opt/homebrew/opt/node@22/bin:$PATH corepack pnpm --filter panel test -- panel-visual-direction-contract.test.ts`

Expected: FAIL, bo `app/globals.css` nie deklaruje jeszcze panelowych tokenów.

- [ ] **Step 3: Dodać minimalne panelowe nadpisania**

Po importach dopisać `:root:not(.dark)` dla palety jasnej, `:root` dla promieni i statusów oraz komentarz ADR-177 wyjaśniający izolację od storefrontu. Użyć osobnego `--input`, aby pola zachowały czytelną granicę mimo bardzo lekkich obrysów sekcji.

- [ ] **Step 4: Uruchomić test i potwierdzić zieleń**

Run: `PATH=/opt/homebrew/opt/node@22/bin:$PATH corepack pnpm --filter panel test -- panel-visual-direction-contract.test.ts`

Expected: PASS.

### Task 2: Sekcyjny shell i aktywny kontekst

**Files:**
- Modify: `apps/panel/components/shell/panel-topbar.tsx`
- Modify: `apps/panel/components/shell/sidebar-nav.tsx`
- Modify: `apps/panel/test/sidebar-active-contract.test.tsx`
- Modify: `apps/panel/test/panel-shell-contract.test.tsx`

**Interfaces:**
- Consumes: `bg-card`, `bg-muted`, `bg-accent`, `border-border` z Task 1.
- Produces: biała belka na neutralnym tle oraz aktywny link `bg-muted` z dekoracyjnym znacznikiem `before:bg-accent`, bez zmiany `aria-current` i zachowania zwiniętego sidebara.

- [ ] **Step 1: Zmienić testy na nowy kontrakt i uruchomić RED**

W `sidebar-active-contract.test.tsx` zastąpić wymóg `bg-accent` wymogami `bg-muted/60`, `before:bg-accent` i brakiem `bg-accent` jako pełnej powierzchni. W `panel-shell-contract.test.tsx` dodać asercję, że topbar korzysta z `bg-card`, a nie `bg-background`.

Run: `PATH=/opt/homebrew/opt/node@22/bin:$PATH corepack pnpm --filter panel test -- sidebar-active-contract.test.tsx panel-shell-contract.test.tsx`

Expected: FAIL na starych klasach `bg-accent` i `bg-background`.

- [ ] **Step 2: Wdrożyć minimalny shell**

Zmienić topbar na `bg-card`. W obu gałęziach aktywnego linku w `SidebarNav` użyć `bg-muted/60 text-foreground` i pseudo-elementu limonkowej kropki; w dark zachować dotychczasowy `bg-accent` oraz kontrastowy znacznik. Marker ukryć w zwiniętej szynie, aby nie ściskał ikon.

- [ ] **Step 3: Uruchomić GREEN i testy sąsiednie**

Run: `PATH=/opt/homebrew/opt/node@22/bin:$PATH corepack pnpm --filter panel test -- sidebar-active-contract.test.tsx panel-shell-contract.test.tsx sidebar-collapse-contract.test.tsx mobile-bottom-nav-contract.test.tsx`

Expected: PASS.

### Task 3: Dokumentacja decyzji

**Files:**
- Modify: `docs/dokumentacja/index.html`

**Interfaces:**
- Consumes: finalny zakres Tasks 1–2.
- Produces: ADR-177 i dziennik budowy wskazujące zakres, odrzucone warianty, brak wpływu na storefront oraz dowody testowe i wizualne.

- [ ] **Step 1: Dodać ADR-177 i wpis dziennika**

Zapisać decyzje: brak zmiany kroju, neutralne tło zamiast kremowego, 3–6 px, rozdzielenie `--border` i `--input`, jasny motyw odizolowany selektorem `:root:not(.dark)`, ciemny motyw zachowany, aktywny kontekst neutralny z limonkowym znacznikiem.

- [ ] **Step 2: Sprawdzić obecność dokumentacji**

Run: `rg -n "ADR-177|feat/panel-kierunek-lp" docs/dokumentacja/index.html`

Expected: co najmniej dwa trafienia: ADR i dziennik.

### Task 4: Pełna weryfikacja i publikacja PR

**Files:**
- Verify only; bez nowych plików produkcyjnych.

**Interfaces:**
- Consumes: wszystkie wcześniejsze zadania.
- Produces: zweryfikowany commit i draft PR gotowy dla PM-a.

- [ ] **Step 1: Uruchomić pełny test panelu**

Run: `PATH=/opt/homebrew/opt/node@22/bin:$PATH ALLOW_INTEGRATION_SKIP=1 corepack pnpm --filter panel test`

Expected: co najmniej bazowe 232 pliki testowe i 2791 testów zaliczonych, plus nowy kontrakt.

- [ ] **Step 2: Uruchomić typecheck, lint i build**

Run kolejno:

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH corepack pnpm --filter panel typecheck
PATH=/opt/homebrew/opt/node@22/bin:$PATH corepack pnpm --filter panel lint
PATH=/opt/homebrew/opt/node@22/bin:$PATH corepack pnpm --filter panel build
git diff --check
```

Expected: exit 0; istniejące ostrzeżenia lint wolno raportować, błędów nie.

- [ ] **Step 3: Kontrola wizualna**

Uruchomić panel lokalnie i sprawdzić `/pl/design-system` w 1440 px, 736 px i 360 px: neutralność tła, hierarchię białych powierzchni, obrysy, pola, promienie, statusy, brak poziomego overflow, focus oraz ciemny motyw. Jeżeli dostępna jest sesja tenanta, sprawdzić też pulpit, listę zamówień i formularz; brak sesji nie blokuje galerii prymitywów.

- [ ] **Step 4: Commit, rebase, ponowny typecheck i push**

Commit autora `Avably <admin@avably.io>` z polskim komunikatem. Następnie `git fetch origin main`, `git rebase origin/main`, ponowny typecheck i push brancha `feat/panel-kierunek-lp`.

- [ ] **Step 5: Otworzyć draft PR i śledzić CI**

PR do `main`, bez merge. Opis zawiera zakres, ADR-177, testy, pomiary i informację „merge wykonuje PM”. Czekać na joby seryjnie; rozdzielić awarie zakresowe od infrastrukturalnych.
