# Avably Phase 1 Moodboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zbudować jeden samodzielny moodboard HTML porównujący trzy kierunki pełnego brandingu Avably w UI, hero landing page i dwóch animowanych formatach social media.

**Architecture:** Artefakt jest pojedynczym semantycznym dokumentem HTML bez JavaScriptu i bez zależności sieciowych. CSS, siedem plików WOFF2 jako dane base64 oraz logo w dwóch wariantach SVG są osadzone inline; CSS odpowiada także za motion, zatrzymywanie pętli i `prefers-reduced-motion`. Oddzielny skrypt Node sprawdza kontrakt dokumentu, a istniejący hub dokumentacji dostaje tylko odnośnik.

**Tech Stack:** HTML5, CSS, inline SVG, WOFF2/data URL, Node.js 22 `node:assert`, istniejący runner pnpm/Turborepo.

## Global Constraints

- Implementować wyłącznie fazę 1 z `docs/superpowers/specs/2026-07-20-avably-moodboard-faza-1-design.md`; nie zmieniać aplikacji, `packages/ui`, tokenów ani produkcyjnych assetów.
- Wynik wizualny to dokładnie `docs/branding/2026-07-20-avably-faza-1-moodboard.html` i musi otwierać się bez serwera oraz bez żądań sieciowych.
- Użyć Safiro Medium wyłącznie jako prawdziwej wagi 500; użyć zmiennego Manrope jako otwartego zamiennika wag 400/600/700; nie syntetyzować wag ani kursywy.
- Użyć Geist Sans 400/500/600 dla treści i kontrolek oraz Geist Mono 400/500 dla identyfikatorów, dat, liczb i kwot.
- Zachować `font-synthesis: none`; każdy `@font-face` ma `font-style: normal` i zakres wag zgodny z rzeczywistym plikiem.
- Wspólne kolory marki to `#EAFFA4`, `#A8C743` i niemal czarny `#0B1017`.
- Pokazać trzy kierunki: „Sygnał operacyjny”, „Papier roboczy” i „Czarna rama”, zawsze z identycznym copy i danymi demonstracyjnymi.
- W każdym kierunku pokazać panel, hero LP `16:10`, animowaną reklamę `1:1` oraz animowaną reklamę `4:5`; nie używać zdjęć stockowych, gradientów, glassmorphismu, ilustracji 3D ani cieni kart.
- Motion ma używać czasów `160ms`, `240ms`, `720ms`, `6000ms`, `8000ms` i `16000ms` oraz easingów `cubic-bezier(0.22, 1, 0.36, 1)` i `cubic-bezier(0.2, 0.7, 0.2, 1)`.
- Kropka logo jest wspólnym sygnałem ruchu; nie wolno morfować, obracać ani sprężynować liter, kapsuły lub krzywych znaku.
- UI korzysta tylko z mikrointerakcji `160–240ms`; LP ma jedną ciągłą szynę danych `16000ms`; każda reklama ma pętlę `8000ms` z nieruchomą kompozycją między `72%` i `92%`.
- Pętle zatrzymują się na hover i `focus-within`; `@media (prefers-reduced-motion: reduce)` usuwa ruch i pokazuje kompletny stan końcowy.
- Animować wyłącznie `transform`, `opacity` i płaski kolor; bez blur, parallaxu, scroll hijackingu oraz zmian układu.
- Limonka jest sygnałem i CTA, nie dużym tłem; drobny tekst na limonce ma kolor `#0B1017`.
- Spełnić WCAG AA dla każdej rzeczywiście użytej pary oraz wypisać policzone kontrasty z dokumentu projektowego.
- Copy opisuje wyłącznie działające funkcje; nie dodawać płatności online, fikcyjnych klientów, wyników, opinii, nagród ani dowodu społecznego.
- Wszystkie trwałe teksty i commity są po polsku; autor commita to Maciej Godek bez stopek i bez wzmianki o AI.

