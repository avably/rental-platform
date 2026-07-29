# Spike C0 — silnik edycji inline/bloków: Puck vs własny (dnd-kit)

**Data:** 2026-07-29 · **Gałąź:** `spike/kreator-c0` (DRAFT, NIGDY do merge) ·
**Wejście do ADR-083** · **Decyzję podejmuje właściciel z PM.**

## STATUS

Zrobione w timeboxie 1 sesji. Działający prototyp JEDNEJ sekcji (hero:
nagłówek, podtytuł, przycisk + bloki zalet + wariant układu) w OBU wariantach,
osadzony w realnym panelu (Next 16 / React 19 / Tailwind 4 / nasze tokeny /
nasze CSP), zweryfikowany w przeglądarce. Trasy: `/pl/kreator-spike/custom`
(wariant B) i `/pl/kreator-spike/puck` (wariant A), poza grupą `(panel)` —
bez auth, bez DB, konta demo nietknięte.

- **Puck**: pakiet `@measured/puck` jest **DEPRECATED** → przeniesiony do
  `@puckeditor/core` (0.22.4). Prototyp zbudowany na aktualnym pakiecie.
- Oba warianty **budują się i działają** na Next 16 + React 19 (produkcyjny
  `next build` + `next start`, exit 0).
- Jedno wspólne odkrycie (dotyczy OBU): trasa edytora MUSI być
  `dynamic = "force-dynamic"`. Statyczny prerender + nasze CSP (nonce +
  `strict-dynamic`) = skrypty bez nonce → przeglądarka je blokuje → brak
  hydracji. Po ustawieniu dynamiki hydracja i interakcje działają.

**REKOMENDACJA: budujemy własny silnik (wariant B).** Uzasadnienie niżej.

---

## Tabela kryteriów (werdykt + dowód)

