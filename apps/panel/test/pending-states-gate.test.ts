import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * BRAMKA STANÓW OCZEKIWANIA MUTACJI (uwaga właściciela, runda 2026-07-28).
 *
 * ================== CO PALI TĘ BRAMKĘ ==================
 *
 * Właściciel: „Nie mamy stanu oczekiwania na odpowiedź / ładowania. Interfejs
 * się zamraża, a użytkownik nie wie, że coś się dzieje." Przycisk akcji, który
 * po kliknięciu tylko szarzeje (`disabled={pending}`), nie mówi operatorowi, że
 * żądanie trwa — brak `aria-busy`, brak sygnału dla czytnika ekranu, brak
 * kursora progresu. Ta bramka wymusza, by KAŻDY przycisk WYSYŁAJĄCY akcję niósł
 * maszynowy sygnał zajętości.
 *
 * Sygnał maszynowy = `aria-busy` (nie obecność wielokropka „…”): `Button` z
 * `@avably/ui` ustawia `aria-busy` z propa `loading`, a dla `asChild` renderuje
 * je na slotowanym dziecku BEZ wielokropka — więc bramka pilnuje `loading=`
 * (Button) lub `aria-busy` (natywny `<button>` / adapter), nigdy „…”.
 *
 * ================== ZAKRES (dlaczego akurat te przyciski) ==================
 *
 * Sygnał zajętości ma sens TYLKO tam, gdzie istnieje kliencka flaga oczekiwania
 * do odbicia: `useActionState`/`useTransition`. Ekrany serwerowe (superadmin,
 * formularze filtrów GET) nie mają klienckiego `pending` — ich „ładowanie” to
 * nawigacja RSC z osobnymi szkieletami (`loading.tsx`, gałąź szkieletów), poza
 * tym zadaniem. Dlatego zakres bramki = pliki z HOOKIEM klienckim, i tylko one.
 *
 * PRZYCISKI CANCEL/CLOSE (`type="button"` zamykające dialog, `DialogClose`) mają
 * `disabled={pending}`, żeby nie zamknąć okna w trakcie akcji — ale SAME akcji
 * nie wysyłają, więc NIE dostają `loading` (napis „Anuluj …” kłamałby). Bramka
 * celuje w `type="submit"` (zawsze wysyła akcję formularza) plus jawny rejestr
 * przycisków-nie-submit, które akcję inicjują (`onClick` odpalający tranzycję).
 *
 * ================== JAK BRAMKA POTRAFI SPŁONĄĆ ==================
 *
 * Część A (statyczna, główne zęby): w każdym pliku z hookiem klienckim każdy
 * `<Button type="submit">` musi mieć `loading=`, a każdy natywny
 * `<button type="submit">` — `aria-busy`. NOWY formularz z gołym submitem bez
 * okablowania → czerwone (dowód mutacyjny w raporcie: atrapa formularza).
 *
 * Część B (rejestr): przyciski akcji NIE-submit (kreator strony, wyszukiwarka
 * przesyłki) i adapter selecta statusu — detekcja submit-vs-cancel dla
 * `type="button"` jest statycznie krucha, więc te przypadki stoją na JAWNYM
 * rejestrze z kotwicą; zdjęcie sygnału z któregokolwiek → czerwone. Rejestr jest
 * uzgadniany ze źródłem (martwa kotwica → czerwone), więc nie da się go zostawić
 * jako listy życzeń.
 */

const APP_ROOT = join(__dirname, "..", "app");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/**
 * Wyciąga znaczniki otwierające `<Tag …>` z pełną świadomością nawiasów: `>`
 * kończy znacznik tylko na głębokości `{}`=0 i poza cudzysłowem. Bez tego
 * `onClick={() => x}` ucinałby znacznik na strzałce i bramka czytałaby atrapy.
 */
