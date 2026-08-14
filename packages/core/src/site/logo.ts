/**
 * LOGO NAJEMCY (ADR-160) — JEDNO ŹRÓDŁO KSZTAŁTU ZNAKU FIRMY.
 *
 * Znak jest własnością NAJEMCY, nie strony: po fazie 2 kreatora wiersze `sites`
 * są osobnymi stronami (kontakt, o nas, landingi), więc logo trzymane w stylu
 * strony znaczyłoby „inny znak na każdej podstronie". Dane siedzą w parze
 * kolumn `public.tenants.logo_draft/logo_published` (migracja 0076), a TEN plik
 * jest jedynym miejscem, które mówi, co w tej kolumnie wolno zapisać.
 *
 * Czytają stąd trzy warstwy: panel (walidacja przed zapisem), baza przez lustro
 * wzorca ścieżki w `app.set_tenant_logo` oraz sklep (parsowanie koperty
 * `app.get_published_page`).
 */
import { z } from "zod";

/**
 * Dozwolone typy pliku — te same cztery, co dla zdjęć sekcji i produktów,
 * czyli allowlista bucketa `site-images` (0043).
 *
 * SVG NIE WCHODZI i nie jest to przeoczenie: SVG to aktywny dokument
 * (skrypt, odwołania zewnętrzne) serwowany z PUBLICZNEGO bucketa pod adresem
 * sklepu. Logo w tym formacie byłoby składowanym XSS-em o zasięgu każdej
 * podstrony najemcy.
 */
export const SITE_LOGO_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
] as const;
export type SiteLogoMime = (typeof SITE_LOGO_MIME_TYPES)[number];

/**
 * SUFIT ROZMIARU: 512 KiB, przy 5 MiB bucketa.
 *
 * Logo renderuje się w pasku wysokości 36 px, więc przy DPR 3 potrzebuje 108 px
 * wysokości; przy hojnych proporcjach 8:1 to około 1150 × 144 px. Taki PNG-24
 * z przezroczystością waży 50–120 kB, WebP 20–40 kB — sufit daje 4–10× zapasu.
 * Ostrzejszy niż dla zdjęcia sekcji, bo logo jedzie na KAŻDEJ podstronie i w
 * DWÓCH miejscach dokumentu; 5 MiB byłoby megabajtami transferu na wizytę.
 *
 * Lustro w bazie: CHECK `site_image_uploads_logo_size_check` (0076).
 */
export const MAX_SITE_LOGO_BYTES = 512 * 1024;

/**
 * Ścieżka pliku w buckecie `site-images`: `{tenant}/logo/{upload}.{ext}`.
 *
 * Wzorzec jest LUSTREM wyrażenia z `app.set_tenant_logo` (0076) — z jedną
 * różnicą, której nie da się uniknąć: baza zna tenanta wołającego i wpisuje go
 * w wyrażenie, a kod nie zna i sprawdza tylko KSZTAŁT. Dlatego to nie jest
 * bramka bezpieczeństwa (tą jest baza), a bramka poprawności: literówka
 * w ścieżce ma paść przy zapisie, a nie zamienić się w pusty obrazek w sklepie.
 */
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export const SITE_LOGO_PATH_PATTERN = new RegExp(
  `^${UUID}/logo/${UUID}\\.(jpg|png|webp|avif)$`,
);

/** Tekst zastępczy — zwięzły opis znaku, nie akapit (limit jak `altText` galerii). */
const logoAlt = z.string().trim().min(1).max(120);

/**
 * Kształt wartości kolumn `tenants.logo_draft` / `logo_published`.
 *
 * `.strict()` z tego samego powodu, co przy treści sekcji: jsonb przyjąłby
 * wszystko, a literówka w nazwie pola ginęłaby bez śladu do chwili renderu.
 *
 * `alt` jest OPCJONALNY, a nie wymagany, i to jest decyzja o dostępności, nie
 * przeciwko niej: render NIGDY nie stawia pustego `alt` — bierze tekst
 * najemcy, a gdy go nie ma, nazwę sklepu (`siteLogoAlt`). Wymaganie pola
 * zamieniłoby dobrą wartość domyślną w kolejne pole do wypełnienia, a puste
 * `alt` w atrapę dostępności.
 *
 * `inFooter` z wartością domyślną `true`: znak w stopce jest normą sklepu.
 * Najemca może go tam zgasić, ale drugiego wgrania pod stopkę nie ma — jedno
 * wgranie, dwa miejsca użycia.
 */