## File Map

- Create and extend: `scripts/verify-branding-moodboard.mjs` — deterministyczny kontrakt struktury, offline, fontów, copy, motion i odnośnika w hubie.
- Create: `docs/branding/2026-07-20-avably-faza-1-moodboard.html` — jedyny artefakt wizualny.
- Modify: `docs/dokumentacja/hub.html` — jedna aktywna karta odsyłająca do moodboardu.
- Reference: `docs/superpowers/specs/2026-07-20-avably-moodboard-faza-1-design.md` — wiążące decyzje wizualne, copy i kontrasty.
- Reference: `/Users/godekmaciej/Desktop/Frame 2610196.svg` — źródłowe krzywe logo.
- Reference: `/Users/godekmaciej/Downloads/Safiro Medium/Webfont/Webfont Kit/safiro-medium-webfont.woff2` — Safiro Medium 500.

---

### Task 1: Kontrakt automatyczny artefaktu

**Files:**
- Create: `scripts/verify-branding-moodboard.mjs`
- Test: `scripts/verify-branding-moodboard.mjs`

**Interfaces:**
- Consumes: docelowy HTML i opcjonalny argument `--artifact-only`.
- Produces: komunikat `moodboard_contract=passed` i kod `0`, gdy wszystkie reguły są spełnione.

- [ ] **Step 1: Dodać test kontraktowy przed artefaktem**

```js
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const artifactPath = `${root}/docs/branding/2026-07-20-avably-faza-1-moodboard.html`;
const hubPath = `${root}/docs/dokumentacja/hub.html`;
assert.ok(existsSync(artifactPath), `Brak moodboardu: ${artifactPath}`);
const html = readFileSync(artifactPath, "utf8");
const count = (needle) => html.split(needle).length - 1;

assert.match(html, /^<!doctype html>/i);
assert.match(html, /<html lang="pl">/);
assert.equal(count("<style>"), 1);
assert.equal(count("data:font/woff2;base64,"), 7);
assert.doesNotMatch(html, /https?:\/\//i);
assert.doesNotMatch(html, /<script\b|<link\b/i);
assert.doesNotMatch(
  html,
  /linear-gradient|radial-gradient|backdrop-filter|box-shadow/i,
);
assert.match(html, /font-synthesis:\s*none/);

for (const font of ["Safiro", "Manrope", "Geist Sans", "Geist Mono"]) {
  assert.ok(html.includes(`font-family: "${font}"`), `Brak fontu ${font}`);
}

for (const direction of [
  "Sygnał operacyjny",
  "Papier roboczy",
  "Czarna rama",
]) {
  assert.ok(html.includes(direction), `Brak kierunku ${direction}`);
}

for (const repeatedCopy of [
  "Prowadź wynajem. Przyjmuj rezerwacje online.",
  "Jeden egzemplarz. Jeden termin. Jedna rezerwacja.",
  "Klient rezerwuje online. Zamówienie od razu trafia do panelu.",
]) {
  assert.equal(count(repeatedCopy), 3, `Copy nie występuje trzy razy: ${repeatedCopy}`);
}

for (const datum of [
  "ZAM/2026/0714",
  "Anna Kowalska",
  "Nagrzewnica 20 kW",
  "20–22.07.2026",
  "1 199,00 zł",
  "Do wydania",
]) {
  assert.ok(html.includes(datum), `Brak danych demonstracyjnych: ${datum}`);
}

for (const ratio of [
  /aspect-ratio:\s*16\s*\/\s*10/,
  /aspect-ratio:\s*1\s*\/\s*1/,
  /aspect-ratio:\s*4\s*\/\s*5/,
]) {
  assert.match(html, ratio);
}

for (const sectionId of [
  "logo",
  "directions",
  "applications",
  "typography",
  "contrast",
  "not-included",
  "choice",
]) {
  assert.ok(html.includes(`id="${sectionId}"`), `Brak sekcji #${sectionId}`);
}