function openingTags(src: string, tag: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  const needle = `<${tag}`;
  for (let i = 0; i < src.length; ) {
    const start = src.indexOf(needle, i);
    if (start === -1) break;
    // Kolejny znak musi kończyć nazwę znacznika (spacja/>/nowa linia), by
    // `<button` nie łapało `<buttonish`.
    const after = src[start + needle.length];
    if (after && /[A-Za-z0-9]/.test(after)) {
      i = start + needle.length;
      continue;
    }
    let depth = 0;
    let quote: string | null = null;
    let end = -1;
    for (let j = start + 1; j < src.length; j++) {
      const c = src[j];
      if (quote) {
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) {
        end = j;
        break;
      }
    }
    if (end === -1) break;
    const text = src.slice(start, end + 1);
    out.push({ text, line: src.slice(0, start).split("\n").length + 1 });
    i = end + 1;
  }
  return out;
}

const HOOK_RE = /useActionState|useTransition/;
const rel = (p: string) => relative(join(__dirname, ".."), p);

const hookedFiles = walk(APP_ROOT).filter((f) => HOOK_RE.test(readFileSync(f, "utf8")));

/**
 * Formularze submit w pliku z hookiem, które WOLNO trzymać bez sygnału (np.
 * submit GET obok akcji klienckiej). Dziś PUSTY — wszystkie submity w plikach
 * hookowych są mutacjami. Każdy wpis musi rozwiązywać się do realnego znacznika
 * (uzgodnienie niżej), więc nie da się nim uciszyć prawdziwej luki.
 */
const SUBMIT_SIGNAL_ALLOWLIST: { file: string; contains: string }[] = [];

describe("Część A — każdy submit w pliku z hookiem niesie sygnał zajętości", () => {
  it("znaleziono pliki z hookiem klienckim (kontrola pozytywna — inaczej bramka nic nie mierzy)", () => {
    expect(hookedFiles.length).toBeGreaterThan(10);
  });

  const gaps: string[] = [];
  for (const file of hookedFiles) {
    const src = readFileSync(file, "utf8");
    const r = rel(file);
    const allow = SUBMIT_SIGNAL_ALLOWLIST.filter((a) => r.endsWith(a.file));
    for (const t of [...openingTags(src, "Button"), ...openingTags(src, "button")]) {
      if (!/type="submit"/.test(t.text)) continue;
      if (allow.some((a) => t.text.includes(a.contains))) continue;
      const isComponent = t.text.startsWith("<Button");
      const hasSignal = isComponent
        ? /\bloading=/.test(t.text)
        : /aria-busy/.test(t.text);
      if (!hasSignal) {
        gaps.push(
          `${r}:${t.line}  ${t.text.replace(/\s+/g, " ").slice(0, 80)}`,
        );
      }
    }
  }

  it("żaden przycisk submit nie jest goły (bez loading / aria-busy)", () => {
    expect(gaps, `Przyciski submit bez sygnału zajętości:\n${gaps.join("\n")}`).toEqual(
      [],
    );
  });

  it("allowlista nie ma martwych wpisów (każdy rozwiązuje się do submitu)", () => {
    for (const a of SUBMIT_SIGNAL_ALLOWLIST) {
      const file = hookedFiles.find((f) => rel(f).endsWith(a.file));
      expect(file, `Allowlist: brak pliku ${a.file}`).toBeTypeOf("string");
      const submits = openingTags(readFileSync(file!, "utf8"), "Button")
        .concat(openingTags(readFileSync(file!, "utf8"), "button"))
        .filter((t) => /type="submit"/.test(t.text) && t.text.includes(a.contains));
      expect(
        submits.length,
        `Allowlist: kotwica "${a.contains}" nie trafia w submit w ${a.file}`,
      ).toBeGreaterThan(0);
    }
  });
});

/**
 * Część B — przyciski akcji NIE przez `type="submit"` (onClick odpalający
 * tranzycję) oraz adapter selecta statusu. Każdy wpis: plik + kotwica
 * jednoznacznie wskazująca kontrolkę + wymagany sygnał w oknie po kotwicy.
 * Kotwica musi istnieć (martwa → czerwone), a sygnał musi w jej pobliżu paść.
 */
