/**
 * UNIEWAŻNIANIE CACHE KATALOGU W SKLEPIE — strona PANELU (faza 4a, ADR-185).
 *
 * ==================== CO TU JEST NAPRAWDĘ BADANE ====================
 *
 * Kontrakt między DWIEMA aplikacjami: sklep zapisuje kopertę katalogu pod
 * kluczem `publicCatalogCacheKey(tenantId)`, panel spod TEGO SAMEGO klucza ją
 * kasuje. Rozjazd byłby cichy w najgorszy możliwy sposób — panel raportowałby
 * „zapisano", kasując klucz, którego nikt nie zapisuje, a klient najemcy
 * widziałby starą cenę aż do wygaśnięcia TTL. Dlatego klucz nie jest tu
 * przepisany literałem: bierzemy go z rdzenia, czyli z tego samego miejsca,
 * z którego bierze go sklep.
 *
 * ==================== CZEGO TEN PLIK NIE DOWODZI ====================
 *
 * Ostatni przypadek jest BRAMKĄ POKRYCIA, nie dowodem zachowania: czyta źródła
 * akcji katalogu i pyta, czy każda z nich w ogóle woła unieważnienie. Łapie
 * usunięcie wywołania i nową akcję dopisaną bez niego — ale nie złapie
 * wywołania postawionego po `return` albo w martwej gałęzi. Dowodem
 * ZACHOWANIA są przypadki wyżej (kasowanie trafia w ten klucz) oraz suita
 * `catalog-cache.test.ts` w sklepie (po unieważnieniu katalog jedzie z bazy).
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { publicCatalogCacheKey } from "@avably/core/site";

const NAJEMCA = "aaaaaaaa-1111-4111-8111-111111111111";
const INNY_NAJEMCA = "bbbbbbbb-2222-4222-8222-222222222222";

/** Skasowane klucze — to jest cały skutek, o który pytamy. */
const skasowane: string[] = [];
const bledy: unknown[] = [];

vi.mock("@upstash/redis", () => ({
  Redis: class {
    async del(key: string) {
      // Klucz przychodzi już zbudowany przez `publicCatalogCacheKey`, więc
      // dopasowujemy fragment, a nie całość — inaczej gałąź błędu nigdy by się
      // nie odpaliła i przypadek byłby zielony po pustym zbiorze.
      if (key.includes("wybuchowy")) throw new Error("sieć padła");
      skasowane.push(key);
      return 1;
    }
  },
}));

