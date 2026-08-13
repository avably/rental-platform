/**
 * PODGLĄD SZKICU — TRASA PANELU, NIE FURTKA W SKLEPIE (pinezka właściciela).
 *
 * Podgląd pokazuje stan, którego klient JESZCZE nie widzi. To czyni go
 * najbardziej kuszącym miejscem na skrót: „dodajmy sklepowi parametr
 * `?draft=1`". Ten plik pilnuje, żeby skrótu nie było — i pilnuje tego od
 * strony, z której skrót jest widoczny, czyli w ŹRÓDŁACH obu produktów.
 *
 * Trzy zdania, których nie widać w samym pliku trasy:
 *
 *   1. podgląd stoi za bramką sesji panelu i czyta szkic tą samą drogą, co
 *      kreator (RLS, 0019) — nie ma własnego zapytania do bazy;
 *   2. sklep publiczny NIE ZYSKUJE żadnej ścieżki do kolumn szkicu: jego
 *      źródła nie znają ani `content_draft`, ani `style_draft`;
 *   3. podgląd odsiewa to, czego klient nie zobaczy (sekcje wyłączone
 *      i usunięte w szkicu) — inaczej „podgląd" pokazywałby coś innego niż
 *      publikacja, czyli kłamałby dokładnie w tym, po co powstał.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const panelRoot = process.cwd();
const repositoryRoot = resolve(panelRoot, "../..");
const read = (path: string) => readFileSync(resolve(repositoryRoot, path), "utf8");

const TRASA = "apps/panel/app/[locale]/(kreator)/strona/[siteId]/podglad/page.tsx";
const PASEK = "apps/panel/app/[locale]/(kreator)/strona/[siteId]/kreator/site-builder.tsx";

/** Źródła sklepu, które dotykają danych strony najemcy. */
const ZRODLA_SKLEPU = [
  "apps/storefront/lib/site/published.ts",
  "apps/storefront/lib/storefront/context.ts",
  "apps/storefront/app/(tenant)/store/page.tsx",
  "apps/storefront/proxy.ts",
];

describe("podgląd szkicu: bramka i źródło danych", () => {
  const trasa = read(TRASA);

  it("trasa istnieje i jest dynamiczna — inaczej CSP panelu zabiłaby jej skrypty", () => {
    expect(trasa.length, "pusty plik trasy — kontrola po pustym zbiorze").toBeGreaterThan(500);
    expect(trasa).toContain('export const dynamic = "force-dynamic"');
  });

  it("wejście przechodzi przez bramkę członka, a dane przez ten sam odczyt co kreator", () => {
    expect(trasa).toContain("requireMemberPage");
    expect(trasa).toContain("getSiteWithSections");
    // Żadnego własnego klienta bazy ani RPC — podgląd nie ma prawa mieć
    // drugiej drogi do danych, bo wtedy miałby też własne błędy izolacji.
    expect(trasa).not.toMatch(/createClient|\.rpc\(/);
  });

  it("podgląd renderuje TYM SAMYM rendererem, co sklep i płótno", () => {
    expect(trasa).toContain('from "@avably/ui"');
    expect(trasa).toContain("<SiteRenderer");
  });

  it("odsiewa dokładnie to, czego klient nie zobaczy po publikacji", () => {
    expect(trasa).toMatch(/section\.enabled && !section\.deletedInDraft/);
  });

  it("styl bierze ze SZKICU, nie z kolumny opublikowanej", () => {
    /*
     * Od ADR-161 wygląd jest własnością NAJEMCY, więc trasa nie czyta już
     * kolumny strony, tylko pyta o niego jedną funkcję. Bramka schodzi zatem
     * piętro niżej — do tej funkcji — bo asercja po samej nazwie wywołania
     * byłaby zielona także wtedy, gdyby ta funkcja czytała stan opublikowany.
     */
    expect(trasa).toContain("getTenantDraftStyle(ctx.supabase");
    expect(trasa, "podgląd sięgnął po stan opublikowany").not.toContain("style_published");

    const zrodlo = read("apps/panel/lib/tenant-appearance.ts");
    expect(zrodlo.length, "pusty moduł wyglądu — kontrola po pustym zbiorze").toBeGreaterThan(200);
    expect(zrodlo).toContain("style_draft");
    expect(zrodlo, "wspólny odczyt wyglądu sięga po stan opublikowany").not.toContain(
      "style_published",
    );
  });

  it("kotwice sekcji ma włączone tak samo, jak sklep", () => {
    /*
     * Podgląd odpowiada na pytanie „co zobaczy klient po publikacji", a klient
     * dostaje stronę, na której przycisk hero prowadzi na `#produkty`. Bez tej
     * flagi podgląd pokazywałby stronę z martwymi przyciskami, czyli kłamałby
     * dokładnie w tym, po co powstał.
     *
     * Flagi nie ma za to na płótnie ani w galerii szablonów: tam ten sam render
     * stoi w jednym dokumencie po kilka razy naraz, więc kotwice byłyby
     * duplikatem identyfikatorów (bramka i jej kontrakt: packages/ui).
     */
    expect(trasa, "podgląd renderuje stronę BEZ kotwic sekcji").toMatch(/^\s*anchors$/m);
  });
});

describe("podgląd szkicu: sklep publiczny nie zyskuje ani jednej furtki", () => {
  it("źródła sklepu nie znają kolumn SZKICU", () => {
    const winne: string[] = [];
    for (const plik of ZRODLA_SKLEPU) {
      const zrodlo = read(plik);
      expect(zrodlo.length, `${plik} pusty — kontrola po pustym zbiorze`).toBeGreaterThan(200);
      for (const kolumna of ["content_draft", "style_draft", "deleted_in_draft"]) {
        if (zrodlo.includes(kolumna)) winne.push(`${plik}: ${kolumna}`);
      }
    }
    expect(winne, `sklep sięgnął po kolumnę szkicu:\n${winne.join("\n")}`).toEqual([]);
  });

  it("sklep nie zna adresu podglądu — podgląd jest wyłącznie w panelu", () => {
    for (const plik of ZRODLA_SKLEPU) {
      expect(read(plik), `${plik} zna adres podglądu`).not.toContain("strona/podglad");
    }
  });
});

describe("podgląd szkicu: wejście z paska kreatora", () => {
  const pasek = read(PASEK);

  it("otwiera się w NOWEJ karcie i bez dostępu do okna kreatora", () => {
    const przycisk = /<a[\s\S]{0,400}?data-builder-preview[\s\S]{0,400}?>/.exec(pasek);
    expect(przycisk, "brak przycisku podglądu w pasku").not.toBeNull();
    expect(przycisk![0]).toContain('target="_blank"');
    expect(przycisk![0], "nowa karta z dostępem do window.opener").toContain('rel="noreferrer"');
  });

  it("adres podglądu niesie język I wersję strony — panel jest dwujęzyczny, a stron jest wiele", () => {
    // KOTWICA PRZENIESIONA (0048, ADR-093): do języka dołączył segment wersji.
    // Asercja została WZMOCNIONA, nie osłabiona — pilnuje teraz obu członów.
    expect(pasek).toContain("/strona/");
    expect(pasek).toContain("/podglad");
    expect(pasek).toMatch(/\$\{locale\}\/strona\/\$\{siteId\}\/podglad/);
  });
});
