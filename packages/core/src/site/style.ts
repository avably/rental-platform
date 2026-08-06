/**
 * STYL STRONY — WYBÓR OPERATORA NA TLE MOTYWU (K5, ADR-090).
 *
 * Motyw (`./theme`) rozstrzyga o wyglądzie strony: palecie pasów, krojach,
 * promieniach i charakterze typografii. Styl to trzy pola, którymi operator
 * ten motyw PERSONALIZUJE — i nic poza nimi:
 *
 *   • `theme`    — który świat wizualny (wybrany razem z szablonem startowym),
 *   • `accent`   — który akcent Z PALETY TEGO MOTYWU,
 *   • `fontPair` — ewentualna podmiana pary krojów na inną z rejestru.
 *
 * ================== DLACZEGO ZBIÓR JEST ZAMKNIĘTY ==================
 *
 * Dowolny hex jest nie do obronienia w teście: nie da się udowodnić, że KAŻDY
 * wybór operatora daje czytelną stronę, bo wyborów jest 16 milionów. Paleta
 * należąca do motywu zamienia obietnicę „pilnujemy kontrastu" w zdanie, które
 * da się sprawdzić maszynowo dla wszystkich kombinacji naraz — i dokładnie to
 * robi `contrast-contract.test.ts`, chodząc po REJESTRZE MOTYWÓW, a nie po
 * liście przypadków spisanej obok testu (lekcja z PR #83).
 *
 * ================== DWIE WARSTWY ZMIENNYCH ==================
 *
 * `styleTokensFor` wystawia na korzeniu strony komplet zmiennych ŹRÓDŁOWYCH —
 * osobno dla KAŻDEGO pasa, bo w chwili renderu (serwer) nie wiadomo, na jakim
 * pasie stanie dany element. Zmienne CZYNNE (`--site-surface`, `--site-ink`,
 * `--site-accent`, …) ustawia ARKUSZ, klasą pasa (site.css). Element deklaruje
 * więc wyłącznie ROLĘ („tekst akcentowy"), a nie wartość — i ten sam napis jest
 * ciemnozielony na papierze, a szronowy na pasie ciemnym, bez jednej linijki
 * JavaScriptu i bez koloru dopisanego do treści.
 */
import { z } from "zod";

import { fontPairStacks, SITE_FONT_PAIRS, type SiteFontPair } from "./fonts";
import { motionPreset } from "./motion";
import {
  DEFAULT_THEME,
  SCRIM_ALPHA,
  SITE_THEMES,
  THEME_BAND_KEYS,
  scrimBandOf,
  themeTokens,
  type SiteThemeId,
} from "./theme";

/**
 * Styl w postaci, w jakiej leży w `sites.style_draft`/`style_published`
 * (migracja 0046). Wszystkie pola opcjonalne, bo pusty obiekt `{}` jest legalnym
 * stanem „strona nigdy nie zapisała stylu" — i to jest DEFAULT kolumny.
 *
 * `accent` jest zwykłym stringiem, a nie enumem: dozwolone wartości zależą od
 * MOTYWU (każdy ma własną paletę), więc pojedynczy enum musiałby być sumą
 * wszystkich palet i przepuszczałby akcent z cudzego motywu. Wiążące
 * sprawdzenie robi `resolveSiteStyle` — tam, gdzie znany jest motyw.
 *
 * `.strict()`: jsonb przyjąłby wszystko, a literówka w nazwie pola ginęłaby
 * bez śladu do chwili renderu.
 */
export const siteStyleSchema = z
  .object({
    theme: z.enum(SITE_THEMES as unknown as [SiteThemeId, ...SiteThemeId[]]).optional(),
    accent: z.string().trim().min(1).max(40).optional(),
    fontPair: z.enum(SITE_FONT_PAIRS as unknown as [SiteFontPair, ...SiteFontPair[]]).optional(),
  })
  .strict();
export type SiteStyle = z.infer<typeof siteStyleSchema>;

/** Styl po uzupełnieniu braków — postać, w której posługuje się nim render. */
export interface ResolvedSiteStyle {
  theme: SiteThemeId;
  accent: string;
  fontPair: SiteFontPair;
}

/**
 * Styl strony, która nigdy nie zapisała stylu ANI nie ma kolumny `template` —
 * czyli dokładnie to, czym strona była przed ADR-090. Renderer bez propsu stylu
 * bierze właśnie to, więc podgląd i sklep nie zmieniają ani piksela do chwili,
 * w której operator naprawdę coś wybierze.
 */
export const DEFAULT_SITE_STYLE: ResolvedSiteStyle = {
  theme: DEFAULT_THEME,
  accent: themeTokens(DEFAULT_THEME).defaultAccent,
  fontPair: themeTokens(DEFAULT_THEME).fontPair,
};