| # | Kryterium | Puck (A) | Własny (B) | Werdykt |
|---|-----------|----------|------------|---------|
| 1 | **Mapowanie danych → nasz jsonb** | Trzyma WŁASNY format `Data = {root, content:[{type,props}], zones}`; wymaga dwukierunkowego adaptera i wstrzykuje `id` per komponent. | Stan edytora **JEST** obiektem `SpikeHeroContent`. Zero formatu pośredniego. | **B** |
| 2 | **Design system** | Chrome edytora to Puck (niebieski „Publish", szare panele, własne ikony/typografia, niebieski focus). Ignoruje nasz motyw i akcent (limonka). Canvas = nasz render, ale POWŁOKA obca. | 100% nasze tokeny + `Button` + karty. Fokus = nasza konwencja (obrys 3px accent). | **B** |
| 3 | **A11y (inline + reorder klawiaturą)** | Edycja pól w prawym panelu (formularz) + inline na canvasie przez TipTap. Fokus i model klawiatury Pucka, nie nasz. | `contentEditable role=textbox`+`aria-label`, focus-visible wg naszej konwencji (potwierdzone zrzutem). Reorder: dnd-kit `KeyboardSensor`+`sortableKeyboardCoordinates`, uchwyt fokusowalny z limonkowym obrysem. | **B** (nasze konwencje 1:1) |
| 4 | **Waga bundla** (produkcyjny `next start`, First Load JS trasy) | **1642.9 kB raw** JS (16 plików) + **96.9 kB** CSS Pucka (13.4 kB gzip). Fresh gzip transfer: **162.4 kB**. | **1186.3 kB raw** JS (15 plików), CSS współdzielony. | **B** (Puck +456.6 kB raw / +38.5% + osobny arkusz) |
| 5 | **Bezpieczeństwo (treść → storefront)** | Ten sam render (`SpikeHero`, React escapuje). Ale TipTap jest HTML-owy — jeśli kiedyś użyć jego wyjścia HTML, rośnie powierzchnia XSS. | Ten sam render + nasz istniejący wzorzec `SafeRichText` (bez `dangerouslySetInnerHTML`). Mniejsza powierzchnia. | **B** (nieznacznie) |
| 6 | **Koszt utrzymania** | 13k★, MIT, bardzo aktywny (v0.22.4 wydany DZIŚ). ALE: wciąż **pre-1.0** (churn API), świeży **rename `@measured`→`@puckeditor`** (koszt migracji), ciężkie drzewo: **+99 pakietów** (TipTap 22 pkg, dnd-kit v0.4 7 pkg). Adapter (kryt.1) rośnie z każdym typem sekcji. | ~250 linii kodu, zależność (`@dnd-kit`) i tak wchodzi w etapie A1. Rośnie liniowo z naszymi małymi komponentami. Zero treadmillu upstreamu. | zależy od strategii; dla nas **B** |
| 7 | **RSC / iframe podglądu (A3) / Safari** | Buduje się i działa na Next 16. Domyślny **iframe canvasu koliduje z naszym CSP** (`frame-src` z `default-src 'self'`) — wyłączony (`iframe:{enabled:false}`), by prototyp działał. `Render` RSC dostępny osobno. | `SpikeHero` bez `"use client"` — RSC-safe dla storefrontu z pudełka. Mniej ruchomych części pod iframe/Safari. | **B** |

### Dowód kryterium 1 (lock-in) — zrzut żywego stanu z obu paneli

Puck trzyma:
```json
{ "root": {}, "zones": {},
  "content": [ { "type": "Hero", "props": {
    "id": "hero-1", "heading": "...", "subheading": "...",
    "ctaText": "...", "ctaHref": "/sprzet", "align": "left",
    "bullets": [ { "text": "..." } ] } } ] }
```
Nasz jsonb po adapterze `puckDataToHero(data)` (to trafia do `content_draft`):
```json
{ "heading": "...", "subheading": "...", "ctaText": "...",
  "ctaHref": "/sprzet", "align": "left",
  "bullets": [ { "id": "b0", "text": "..." }, ... ] }   // Zod: valid
```
Różnica = powierzchnia utrzymania: rozpakuj/zapakuj envelope, wstrzyknij/usuń
`id` komponentu, zsyntetyzuj `id` bloków. Dwukierunkowo, przy każdej zmianie
schematu treści. Wariant B tego kodu nie ma — stan to jsonb.

### Dowody weryfikacji w przeglądarce (produkcyjny build, port 3140)

- **B/custom:** edycja inline nagłówka → podgląd aktualizuje się na żywo, pole
  z limonkowym obrysem focus-visible; przełącznik wariantu „Środek" → podgląd
  wyśrodkowany, przycisk aktywny (limonka); uchwyt bloku fokusowalny z obrysem;
  panel `content_draft` = „Zod: valid". Tokeny poprawnie adaptują się do
  ciemnego motywu.
- **A/puck:** pełny edytor Pucka (blocks/outline, canvas, panel pól, „Publish");
  edycja pola „Nagłówek" → canvas i nasz jsonb aktualizują się na żywo
  („Sprzęt eventowy na godziny", Zod: valid). Widoczna obca powłoka (niebieski
  akcent, szare panele) obok naszego ciemnego motywu.

---

## REKOMENDACJA (5 zdań)

Budujemy **własny silnik** na `@dnd-kit` + `packages/ui`, bo edytor stron to
rdzeniowa, długowieczna i mocno brandowana powierzchnia, którą chcemy w pełni
posiadać. Nasz stan to gotowy `content_draft` (jsonb + Zod) i mamy już
zbudowany, RSC-bezpieczny render — Puck dokłada tu format pośredni z lock-inem,
którego adapter rośnie z każdym typem sekcji. Puck ma realną wartość „od ręki"
(canvas, viewporty, undo/redo, drzewo), ale jego powłoka nie jest naszym design
systemem (wymagałaby ciężkiego nadpisania CSS), waży +38% bundla i wciąga
TipTap oraz 99 pakietów, jest pre-1.0 i właśnie przeszedł rename pakietu. Etap
A1 i tak wprowadza `@dnd-kit` na reorder sekcji, więc marginalny koszt C1–C3
(bloki, inline, warianty) na własnym silniku jest mały i przyrostowy. Puck
byłby racjonalny, gdyby zależało nam na czasie-do-pierwszego-edytora kosztem
brandu, wagi i kontroli — u nas priorytety są odwrotne.

## Ryzyka wybranej opcji (własny) + mitygacje

1. **Sami utrzymujemy solidność `contentEditable`** (IME, wklejanie, mobile).
   → Wąski zakres pól (nagłówki/akapity/przyciski), pole niekontrolowane
   (źródło prawdy = DOM), testy jednostkowe parsera treści.
2. **Brak darmowego undo/redo/viewportów/drzewa.** → Budujemy tylko to, czego
   naprawdę wymaga zakres (A3 daje już viewporty; undo/redo dopiero gdy realnie
   potrzebne).
3. **Safari** (właściciel testuje w Safari — pułapka in-app Chromium). →
   Techniki poprawne z konstrukcji, weryfikacja w Safari przed akceptem zrzutów.
4. **Scope creep** w pogoni za feature-parity z Puckiem. → Trzymamy się listy
   C1–C3; „canvas jak w Shopify" to osobna decyzja, nie domyślna.
5. **Dyscyplina CSP:** trasa edytora musi być `force-dynamic` (nonce). →
   Zapisane w konwencjach; kontrakt/test na obecność dynamiki.

## Szkic planu C1–C3 pod własny silnik

- **C1 — bloki w sekcjach:** rozszerzyć schematy w `@avably/core/site` o
  tablice bloków (Zod discriminated unions; USP/testimonials). Reorder =
  DOKŁADNIE wzorzec `SortableBullet` z tego spike'u (współdzielony z A1). Bez
  migracji (jsonb). *Upraszcza:* jeden wzorzec DnD dla sekcji i bloków.
- **C2 — edycja inline na podglądzie:** przenieść `InlineEditable` na
  powierzchnię podglądu; autosave z debounce → server action `upsertSection`.
  Fokus i a11y = konwencja z tego spike'u. *Komplikuje:* trzeba dopiąć autosave
  + stan „zapisywanie", ale to nasza istniejąca mechanika `useTransition`.
- **C3 — warianty układu:** pole `variant`/`align` (Zod enum per typ — jak
  `heroAlignmentSchema` tutaj), przełącznik w ustawieniach sekcji, render w OBU
  szablonach (classic/bold). *Upraszcza:* zero adaptera, jedna ścieżka renderu.

### Gdyby jednak Puck (dla równowagi)
Adopcja: `@puckeditor/core`, `iframe:{enabled:false}` (CSP), `force-dynamic`,
adapter `Data ⇄ content_draft` per typ sekcji, ciężkie nadpisanie CSS pod nasz
design system, i pin wersji + proces śledzenia breaking changes (pre-1.0).
To kupuje canvas/undo/viewporty „od ręki", płacąc bundlem, brandem i lock-inem.

---

## Artefakty spike'u (na gałęzi, do wglądu — nie do merge)

- `apps/panel/app/[locale]/kreator-spike/spike-hero-schema.ts` — wspólny Zod/jsonb.
- `apps/panel/app/[locale]/kreator-spike/spike-hero-view.tsx` — wspólny render (RSC-safe).
- `.../custom/*` — wariant B (dnd-kit + contentEditable + kontrolki ui).
- `.../puck/*` — wariant A (config + adapter `Data ⇄ jsonb` + edytor).