for (const value of [
  "17.57:1",
  "19.08:1",
  "9.92:1",
  "1.09:1",
  "#EAFFA4",
  "#A8C743",
  "#0B1017",
  "#122035",
]) {
  assert.ok(html.includes(value), `Brak wartości ${value}`);
}

assert.match(html, /Faza 2 nie została rozpoczęta/);

if (!process.argv.includes("--artifact-only")) {
  const hub = readFileSync(hubPath, "utf8");
  assert.ok(
    hub.includes("../branding/2026-07-20-avably-faza-1-moodboard.html"),
    "Hub nie zawiera odnośnika do moodboardu",
  );
}

console.log("moodboard_contract=passed");
```

- [ ] **Step 2: Uruchomić test i potwierdzić prawidłową porażkę**

Run:

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH node scripts/verify-branding-moodboard.mjs --artifact-only
```

Expected: `AssertionError` z komunikatem `Brak moodboardu`.

- [ ] **Step 3: Zapisać kontrakt**

```bash
git add scripts/verify-branding-moodboard.mjs
git commit -m "test: dodaj kontrakt moodboardu Avably"
```

---

### Task 2: Rozszerzenie kontraktu o motion

**Files:**
- Modify: `scripts/verify-branding-moodboard.mjs`
- Test: `scripts/verify-branding-moodboard.mjs`

**Interfaces:**
- Consumes: istniejący kontrakt offline z Task 1.
- Produces: dodatkowe asercje dla sekcji `#motion`, czterech typów animacji, dwunastu demonstracji, pauzy oraz reduced motion.

- [ ] **Step 1: Dodać wymagania motion przed artefaktem**

Za asercją sekcji dodać `motion` do tablicy `sectionId`, a przed sprawdzeniem komunikatu o fazie 2 dodać:

```js
for (const motionToken of [
  "--motion-fast: 160ms",
  "--motion-ui: 240ms",
  "--motion-reveal: 720ms",
  "--motion-logo: 6000ms",
  "--motion-ad: 8000ms",
  "--motion-ambient: 16000ms",
  "cubic-bezier(0.22, 1, 0.36, 1)",
  "cubic-bezier(0.2, 0.7, 0.2, 1)",
]) {
  assert.ok(html.includes(motionToken), `Brak wartości motion: ${motionToken}`);
}

for (const keyframe of [
  "logo-signal",
  "ui-state",
  "operational-rail",
  "ad-sequence",
]) {
  assert.ok(html.includes(`@keyframes ${keyframe}`), `Brak animacji ${keyframe}`);
}

assert.equal(count("data-motion-demo"), 12);
assert.match(html, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
assert.match(html, /animation-play-state:\s*paused/);
assert.match(html, /animation:\s*none\s*!important/);
assert.match(html, /transition:\s*none\s*!important/);
```

- [ ] **Step 2: Potwierdzić składnię i nadal prawidłowy RED**

Run:

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH node --check scripts/verify-branding-moodboard.mjs
PATH=/opt/homebrew/opt/node@22/bin:$PATH node scripts/verify-branding-moodboard.mjs --artifact-only
```

Expected: kontrola składni kończy się kodem `0`; kontrakt kończy się `AssertionError: Brak moodboardu`, ponieważ produkcyjny artefakt nadal nie istnieje.

- [ ] **Step 3: Zapisać rozszerzony kontrakt**

```bash
git add scripts/verify-branding-moodboard.mjs
git commit -m "test: rozszerz kontrakt moodboardu o motion"
```

---

### Task 3: Samodzielny moodboard pełnego brandingu

**Files:**
- Create: `docs/branding/2026-07-20-avably-faza-1-moodboard.html`
- Test: `scripts/verify-branding-moodboard.mjs`

**Interfaces:**
- Consumes: siedem plików WOFF2, krzywe źródłowego logo, copy, palety i motion ze specyfikacji.
- Produces: jeden offline HTML z sekcjami `#logo`, `#directions`, `#applications`, `#motion`, `#typography`, `#contrast`, `#not-included` i `#choice`.