export const siteLogoSchema = z
  .object({
    path: z
      .string()
      .trim()
      .min(1)
      .max(1_024)
      .regex(SITE_LOGO_PATH_PATTERN, "Ścieżka logo w buckecie site-images"),
    alt: logoAlt.optional(),
    inFooter: z.boolean().default(true),
  })
  .strict();

export type SiteLogo = z.infer<typeof siteLogoSchema>;

/**
 * Parsowanie wartości z kolumny/koperty. `null` znaczy „najemca nie ma znaku" —
 * i tak samo znaczy pusty obiekt oraz kształt nierozpoznany.
 *
 * Degradacja jest tu właściwą odpowiedzią (jak przy stylu): logo w kształcie
 * sprzed zmiany schematu ma zniknąć z nagłówka, a nie położyć całej strony
 * sklepu. Granica draft/publish leży o piętro niżej — w bazie — więc ta
 * miękkość niczego nie otwiera.
 */
export function parseSiteLogo(value: unknown): SiteLogo | null {
  if (value === null || value === undefined) return null;
  const parsed = siteLogoSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Tekst zastępczy do atrybutu `alt`. Logo bez `alt` jest błędem dostępności na
 * KAŻDEJ podstronie sklepu, więc pustego wyniku ta funkcja nie zwraca nigdy.
 */
export function siteLogoAlt(logo: SiteLogo, storeName: string): string {
  const fallback = storeName.trim();
  return logo.alt ?? (fallback.length > 0 ? fallback : "Logo");
}

/**
 * ZNAK NAJEMCY W KORESPONDENCJI WYCHODZĄCEJ (ADR-175) — e-mail i umowa PDF.
 *
 * Trzy stany, nazwane z imienia, bo drugi i trzeci znaczą co innego:
 *   • `logo`  — najemca ma opublikowany znak; render pokazuje obraz,
 *   • `name`  — najemcy znaku brak; render pokazuje NAZWĘ TEKSTEM.
 *
 * Pustego stanu nie ma i nie może być: pusta ramka w umowie wygląda jak
 * dokument zepsuty, a nasz znak w miejscu cudzego podmienia właściciela
 * relacji z klientem. To ten sam trzeci stan, który silnik wiązań kreatora
 * nazywa `fallback` — brak danych ma powiedzieć „tego nie podano", a nie
 * udawać treść.
 */
export type OutgoingTenantMark =
  | { kind: "logo"; path: string; alt: string }
  | { kind: "name"; name: string };

/**
 * Znak dla wiadomości i dokumentu — WYŁĄCZNIE ze stanu OPUBLIKOWANEGO.
 *
 * Argument to wartość kolumny `tenants.logo_published` NAJEMCY, KTÓREGO
 * DOTYCZY dokument — nie kontekst sesji, nie nagłówek żądania, nie zmienna
 * globalna. Umowy i przypomnienia powstają też w zadaniach w tle, gdzie
 * „bieżący najemca" nie znaczy nic, a znak najemcy A w mailu najemcy B jest
 * wyciekiem widocznym gołym okiem.
 *
 * Szkic (`logo_draft`) tu NIE WCHODZI i nie jest to przeoczenie: mail i umowa
 * wychodzą na zewnątrz, więc wysłanie szkicu byłoby publikacją, której
 * operator nie zamawiał — ta sama zasada, która trzyma `slug_published`
 * i `style_published`.
 *
 * Kształt nierozpoznany degraduje do nazwy, bo `parseSiteLogo` odpowiada
 * `null` na wszystko, co nie przeszło `siteLogoSchema` — a to znaczy, że
 * ścieżka SVG (poza allowlistą wzorca) nie ma jak dojechać do renderu ani
 * mailem, ani dokumentem. Reguła z nagłówka tego pliku obowiązuje wszędzie.
 */
export function outgoingTenantMark(
  publishedLogo: unknown,
  tenantName: string,
): OutgoingTenantMark {
  const logo = parseSiteLogo(publishedLogo);
  if (!logo) return { kind: "name", name: tenantName };
  return { kind: "logo", path: logo.path, alt: siteLogoAlt(logo, tenantName) };
}