describe("unieważnianie cache katalogu w sklepie (ADR-185)", () => {
  beforeEach(async () => {
    skasowane.length = 0;
    bledy.length = 0;
    vi.resetModules();
    process.env.UPSTASH_REDIS_REST_URL = "https://magazyn.test";
    process.env.UPSTASH_REDIS_REST_TOKEN = "token-testowy";
  });

  afterEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    vi.restoreAllMocks();
  });

  it("kasuje DOKŁADNIE ten klucz, pod którym sklep trzyma katalog", async () => {
    const { invalidateStorefrontCatalog } = await import("@/lib/catalog-cache");
    await invalidateStorefrontCatalog(NAJEMCA);

    expect(skasowane, "panel nie skasował niczego").toEqual([publicCatalogCacheKey(NAJEMCA)]);
    // Druga połowa tej samej asercji: klucz NIESIE najemcę. Bez niej test
    // przeszedłby też dla klucza wspólnego dla wszystkich, czyli dla wersji,
    // w której panel jednego najemcy zrzuca cache całej platformie.
    expect(skasowane[0]).toContain(NAJEMCA);
    expect(publicCatalogCacheKey(NAJEMCA)).not.toBe(publicCatalogCacheKey(INNY_NAJEMCA));
  });

  it("bez skonfigurowanego magazynu NIE pisze do konsoli poza produkcją", async () => {
    // Droga szczęśliwa panelu ma być cicha — inaczej zespół uczy się przewijać
    // błędy. Brak magazynu w dev/CI jest stanem normalnym, nie usterką.
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { invalidateStorefrontCatalog } = await import("@/lib/catalog-cache");
    await invalidateStorefrontCatalog(NAJEMCA);

    expect(spy).not.toHaveBeenCalled();
    expect(skasowane).toEqual([]);
  });

  it("NA PRODUKCJI brak magazynu jest błędem wdrożenia i idzie do logu", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    vi.stubEnv("NODE_ENV", "production");
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { invalidateStorefrontCatalog } = await import("@/lib/catalog-cache");
    await invalidateStorefrontCatalog(NAJEMCA);

    expect(spy, "cicha nieskuteczność unieważniania na produkcji").toHaveBeenCalledTimes(1);
    vi.unstubAllEnvs();
  });

  it("błąd magazynu NIE przewraca akcji panelu", async () => {
    // Dane są już w bazie. Rzut stąd zamieniłby udany zapis w komunikat
    // o porażce, a operator zapisałby to samo drugi raz.
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { invalidateStorefrontCatalog } = await import("@/lib/catalog-cache");

    await expect(invalidateStorefrontCatalog("wybuchowy")).resolves.toBeUndefined();
    expect(spy, "błąd sieci przy kasowaniu przeszedł bez śladu").toHaveBeenCalled();
  });

  // -------------------------------------------------------------------
  // BRAMKA POKRYCIA — patrz nagłówek pliku (to nie jest dowód zachowania)
  // -------------------------------------------------------------------
  it("każda AKCJA zmieniająca katalog publiczny woła unieważnienie", () => {
    const katalog = path.resolve(__dirname, "../app/[locale]/(panel)/katalog");

    /**
     * BRAMKA PATRZY NA AKCJĘ, NIE NA PLIK — i to nie jest szczegół.
     *
     * Pierwsza wersja tego przypadku pytała, czy PLIK zawiera wywołanie.
     * Mutacja zdejmująca unieważnienie z `updateProductAction` przeszła przez
     * nią na zielono, bo `createProductAction` w tym samym pliku dalej je
     * miało. Bramka pilnowała więc obecności napisu, a nie pokrycia akcji —
     * czyli dokładnie tej klasy fałszywej zieleni, przed którą ostrzega
     * doświadczenie z kontraktami źródła.
     */
    const wymagane: Record<string, string[]> = {
      "actions.ts": ["createProductAction", "updateProductAction"],
      "[id]/progi/actions.ts": ["saveTiersAction"],
      "[id]/zdjecia/actions.ts": ["updateImageAction"],
      "[id]/zdjecia/upload-actions.ts": ["finalizeProductImageUploadAction"],
      "kategorie/actions.ts": [
        "createCategoryAction",
        "updateCategoryAction",
        "deleteCategoryAction",
        "moveCategoryAction",
      ],
      "import/actions.ts": ["catalogImportAction"],
    };

    /**
     * Ciało akcji = od jej nagłówka do następnego `export` w pierwszej
     * kolumnie. Prymitywne, ale wystarczające: akcje w tym katalogu są
     * funkcjami najwyższego poziomu i żadna nie zagnieżdża w sobie drugiego
     * eksportu.
     */
    function cialoAkcji(src: string, nazwa: string): string {
      const start = src.indexOf(`export async function ${nazwa}(`);
      expect(start, `nie znalazłem akcji ${nazwa} — lista bramki zardzewiała`).toBeGreaterThan(-1);
      const dalej = src.indexOf("\nexport ", start + 1);
      return src.slice(start, dalej === -1 ? undefined : dalej);
    }

    for (const [rel, akcje] of Object.entries(wymagane)) {
      const src = readFileSync(path.join(katalog, rel), "utf8");
      for (const akcja of akcje) {
        expect(
          cialoAkcji(src, akcja),
          `${rel} → ${akcja}: zmienia katalog publiczny i NIE unieważnia cache sklepu`,
        ).toContain("invalidateStorefrontCatalog(");
      }
    }

    // KONTROLA CZUJNIKA: lista nie może zardzewieć po cichu. Gdyby w katalogu
    // pojawiła się nowa akcja, ten przypadek ma o tym powiedzieć — inaczej
    // bramka pilnowałaby zbioru sprzed pół roku.
    //
    // Poza zbiorem świadomie:
    //   • `saveUnitsAction` — zmienia DOSTĘPNOŚĆ, a dostępność nie przechodzi
    //     przez cache i nie ma prawa przejść (ADR-185);
    //   • `prepareProductImageUploadAction` — wydaje bilet uploadu, nie dotyka
    //     ani jednego wiersza koperty publicznej.
    const POZA_ZBIOREM = ["saveUnitsAction", "prepareProductImageUploadAction"];
    const znalezione: string[] = [];
    const obejdz = (dir: string) => {
      for (const wpis of readdirSync(dir, { withFileTypes: true })) {
        const pelna = path.join(dir, wpis.name);
        if (wpis.isDirectory()) obejdz(pelna);
        else if (/actions\.ts$/.test(wpis.name)) {
          for (const m of readFileSync(pelna, "utf8").matchAll(
            /^export async function (\w+)\(/gm,
          )) {
            znalezione.push(m[1]!);
          }
        }
      }
    };
    obejdz(katalog);
    expect(
      znalezione.sort(),
      "doszła nowa akcja katalogu — rozstrzygnij, czy zmienia kopertę publiczną",
    ).toEqual([...Object.values(wymagane).flat(), ...POZA_ZBIOREM].sort());
  });
});