/**
 * Czyta styl z jsonb, degradując do wartości motywu zamiast wywracać render.
 * Fail-soft jest tu właściwy (inaczej niż przy kopercie strony, która jest
 * fail-closed): styl spoza allowlisty znaczy najwyżej „strona wygląda domyślnie",
 * a nie „strona pokazuje coś, czego nie wolno pokazać".
 *
 * `fallbackTheme` to kolumna `sites.template` — wartość ZASTANA dla stron sprzed
 * ADR-090. Identyfikatory motywów zastanych są celowo te same, co wartości tej
 * kolumny (`classic`, `bold`), więc mapowanie jest tożsamością, a nie tablicą,
 * o której ktoś kiedyś zapomni.
 */
export function resolveSiteStyle(raw: unknown, fallbackTheme?: string): ResolvedSiteStyle {
  const parsed = siteStyleSchema.safeParse(raw ?? {});
  const style = parsed.success ? parsed.data : {};

  const fallback = (SITE_THEMES as readonly string[]).includes(fallbackTheme ?? "")
    ? (fallbackTheme as SiteThemeId)
    : DEFAULT_THEME;
  const theme = style.theme ?? fallback;
  const tokens = themeTokens(theme);

  return {
    theme,
    // Akcent spoza palety TEGO motywu spada na domyślny akcent motywu — inaczej
    // zmiana motywu (albo wycofanie koloru z palety) zostawiałaby stronę
    // z odcieniem, którego nikt nie policzył i nikt nie zobaczy w panelu.
    accent: style.accent && style.accent in tokens.accents ? style.accent : tokens.defaultAccent,
    fontPair: style.fontPair ?? tokens.fontPair,
  };
}

// -----------------------------------------------------------------------
// Tokeny do renderu
// -----------------------------------------------------------------------

/**
 * Nazwy zmiennych CZYNNYCH — tych, które ustawia arkusz per pas i których używa
 * render. Jedno źródło dla arkusza, komponentów i testów; kontrakt tokenów
 * pilnuje, żeby każda z nich była w arkuszu naprawdę ustawiona.
 */
export const ACTIVE_TOKENS = {
  surface: "--site-surface",
  ink: "--site-ink",
  inkMuted: "--site-ink-muted",
  border: "--site-border",
  accentFill: "--site-accent",
  accentOnFill: "--site-accent-contrast",
  accentText: "--site-accent-text",
  // Sygnał błędu (K6, ADR-092) — czynny per pas dokładnie tak, jak akcent:
  // komunikat „nie wyszło" pojawia się i na karcie, i na pasie odwróconym.
  dangerFill: "--site-danger",
  dangerOnFill: "--site-danger-contrast",
  dangerText: "--site-danger-text",
} as const;

/** Zmienne stałe dla całej strony (nie zmieniają się per pas). */
export const STYLE_TOKENS = {
  fontHeading: "--site-font-heading",
  fontBody: "--site-font-body",
  radius: "--site-radius",
  radiusLarge: "--site-radius-lg",
  borderWidth: "--site-border-width",
  buttonRadius: "--site-button-radius",
  scrimInk: "--site-scrim-ink",
  scrimInkMuted: "--site-scrim-ink-muted",
  displayWeight: "--site-display-weight",
  displayTracking: "--site-display-tracking",
  displayTransform: "--site-display-transform",
  headingWeight: "--site-heading-weight",
  bodyWeight: "--site-body-weight",
  eyebrowTracking: "--site-eyebrow-tracking",
  eyebrowTransform: "--site-eyebrow-transform",
  scrim: "--site-scrim",
  // Ruch motywu (K6/ADR-092, silnik czasowy od ADR-097) — liczby presetu,
  // po których chodzi JEDEN opis wejścia w arkuszu. Zakresu przewijania nie ma
  // wśród nich, bo nie ma już osi przewijania; skali nie ma, bo naddatek niesie
  // krzywa (patrz ./motion).
  motionDuration: "--site-motion-duration",
  motionEasing: "--site-motion-easing",
  motionDistance: "--site-motion-distance",
  motionOpacity: "--site-motion-opacity",
  motionStagger: "--site-motion-stagger",
} as const;

/** Nazwa zmiennej źródłowej pasa — jedno miejsce, w którym powstaje ten napis. */
export function bandTokenName(band: string, role: string): string {
  return `--site-band-${band}-${role}`;
}

/** Promień przycisku wynika z KSZTAŁTU zadeklarowanego przez motyw. */
const BUTTON_RADIUS = {
  square: "0px",
  rounded: "var(--site-radius)",
  pill: "999px",
} as const;