- [ ] **Step 1: Pobrać tylko otwarte podzbiory Manrope potrzebne dla języka polskiego**

Run:

```bash
mkdir -p /tmp/avably-moodboard-fonts
curl -fsSL https://fonts.gstatic.com/s/manrope/v20/xn7gYHE41ni1AdIRggmxSvfedN62Zw.woff2 -o /tmp/avably-moodboard-fonts/manrope-latin-ext.woff2
curl -fsSL https://fonts.gstatic.com/s/manrope/v20/xn7gYHE41ni1AdIRggexSvfedN4.woff2 -o /tmp/avably-moodboard-fonts/manrope-latin.woff2
```

Expected: oba pliki są niepuste i zaczynają się od sygnatury `wOF2`. Są to podzbiory `latin-ext` i `latin` zmiennego Manrope 400–700 udostępnianego przez Google Fonts na licencji OFL 1.1.

- [ ] **Step 2: Utworzyć semantyczny dokument i osadzić siedem fontów**

Dokument ma używać poniższego kontraktu fontów; każdą wartość `data:font/woff2;base64,` uzupełnić bajtami wskazanego pliku podczas mechanicznego osadzenia, a po osadzeniu nie pozostawić żadnego odwołania do ścieżki źródłowej:

```css
@font-face {
  font-family: "Safiro";
  src: url(data:font/woff2;base64,__SAFIRO_MEDIUM_BASE64__) format("woff2");
  font-style: normal;
  font-weight: 500;
  font-display: swap;
}
@font-face {
  font-family: "Manrope";
  src: url(data:font/woff2;base64,__MANROPE_LATIN_EXT_BASE64__) format("woff2");
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7,
    U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F,
    U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113,
    U+2C60-2C7F, U+A720-A7FF;
}
@font-face {
  font-family: "Manrope";
  src: url(data:font/woff2;base64,__MANROPE_LATIN_BASE64__) format("woff2");
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC,
    U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F,
    U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
```

Powtórzyć dwupodzbiorowy wzorzec dla `Geist Sans` i `Geist Mono`, używając odpowiednio:

- `node_modules/.pnpm/next@16.2.10_@babel+core@7.29.7_react-dom@19.2.7_react@19.2.7__react@19.2.7/node_modules/next/dist/next-devtools/server/font/geist-latin-ext.woff2`;
- ten sam katalog, `geist-latin.woff2`;
- ten sam katalog, `geist-mono-latin-ext.woff2`;
- ten sam katalog, `geist-mono-latin.woff2`.

Ustawić zakres `400 600` dla Geist Sans i `400 500` dla Geist Mono. Na `html` ustawić `font-synthesis: none`.

- [ ] **Step 3: Zbudować system strony i porównanie logo**

Użyć jednej strony o maksymalnej szerokości `1600 px`, płaskich powierzchniach i widocznych obrysach. W `#logo` umieścić dwa SVG `348 × 93`:

- „Przed”: dokładne źródłowe tło `#EAFFA4`, kropka `cx=59.5`, `cy=46.5`, `r=14.5`, krzywe liter `#122035`.
- „Po”: te same krzywe, litery `#0B1017`, grupa przesunięta o `2 px` w lewo, kropka `cx=57.5`, `cy=46`, `r=15`.

Pod porównaniem umieścić dokładne uzasadnienie: „Nieco cięższa i wyżej ustawiona kropka oraz prawie czarny logotyp równoważą długi wyraz bez zmiany koncepcji znaku.”

- [ ] **Step 4: Zbudować trzy porównywalne kierunki UI**