const NON_SUBMIT_ACTION_REGISTRY: {
  file: string;
  anchor: string;
  signal: RegExp;
  note: string;
}[] = [
  {
    file: "strona/site-pages.tsx",
    anchor: "run(() => publishSite(row.id))",
    signal: /disabled=\{pending\}/,
    note: "publikacja z listy stron (wspólna tranzycja ekranu)",
  },
  {
    file: "kreator/site-builder.tsx",
    anchor: 'run(() => publishSite(siteId), undefined, { blocking: true, announce: "published" })',
    signal: /loading=\{pending\}/,
    // Od pinezki właściciela 2026-08-03 publikacja jest JEDYNĄ operacją
    // kreatora, która blokuje — stąd jawne `blocking: true` w kotwicy. Od L6
    // idzie przez potwierdzenie (PublishDialog) i melduje sukces osobnym
    // stanem `published` — sygnał pending został na triggerze dialogu.
    note: "publikacja z paska kreatora (jedyna tranzycja blokująca)",
  },
  {
    file: "kreator/site-builder.tsx",
    anchor: "<BuilderPalette",
    signal: /disabled=\{pending\}/,
    note: "paleta (dodanie sekcji, zapis szablonu) — zajętość skorupy schodzi propem",
  },
  {
    file: "kreator/site-builder.tsx",
    anchor: "<BuilderCanvas",
    signal: /busy=\{pending\}/,
    note: "płótno (pasek sekcji, „+”, uchwyty) — zajętość skorupy schodzi propem",
  },
  {
    file: "kreator/builder-canvas.tsx",
    anchor: "function ToolbarButton(",
    signal: /loading\?/,
    note: "akcje paska sekcji (kolejność/włączenie/duplikat/ustawienia) — loading przez ToolbarButton",
  },
  {
    file: "kreator/builder-canvas.tsx",
    anchor: "data-insert-at={index}",
    signal: /loading=\{disabled\}/,
    note: "„+ Dodaj sekcję” między sekcjami — trigger galerii niesie loading",
  },
  {
    file: "kreator/builder-canvas.tsx",
    anchor: "function ElementActions(",
    signal: /locked: boolean/,
    note: "akcje elementu płótna (warstwa/kopia/usunięcie) — zajętość schodzi propem `locked`",
  },
  {
    file: "zamowienia/[id]/shipment-modal.tsx",
    anchor: "onClick={runSearch}",
    signal: /loading=\{isSearching\}/,
    note: "wyszukiwarka usług przewoźnika (własna flaga isSearching)",
  },
  {
    file: "zamowienia/[id]/status-select.tsx",
    // Kotwica po U3: select pokazuje wartość bieżącą (bez placeholdera),
    // sygnał zajętości bez zmian — aria-busy na triggerze.
    anchor: "onValueChange={applyStatus}",
    signal: /busy=\{pending\}/,
    note: "zmiana statusu przez PanelSelect — aria-busy na triggerze",
  },
];

describe("Część B — przyciski akcji nie-submit i select statusu niosą sygnał", () => {
  it.each(NON_SUBMIT_ACTION_REGISTRY)(
    "$file :: $note",
    ({ file, anchor, signal }) => {
      const full = hookedFiles.find((f) => rel(f).endsWith(file));
      expect(full, `Rejestr: brak pliku ${file}`).toBeTypeOf("string");
      const src = readFileSync(full!, "utf8");
      const at = src.indexOf(anchor);
      expect(at, `Rejestr: martwa kotwica "${anchor}" w ${file}`).toBeGreaterThan(
        -1,
      );
      // Okno wokół kotwicy — z zapasem do przodu, bo sygnał (prop/atrybut) bywa
      // kilka linii za kotwicą (np. `loading?` w sygnaturze RowButton).
      const window = src.slice(Math.max(0, at - 120), at + 440);
      expect(
        signal.test(window),
        `Rejestr: brak sygnału ${signal} przy kotwicy "${anchor}" w ${file}`,
      ).toBe(true);
    },
  );
});