/** `#rrggbb` → `rgb(r g b / alpha)`; welon nad zdjęciem musi być półprzezroczysty. */
function withAlpha(hex: string, alpha: number): string {
  const raw = hex.replace(/^#/, "");
  const value = Number.parseInt(raw, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgb(${r} ${g} ${b} / ${alpha})`;
}

/**
 * Zmienne ŹRÓDŁOWE, które render wstawia na korzeniu strony: komplet dla
 * każdego pasa (kolory + gotowa trójka akcentu wybrana WARIANTEM PASA) oraz
 * wartości wspólne dla strony.
 *
 * To, że wariant akcentu rozstrzyga się TUTAJ, a nie w arkuszu, jest warunkiem
 * skalowania rejestru: motyw, w którym pas odwrócony jest jaśniejszy od strony
 * (`industrial-noir`), nie wymaga ani jednej reguły w CSS — wymaga jednego pola
 * w danych. Przy piętnastu motywach arkusz z regułami per motyw byłby
 * niemożliwy do utrzymania.
 */
export function styleTokensFor(style: ResolvedSiteStyle): Record<string, string> {
  const theme = themeTokens(style.theme);
  const accent = theme.accents[style.accent] ?? theme.accents[theme.defaultAccent]!;
  const fonts = fontPairStacks(style.fontPair);
  const scrimBand = theme.bands[scrimBandOf(style.theme)];
  const motion = motionPreset(theme.motion);

  const tokens: Record<string, string> = {
    [STYLE_TOKENS.fontHeading]: fonts.heading,
    [STYLE_TOKENS.fontBody]: fonts.body,
    [STYLE_TOKENS.radius]: theme.shape.radius,
    [STYLE_TOKENS.radiusLarge]: theme.shape.radiusLarge,
    [STYLE_TOKENS.borderWidth]: theme.shape.borderWidth,
    [STYLE_TOKENS.buttonRadius]: BUTTON_RADIUS[theme.shape.button],
    [STYLE_TOKENS.displayWeight]: theme.type.displayWeight,
    [STYLE_TOKENS.displayTracking]: theme.type.displayTracking,
    [STYLE_TOKENS.displayTransform]: theme.type.displayTransform,
    [STYLE_TOKENS.headingWeight]: theme.type.headingWeight,
    [STYLE_TOKENS.bodyWeight]: theme.type.bodyWeight,
    [STYLE_TOKENS.eyebrowTracking]: theme.type.eyebrowTracking,
    [STYLE_TOKENS.eyebrowTransform]: theme.type.eyebrowTransform,
    [STYLE_TOKENS.scrim]: withAlpha(scrimBand.surface, SCRIM_ALPHA),
    // Kolor tekstu LEŻĄCEGO NA WELONIE — z pasa, z którego welon bierze barwę,
    // a nie z pasa sekcji (te bywają skrajnie różne; patrz ELEMENT_COLORS).
    [STYLE_TOKENS.scrimInk]: scrimBand.ink,
    [STYLE_TOKENS.scrimInkMuted]: scrimBand.inkMuted,
    [STYLE_TOKENS.motionDuration]: motion.duration,
    [STYLE_TOKENS.motionEasing]: motion.easing,
    [STYLE_TOKENS.motionDistance]: motion.distance,
    [STYLE_TOKENS.motionOpacity]: motion.opacity,
    [STYLE_TOKENS.motionStagger]: motion.stagger,
  };

  for (const key of THEME_BAND_KEYS) {
    const band = theme.bands[key];
    const family = accent[band.accent] ?? accent.paper ?? accent.ink!;
    // Sygnał błędu wybiera wariant TYM SAMYM polem pasa co akcent — inaczej
    // czerwień papierowa wylądowałaby na pasie odwróconym.
    const danger = theme.danger[band.accent] ?? theme.danger.paper ?? theme.danger.ink!;
    tokens[bandTokenName(key, "surface")] = band.surface;
    tokens[bandTokenName(key, "ink")] = band.ink;
    tokens[bandTokenName(key, "ink-muted")] = band.inkMuted;
    tokens[bandTokenName(key, "border")] = band.border;
    tokens[bandTokenName(key, "accent")] = family.fill;
    tokens[bandTokenName(key, "accent-contrast")] = family.onFill;
    tokens[bandTokenName(key, "accent-text")] = family.text;
    tokens[bandTokenName(key, "danger")] = danger.fill;
    tokens[bandTokenName(key, "danger-contrast")] = danger.onFill;
    tokens[bandTokenName(key, "danger-text")] = danger.text;
  }

  return tokens;
}