W `#directions` użyć CSS Grid z trzema kolumnami od `1180 px` i jednej kolumny poniżej. Każda karta ma zawierać nazwę, decyzję, zysk, koszt, siedem podpisanych próbek palety, próbkę Safiro 500 i identyczny wiersz zamówienia oznaczony kolejno `data-motion-demo="ui-signal"`, `data-motion-demo="ui-paper"` i `data-motion-demo="ui-frame"`:

```text
ZAM/2026/0714 | Anna Kowalska | Nagrzewnica 20 kW | 20–22.07.2026 | 1 199,00 zł | Do wydania
```

Konstrukcje kierunków:

- Sygnał operacyjny: canvas `#F4F6F5`, biała powierzchnia, limonkowe CTA i wąski aktywny marker.
- Papier roboczy: canvas `#FAF8F0`, dokumentowe linie i ograniczone pole limonkowe tylko przy krótkiej etykiecie.
- Czarna rama: shell `#0B1017`/`#171D25`, jasne pole pracy, limonkowy marker aktywnej sekcji i CTA.

- [ ] **Step 5: Zbudować trzy pełne plansze „Branding w użyciu”**

W `#applications` utworzyć trzy `article.brand-application`, każdy z identycznym drzewem treści. Pierwszy artykuł ma poniższy kontrakt; dwa kolejne używają tego samego drzewa i copy, z `data-direction="paper"` / nagłówkiem `Papier roboczy` oraz `data-direction="frame"` / nagłówkiem `Czarna rama`:

```html
<article class="brand-application" data-direction="signal">
  <header class="application-heading">
    <p class="application-number">Kierunek 01</p>
    <h3>Sygnał operacyjny</h3>
    <p>Limonka prowadzi do działania, a neutralna baza utrzymuje czytelność.</p>
  </header>
  <div class="application-grid">
    <figure class="lp-preview motion-loop" data-motion-demo="lp-signal">
      <div class="lp-frame">
        <nav aria-label="Nawigacja makiety landing page">
          <svg class="brand-logo" role="img" aria-label="Avably"><use href="#logo-after"></use></svg>
          <span>Produkt</span><span>Dla wypożyczalni</span><span>Kontakt</span>
        </nav>
        <div class="lp-copy">
          <p>System dla wypożyczalni sprzętu</p>
          <h4>Prowadź wynajem. Przyjmuj rezerwacje online.</h4>
          <p>Rezerwacje, dostępność sprzętu, kaucje, kurier i e-maile w jednym panelu. Do tego własna strona sklepu z rezerwacją online — bez instalacji i bez informatyka.</p>
          <p><strong>199 zł miesięcznie</strong></p>
          <a href="#choice">Zapisz się na listę oczekujących</a>
          <a href="#directions">Zobacz, jak działa</a>
        </div>
        <div class="lp-order-row" aria-label="Demonstracyjny wiersz zamówienia">
          <span>ZAM/2026/0714</span><span>Anna Kowalska</span>
          <span>Nagrzewnica 20 kW</span><span>20–22.07.2026</span>
          <span>1 199,00 zł</span><span>Do wydania</span>
        </div>
      </div>
      <figcaption>Landing page · pole 1440 × 900 px</figcaption>
    </figure>
    <div class="social-previews">
      <figure class="social-square motion-loop" data-motion-demo="ad-square-signal">
        <div class="social-frame">
          <svg class="brand-logo" role="img" aria-label="Avably"><use href="#logo-after"></use></svg>
          <p>Dostępność sprzętu</p>
          <h4>Jeden egzemplarz. Jeden termin. Jedna rezerwacja.</h4>
          <p>Avably pilnuje dostępności sprzętu także wtedy, gdy dwóch pracowników lub dwóch klientów klika w tej samej chwili.</p>
          <span>Zapisz się na listę oczekujących</span>
        </div>
        <figcaption>Post 1:1 · 1080 × 1080 px</figcaption>
      </figure>
      <figure class="social-portrait motion-loop" data-motion-demo="ad-portrait-signal">
        <div class="social-frame">
          <svg class="brand-logo" role="img" aria-label="Avably"><use href="#logo-after"></use></svg>
          <p>Własny sklep</p>
          <h4>Klient rezerwuje online. Zamówienie od razu trafia do panelu.</h4>
          <p>Każda wypożyczalnia dostaje własny adres sklepu i edytor strony. Klient wybiera sprzęt i termin, a obie strony dostają potwierdzenie e-mailem.</p>
          <span>Zapisz się na listę oczekujących</span>
        </div>
        <figcaption>Post 4:5 · 1080 × 1350 px</figcaption>
      </figure>
    </div>
  </div>
</article>
```

