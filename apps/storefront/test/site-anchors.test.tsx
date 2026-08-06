/**
 * KOTWICE SEKCJI DOCIERAJĄ DO PUBLICZNEGO RENDERU.
 *
 * ==================== DLACZEGO KONTRAKT STOI PO STRONIE SKLEPU ====================
 *
 * Mechanizm kotwic mieszka w pakietach (`SECTION_ANCHORS` w @avably/core/site,
 * `anchors` w rendererze) i ma tam własne testy. Ten plik pilnuje ostatniego
 * ogniwa, którego tamte nie widzą: czy TRASA SKLEPU tę flagę w ogóle podaje.
 * Bez niej cały tor jest sprawny i całkowicie bezużyteczny — przycisk „Zobacz
 * katalog" nie robi na opublikowanej stronie nic, dokładnie tak jak przed
 * wprowadzeniem kotwic, i nie zapala przy tym ani jednego testu w pakietach.
 *
 * Awaria jest cicha także dla operatora: w kreatorze kliknięcia przechwytuje
 * warstwa edycyjna, więc „sprawdziłem, działa" nie dotyczy tej ścieżki.
 *
 * ==================== I DRUGA POŁOWA: ODSTĘP LICZONY RAZ ====================
 *
 * Odstęp celu skoku niesie sekcja (`scroll-margin-top` w @avably/ui/site.css).
 * Gdyby oś tenancka dołożyła do tego własny `scroll-padding-top` na dokumencie,
 * obie wartości by się ZSUMOWAŁY — a to jest wada, której nie widać w żadnym
 * teście renderu i której nie widać na zrzucie: strona po prostu zatrzymuje się
 * kawałek za wysoko. Dokładnie tak było przed tym zadaniem (5,5 rem zastane po
 * landingu sprzed ADR-068), więc noga niżej pilnuje, żeby liczba nie wróciła.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { SECTION_ANCHORS, presetContentFor } from "@avably/core/site";
import { SiteRenderer, type RenderSection } from "@avably/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const TRASA_SKLEPU = "app/(tenant)/store/page.tsx";
const ARKUSZ_OSI = "app/globals.css";

/** Sekcja z presetu — treść startowa jest tą, która niesie adresy kotwic. */
const sekcja = (id: string, type: "hero" | "products" | "contact" | "footer"): RenderSection =>
  ({ id, position: 0, type, content: presetContentFor(type, "pl") }) as RenderSection;

describe("trasa sklepu włącza kotwice", () => {
  const trasa = read(TRASA_SKLEPU);

  it("plik trasy jest na miejscu i renderuje stronę (kontrola po pustym zbiorze)", () => {
    expect(trasa.length).toBeGreaterThan(500);
    expect(trasa).toContain("<SiteRenderer");
  });

  it("wywołanie renderera niesie flagę kotwic", () => {
    /*
     * Czytamy WYWOŁANIE bez komentarzy — tak samo, jak robi to kontrakt trybu
     * ruchu w panelu. Uzasadnienie decyzji stoi w prozie obok flagi, więc skan
     * po całym pliku spełniłby to zdanie także wtedy, gdyby z kodu flaga
     * zniknęła, a został po niej sam akapit.
     */
    const kod = trasa.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|\s)\/\/[^\n]*/g, "$1");
    const wywolania = kod.match(/<SiteRenderer[\s\S]*?\/>/g) ?? [];
    expect(wywolania, "nie znaleziono domkniętego wywołania renderera").toHaveLength(1);
    expect(wywolania[0], "sklep renderuje stronę BEZ kotwic sekcji").toMatch(/\banchors\b/);
  });
});

describe("publiczny render: adres z treści trafia w sekcję", () => {
  /** Strona tak, jak składa ją szablon: hero → sprzęt → kontakt → stopka. */
  const sections = [
    sekcja("s-hero", "hero"),
    sekcja("s-products", "products"),
    sekcja("s-contact", "contact"),
    sekcja("s-footer", "footer"),
  ];
  const html = renderToStaticMarkup(<SiteRenderer sections={sections} anchors />);

  it("render naprawdę powstał i niesie odnośniki kotwicowe", () => {
    expect(html.length).toBeGreaterThan(200);
    expect(html, "treść startowa przestała kierować na katalog").toContain('href="#produkty"');
  });

  it("KAŻDY adres `#…` ma w tym samym dokumencie swój `id`", () => {
    const cele = [...new Set([...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]!))];
    expect(cele.length, "w renderze nie ma ani jednego odnośnika kotwicowego").toBeGreaterThan(0);

    const martwe = cele.filter((cel) => !html.includes(`id="${cel}"`));
    expect(martwe, `adres bez celu na opublikowanej stronie: ${martwe.join(", ")}`).toEqual([]);
  });

  it("kotwice pochodzą z rejestru, a nie z identyfikatorów wierszy", () => {
    // Gdyby render wystawiał `id={section.id}`, kotwice byłyby poprawne
    // i nie do wpisania w przycisk — a adresy z treści dalej prowadziłyby
    // donikąd. Rozróżnienie jest niewidoczne w samym „ma id".
    expect(html).toContain(`id="${SECTION_ANCHORS.products}"`);
    // Wzorzec z białym znakiem przed `id`, a nie sam napis: `data-section-id`
    // ma tę nazwę w środku, więc porównanie po podciągu byłoby czerwone zawsze
    // i broniłoby czegoś innego, niż mówi jego opis.
    expect(html, "identyfikator wiersza wyciekł jako kotwica dokumentu").not.toMatch(
      /\sid="s-products"/,
    );
  });
});

describe("odstęp celu skoku liczy się RAZ", () => {
  it("arkusz osi tenanckiej nie dokłada własnego odstępu do okna", () => {
    const arkusz = read(ARKUSZ_OSI);
    expect(arkusz.length, "pusty arkusz osi — kontrola po pustym zbiorze").toBeGreaterThan(500);
    // Płynne przewijanie zostaje: skok kotwicą ma być widoczny jako ruch.
    expect(arkusz).toContain("scroll-behavior: smooth");
    expect(
      arkusz.replace(/\/\*[\s\S]*?\*\//g, " "),
      "oś tenancka dokłada scroll-padding-top — zsumuje się z odstępem przy kotwicy sekcji",
    ).not.toContain("scroll-padding-top");
  });
});
