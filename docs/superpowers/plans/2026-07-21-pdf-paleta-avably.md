# Paleta Avably w umowie PDF — plan implementacji

> **Dla wykonawców agentowych:** WYMAGANA UMIEJĘTNOŚĆ PODRZĘDNA: użyj `executing-plans`, realizując zadania kolejno. Kroki mają składnię checkbox (`- [ ]`).

**Cel:** Zastąpić odziedziczoną paletę umowy PDF finalną paletą Avably i zamknąć ją kontraktem parsującym artefakt brandingu.

**Architektura:** Render pozostaje czystą funkcją o niezmienionym wejściu. Jedyny nowy mechanizm to test kontraktowy: odczytuje sekcję `#foundations` artefaktu, buduje dozwolony zbiór hexów i skanuje wszystkie pliki źródłowe pakietu.

**Stos:** TypeScript, React 19, `@react-pdf/renderer`, Vitest, `unpdf`.

## Ograniczenia globalne

- Zmiany wyłącznie w `packages/pdf/**` i dokumentacji.
- `renderContractPdf(props)` oraz `ContractPdfProps` bez zmian.
- Teksty, sekcje i kolejność umowy bez zmian.
- Zero zależności, migracji, czasu, losowości i środowiska w renderze.
- Autor commitów: `Avably <admin@avably.io>`.

---

### Zadanie 1: Kontrakt kolorów i skóra szablonu

**Pliki:**
- Utwórz: `packages/pdf/test/color-contract.test.ts`
- Zmień: `packages/pdf/src/contract-template.tsx`

**Interfejsy:**
- Konsumuje: sekcję `<section id="foundations">` z artefaktu Fazy 2.
- Produkuje: test bez eksportów produkcyjnych; publiczny interfejs pakietu pozostaje identyczny.

- [ ] **Krok 1: napisz czerwony test**

Test ma odczytać artefakt względem korzenia repo, wyciąć sekcję `foundations`, zebrać `#[0-9A-Fa-f]{6}`, przejść rekurencyjnie po `packages/pdf/src`, a następnie sprawdzić:

```ts
expect(source).not.toMatch(/#(?:D4A843|1e293b)/i);
expect(unknownColors, `${relativePath}: kolory spoza palety`).toEqual([]);
```

Dozwolony zbiór to hexy sekcji 01 oraz jawne `#FFFFFF` opisane jako biel papieru. Test musi potwierdzić obecność `#F4F6F5`, `#0B1017`, `#EAFFA4`, `#5F7500`, `#55616D` i `#7E8994` w źródle palety.

- [ ] **Krok 2: potwierdź czerwony wynik**

Uruchom: `PATH=/opt/homebrew/opt/node@22/bin:$PATH corepack pnpm vitest run test/color-contract.test.ts`

Oczekiwane: błąd wskazujący co najmniej `#D4A843`, `#1e293b`, `#64748b`, `#f8fafc` i `#e2e8f0` w `contract-template.tsx`.

- [ ] **Krok 3: wykonaj minimalny reskin**

Zastąp stałe przez:

```ts
const INK = "#0B1017";
const MUTED = "#55616D";
const CANVAS = "#F4F6F5";
const BORDER = "#7E8994";
const LIME = "#EAFFA4";
const SIGNAL_STRONG = "#5F7500";
const PAPER_WHITE = "#FFFFFF";
```

Ustaw ink-bar w `headerBar`, biel na tytule/metadanych, limonkę z ink na badge'u, `SIGNAL_STRONG` na etykietach, `CANVAS` na polach i `BORDER` na liniach. Nie zmieniaj tekstów ani drzewa sekcji.

- [ ] **Krok 4: potwierdź zielony wynik i brak zmiany treści**

Uruchom: `PATH=/opt/homebrew/opt/node@22/bin:$PATH corepack pnpm vitest run`.

Oczekiwane: wszystkie testy przechodzą; asercje `unpdf` i snapshoty treści EN/PL pozostają bez zmian.

- [ ] **Krok 5: commit**

```bash
git add packages/pdf/src/contract-template.tsx packages/pdf/test/color-contract.test.ts
git commit -m "feat(pdf): zastosuj paletę Avably w umowie"
```

### Zadanie 2: Artefakty odbiorowe i dokumentacja

**Pliki:**
- Utwórz lub zmień: pomocniczy skrypt pod `packages/pdf/**`, jeśli jest potrzebny do powtarzalnego renderu.
- Zmień: `docs/dokumentacja/index.html`

**Interfejsy:**
- Konsumuje: niezmieniony `renderContractPdf(props)`.
- Produkuje: `umowa-avably-pl.pdf` i `rental-agreement-avably-en.pdf` w `.claude/zrzuty-pdf-avably/` oraz dokumentację zamknięcia długu Z6.

- [ ] **Krok 1: wyrenderuj dwa realistyczne PDF-y**

Użyj jawnych danych wejściowych PL/EN, bez czasu i losowości. Zapisz wyniki poza śledzonym drzewem PR-u do katalogu wskazanego w briefie.

- [ ] **Krok 2: obejrzyj oba PDF-y**

Zrenderuj strony do PNG narzędziem PDF dostępnym w systemie i sprawdź: dwie strony, brak ucięć, ink-bar, limonkowy badge z tekstem ink, białe tło dokumentu, czytelne tabele i regulamin.

- [ ] **Krok 3: zaktualizuj dokumentację**

W karcie `@avably/pdf` dodaj finalną paletę i regułę nośnika. Bezpośrednio po nagłówku dziennika dodaj wpis „dług Z6 ZAMKNIĘTY”, wybór ink-baru, test kontraktowy, mutacje i ścieżki PDF-ów. Nie twórz ADR-061.

- [ ] **Krok 4: commit dokumentacji**

```bash
git add docs/dokumentacja/index.html
git commit -m "docs(pdf): zamknij dług palety Z6"
```

### Zadanie 3: Dowody mutacyjne, pełna weryfikacja i PR

**Pliki:** bez trwałych zmian poza plikami zadań 1–2.

**Interfejsy:** publikuje gałąź `feat/pdf-paleta-avably` i PR do `main`.

- [ ] **Krok 1: mutacja starego akcentu**

Tymczasowo zamień `#EAFFA4` na `#D4A843`, uruchom test kontraktu, zachowaj komunikat i przywróć plik.

- [ ] **Krok 2: mutacja obcego koloru**

Tymczasowo zamień jeden dozwolony hex na `#FF00FF`, uruchom test kontraktu, zachowaj komunikat i przywróć plik.

- [ ] **Krok 3: mutacja kwoty przykładu**

Tymczasowo zmień `totals.rentalGrosze` w `baseProps`, uruchom test snapshotu PL, zachowaj diff snapshotu i przywróć plik oraz snapshot.

- [ ] **Krok 4: świeża weryfikacja**

Uruchom w `packages/pdf`: `corepack pnpm vitest run`, `corepack pnpm typecheck`, `corepack pnpm lint`. Sprawdź `git diff --check`, brak zmian w `apps/**`, `packages/ui/**` i lockfile, brak zakazanych kolorów oraz niepusty `git diff --stat` względem `origin/main`.

- [ ] **Krok 5: publikacja**

Wypchnij gałąź bez force-pusha, utwórz PR do `main`, poczekaj na oba joby CI i zgłoś zwięzły raport z commitami, mutacjami, decyzją akcentu, ścieżkami PDF-ów oraz odstępstwami.