Każdy hero zawiera logo, `Produkt`, `Dla wypożyczalni`, `Kontakt`, nadtytuł „System dla wypożyczalni sprzętu”, nagłówek „Prowadź wynajem. Przyjmuj rezerwacje online.”, treść i oba CTA ze specyfikacji, cenę `199 zł miesięcznie` oraz fragment tego samego zamówienia. Każda reklama zawiera pełne copy, CTA i podpis wymiaru ze specyfikacji. Dla pozostałych kierunków użyć dokładnie `lp-paper`, `ad-square-paper`, `ad-portrait-paper`, `lp-frame`, `ad-square-frame` i `ad-portrait-frame`; z trzema wierszami UI oraz trzema wartościami wariantu signal daje to dokładnie dwanaście `data-motion-demo`. Nie używać pełnego limonkowego tła w żadnym formacie.

- [ ] **Step 6: Zaimplementować motion w UI, LP, reklamach i logotypie**

W `:root` zadeklarować dokładnie:

```css
--motion-fast: 160ms;
--motion-ui: 240ms;
--motion-reveal: 720ms;
--motion-logo: 6000ms;
--motion-ad: 8000ms;
--motion-ambient: 16000ms;
--ease-out: cubic-bezier(0.22, 1, 0.36, 1);
--ease-standard: cubic-bezier(0.2, 0.7, 0.2, 1);
```

Zdefiniować co najmniej cztery nazwane animacje wymagane kontraktem:

```css
@keyframes logo-signal {
  0% { opacity: 0; transform: translateX(-12px) scale(0.84); }
  5%, 94% { opacity: 1; transform: translateX(0) scale(1); }
  97% { opacity: 1; transform: translateY(-0.5px) scale(1.08); }
  100% { opacity: 1; transform: translateX(0) scale(1); }
}
@keyframes ui-state {
  from { opacity: 0.4; transform: scaleY(0.2); }
  to { opacity: 1; transform: scaleY(1); }
}
@keyframes operational-rail {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}
@keyframes ad-sequence {
  0%, 4% { opacity: 0; transform: translateY(8px); }
  12%, 92% { opacity: 1; transform: translateY(0); }
  100% { opacity: 0; transform: translateY(-4px); }
}
```

Uzupełnić je osobnymi revealami dzieci reklamy tak, aby logo wchodziło w `0–12%`, headline w `12–34%`, produkt w `34–54%`, CTA w `54–72%`, a całość pozostawała statyczna w `72–92%`. UI korzysta z `ui-state` tylko przy wejściu i z transition `160–240ms` na hover/focus. LP używa jednego liniowego `operational-rail` `16000ms infinite` oraz jednorazowego reveal `720ms`; nie dodawać drugiej ciągłej warstwy.

Kropka we wszystkich logo może używać `logo-signal`, ale litery i kapsuła wyłącznie jednorazowego opacity/translate do `8 px`. Sygnał operacyjny porusza się po prostych osiach, Papier roboczy odsłania linię dokumentu z przesunięciem do `6 px`, a Czarna rama przesuwa tylko limonkowy wskaźnik nawigacji.

Dodać pauzę i reduced motion:

```css
.motion-loop:hover *,
.motion-loop:focus-within * {
  animation-play-state: paused;
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
  }
  [data-motion-demo] * {
    opacity: 1 !important;
    transform: none !important;
    clip-path: none !important;
  }
}
```

W `#motion` wypisać czasy, oba easingi, zasadę kropki jako sygnału, storyboard `0–12 / 12–34 / 34–54 / 54–72 / 72–92 / 92–100%` i zachowanie reduced motion. Sekcja ma być statycznym objaśnieniem; dwanaście żywych demonstracji pozostaje w UI/LP/reklamach.

- [ ] **Step 7: Dodać próbnik, kontrasty, odrzucenia i bramkę wyboru**

W `#typography` pokazać `Manrope 400 / Safiro Medium 500 / Manrope 600 / Manrope 700` z nazwą rodziny przy każdej linii, a także nagłówek, akapit, małą tabelę oraz liczby w Geist Mono. W `#contrast` przepisać wszystkie 18 policzonych par ze specyfikacji i osobno wyjaśnić `1.09:1` limonki na bieli oraz podwójny focus. W `#not-included` pokazać osiem odrzuconych zabiegów. W `#choice` zakończyć zdaniem „Wybierz jeden kierunek: Sygnał operacyjny, Papier roboczy albo Czarna rama. Faza 2 nie została rozpoczęta.”

- [ ] **Step 8: Uruchomić kontrakt tylko dla artefaktu**

Run:

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH node scripts/verify-branding-moodboard.mjs --artifact-only
```

Expected: `moodboard_contract=passed`.

- [ ] **Step 9: Zapisać artefakt**

```bash
git add docs/branding/2026-07-20-avably-faza-1-moodboard.html
git commit -m "feat: dodaj moodboard pełnego brandingu Avably"
```

---

### Task 4: Odnośnik w centrum dokumentacji

**Files:**
- Modify: `docs/dokumentacja/hub.html`
- Test: `scripts/verify-branding-moodboard.mjs`

**Interfaces:**
- Consumes: gotowy względny adres `../branding/2026-07-20-avably-faza-1-moodboard.html`.
- Produces: aktywną kartę w sekcji `#dokumenty` bez zmiany wyglądu hubu.

- [ ] **Step 1: Uruchomić pełny kontrakt i potwierdzić brak odnośnika**

Run:

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH node scripts/verify-branding-moodboard.mjs
```

Expected: `AssertionError` z komunikatem `Hub nie zawiera odnośnika do moodboardu`.

- [ ] **Step 2: Dodać dokładnie jedną kartę w `#dokumenty .links`**

```html
<a class="linkcard" href="../branding/2026-07-20-avably-faza-1-moodboard.html"><p class="t">Avably — moodboard brandingu, faza 1</p><p class="d">Trzy kierunki porównane w panelu, landing page i animowanych reklamach social media.</p><span class="s">offline HTML · logo, kolor, typografia, motion, UI, LP i social</span></a>
```

- [ ] **Step 3: Uruchomić pełny kontrakt**

Run:

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH node scripts/verify-branding-moodboard.mjs
```

Expected: `moodboard_contract=passed`.

- [ ] **Step 4: Zapisać link dokumentacyjny**

```bash
git add docs/dokumentacja/hub.html
git commit -m "docs: dodaj moodboard do centrum projektu"
```

---

### Task 5: Weryfikacja techniczna i wizualna

**Files:**
- Modify if needed: `docs/branding/2026-07-20-avably-faza-1-moodboard.html`
- Test: `scripts/verify-branding-moodboard.mjs`

**Interfaces:**
- Consumes: gotowy HTML i hub.
- Produces: potwierdzony offline artefakt bez overflow, błędów fontów i regresji repo.

- [ ] **Step 1: Sprawdzić kontrakt, whitespace i brak niezamierzonych plików**

Run:

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH node scripts/verify-branding-moodboard.mjs
git diff --check
git status --short
```

Expected: kontrakt przechodzi, `git diff --check` nie zwraca błędów, status nie zawiera plików tymczasowych ani fontów źródłowych.

- [ ] **Step 2: Sprawdzić fonty i sieć w przeglądarce**

Otworzyć plik lokalnie i uruchomić w konsoli:

```js
const fontChecks = [
  ["Safiro", "500 32px Safiro"],
  ["Manrope 400", "400 32px Manrope"],
  ["Manrope 600", "600 32px Manrope"],
  ["Manrope 700", "700 32px Manrope"],
  ["Geist Sans", "500 16px Geist Sans"],
  ["Geist Mono", "500 16px Geist Mono"],
].map(([name, query]) => [name, document.fonts.check(query)]);
const motionDurations = [...new Set(
  document.getAnimations().map((animation) => animation.effect.getTiming().duration),
)].sort((a, b) => a - b);
({
  fontChecks,
  resources: performance.getEntriesByType("resource"),
  motionDurations,
  reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
});
```

Expected: wszystkie wartości fontów to `true`, `resources` nie zawiera wpisów sieciowych, a `motionDurations` obejmuje aktywne pętle `6000`, `8000` i `16000`; krótsze transition i reveal są potwierdzone przez kontrakt źródłowy oraz interakcję.

- [ ] **Step 3: Wykonać wizualną kontrolę szerokości `1440`, `1024` i `390 px`**

Sprawdzić kolejno:

- przy `1440 px` trzy karty kierunków stoją obok siebie, a plansze użycia mają LP po lewej i social po prawej;
- przy `1024 px` karty są pionowe, zaś LP/social korzystają jeszcze z czytelnego układu bez obcięć;
- przy `390 px` wszystkie sekcje są jednokolumnowe, nie ma poziomego przewijania, treść CTA i tabeli pozostaje dostępna;
- pola `16:10`, `1:1` i `4:5` zachowują proporcje;
- logo „przed” i „po” ma identyczny rozmiar, a korekta nie zmienia krzywych liter;
- żaden kierunek nie wygląda jak wariacja tylko koloru: różnią się konstrukcją powierzchni, rytmem i ramą;
- kropka logo odpoczywa przez większość cyklu, szyna LP jest jedynym ruchem ciągłym, a reklamy pozostają nieruchome między `72%` i `92%`;
- hover i focus-within zatrzymują pętle bez przesunięcia układu.

- [ ] **Step 4: Zweryfikować statyczny stan reduced motion**

Run:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --hide-scrollbars \
  --force-prefers-reduced-motion \
  --window-size=1440,1000 \
  --screenshot=/tmp/avably-moodboard-reduced.png \
  "file:///Users/godekmaciej/.codex/worktrees/rental-platform/avably-moodboard-phase-1/docs/branding/2026-07-20-avably-faza-1-moodboard.html"
```

Expected: screenshot istnieje; wszystkie headline'y, CTA, logo i fragmenty produktu są widoczne w stanie końcowym, a żaden element nie pozostaje z `opacity: 0`, przesunięciem startowym ani maską.

- [ ] **Step 5: Uruchomić testy repo z dozwolonym pominięciem lokalnych integracji Supabase**

Run:

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH ALLOW_INTEGRATION_SKIP=1 pnpm test
```

Expected: `Tasks: 7 successful, 7 total`; integracje wymagające lokalnego Supabase są jawnie oznaczone jako pominięte.

- [ ] **Step 6: Poprawić wyłącznie wykryte problemy i ponowić pełną weryfikację**

Po każdej korekcie uruchomić kontrakt, `git diff --check` oraz ponownie obejrzeć zmieniony breakpoint. Jeżeli powstała korekta artefaktu, zapisać ją:

```bash
git add docs/branding/2026-07-20-avably-faza-1-moodboard.html scripts/verify-branding-moodboard.mjs docs/dokumentacja/hub.html
git commit -m "fix: dopracuj prezentację moodboardu Avably"
```
