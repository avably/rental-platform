"use client";

/**
 * EDYTOR „WYGLĄDU SKLEPU" (ADR-230) — dedykowany ekran designu na poziomie
 * NAJEMCY (`/strona/wyglad`).
 *
 * =============== CO TU JEST NOWE, A CO RELOKACJĄ ===============
 *
 * Wygląd jest tenantowo-globalny od ADR-161 — kolumny stoją na `public.tenants`,
 * zapis idzie przez `app.set_tenant_style`, publikacja przez
 * `app.publish_tenant_appearance`. Ten ekran NIE zmienia modelu danych: przenosi
 * kontrolki, które dotąd żyły w kreatorze KONKRETNEJ strony (`StylePanel` —
 * akcent i para krojów), w JEDNO miejsce na poziomie sklepu i dokłada do nich
 * wybór MOTYWU oraz podgląd na żywo.
 *
 * =============== ROZPRZĘGNIĘCIE ZMIANY MOTYWU (decyzja właściciela) ===============
 *
 * Do ADR-230 motyw zmieniał się WYŁĄCZNIE przez `applyStarterTemplate` —
 * a ta ścieżka jest DESTRUKCYJNA: kasuje sekcje szkicu i wstawia gotową stronę
 * (świadomie, dla „wybierz szablon startowy"). Tutaj motyw ma się dać zmienić
 * BEZ dotykania treści, więc jedzie tą samą drogą co akcent i kroje —
 * `updateStoreStyle` → `set_tenant_style` z PEŁNYM stylem `{theme, accent,
 * fontPair}`. Sekcje stron nie są w tym wywołaniu ani wspomniane. Dowodzi tego
 * `store-appearance-editor.test.tsx` (klik motywu woła `saveStyle`, nie
 * `applyStarterTemplate`).
 *
 * AKCENT WRACA DO DOMYŚLNEGO MOTYWU. Paleta akcentów należy do motywu (ADR-090),
 * więc przy zmianie motywu zapisujemy `defaultAccent` NOWEGO motywu, a nie
 * zastany odcień z cudzej palety — `resolveSiteStyle` i tak zrobiłby fallback,
 * ale zapisana wartość ma być od razu poprawna.
 *
 * =============== STAN SZKIC/PUBLIKACJA ===============
 *
 * Ta sama zasada, co przy logu i liście stron: zmiana widoczna w panelu nie jest
 * zmianą w sklepie, dopóki nie padnie publikacja. `dirty` liczymy z porównania
 * rozstrzygniętych stylów (draft vs published) — tak samo jak `appearancePending`
 * na ekranie stron, żeby oba miejsca nie mówiły o stanie sklepu czegoś innego.
 */
import {
  FONT_PAIRS,
  SELECTABLE_THEMES,
  styleTokensFor,
  themeTokens,
  type ResolvedSiteStyle,
  type SiteThemeId,
} from "@avably/core/site";
import { Button, siteStyles } from "@avably/ui";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState, useTransition, type CSSProperties } from "react";

import { StylePanel } from "@/app/[locale]/(kreator)/strona/[siteId]/kreator/builder-style-panel";

type StyleActionResult = { ok: true } | { ok: false; error: string };

function sameStyle(a: ResolvedSiteStyle, b: ResolvedSiteStyle): boolean {
  return a.theme === b.theme && a.accent === b.accent && a.fontPair === b.fontPair;
}

export function StoreAppearanceEditor({
  initialDraft,
  initialPublished,
  saveStyle,
  publish,
}: {
  initialDraft: ResolvedSiteStyle;
  initialPublished: ResolvedSiteStyle;
  /**
   * ZAPIS SZKICU wyglądu — wpięte w `updateStoreStyle` (tenant-global, bez
   * `siteId`). Przekazane PROPEM, a nie zaimportowane, żeby dowód mutacyjny
   * niedestrukcyjności motywu mógł podstawić szpiega bez mockowania modułu.
   */
  saveStyle: (style: ResolvedSiteStyle) => Promise<StyleActionResult>;
  /** PUBLIKACJA wyglądu — wpięte w `publish_tenant_appearance` (istniejące RPC). */
  publish: () => Promise<StyleActionResult>;
}) {
  const t = useTranslations("storeAppearance");
  const locale = useLocale();
  const language = locale === "en" ? "en" : "pl";
  const idPrefix = useId();

  const [draft, setDraft] = useState(initialDraft);
  const [published, setPublished] = useState(initialPublished);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = !sameStyle(draft, published);

  /**
   * Zapis PEŁNEGO stylu, optymistyczny z COFNIĘCIEM przy odmowie — jak
   * przełącznik pigułki terminu. Wołający (klik motywu, `StylePanel`) podaje
   * cały stan, a nie łatkę pojedynczego pola: scalanie po stronie serwera byłoby
   * wyścigiem dwóch otwartych kart (kanon `updateStoreStyleInputSchema`).
   */
  function save(next: ResolvedSiteStyle) {
    if (sameStyle(next, draft)) return;
    const previous = draft;
    setError(null);
    setDraft(next);
    startTransition(async () => {
      const result = await saveStyle(next);
      if (!result.ok) {
        setDraft(previous);
        setError(result.error);
      }
    });
  }

  /**
   * ZMIANA MOTYWU — NIEDESTRUKCYJNA. Jedzie przez `save` → `set_tenant_style`,
   * nigdy przez `applyStarterTemplate`. Akcent ustawiamy na domyślny NOWEGO
   * motywu; para krojów zostaje (jest wspólna dla motywów).
   */
  function chooseTheme(theme: SiteThemeId) {
    if (theme === draft.theme) return;
    save({ theme, accent: themeTokens(theme).defaultAccent, fontPair: draft.fontPair });
  }

  function publishNow() {
    setError(null);
    startTransition(async () => {
      const result = await publish();
      if (result.ok) setPublished(draft);
      else setError(result.error);
    });
  }

  return (
    <section
      data-appearance-editor
      data-appearance-state={dirty ? "pending" : "live"}
      className="flex flex-col gap-4"
    >
      {/*
        STAN PUBLIKACJI + WEJŚCIE PUBLIKACJI. Zdanie o stanie stoi PRZY
        przycisku, bo to ono odpowiada na pytanie „dlaczego klient jeszcze tego
        nie widzi" — dokładnie jak przy logu (`store-logo-card`).
      */}
      <div className="border-border bg-card flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
        {dirty ? (
          <p data-appearance-pending className="text-foreground text-[13px] leading-[18px]">
            {t("pending")}
          </p>
        ) : (
          <p data-appearance-live className="text-muted-foreground text-[13px] leading-[18px]">
            {t("live")}
          </p>
        )}
        {dirty ? (
          <Button
            type="button"
            size="sm"
            data-appearance-publish
            loading={pending}
            disabled={pending}
            onClick={publishNow}
          >
            {t("publish")}
          </Button>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-4">
          {/* MOTYW — wybór świata wizualnego, próbki palet z rejestru rdzenia. */}
          <div className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">{t("theme.title")}</p>
              <p className="text-muted-foreground text-[13px] leading-[18px]">
                {t("theme.description")}
              </p>
            </div>
            <div
              role="group"
              aria-label={t("theme.title")}
              className="grid grid-cols-2 gap-2 sm:grid-cols-3"
            >
              {SELECTABLE_THEMES.map((id) => (
                <ThemeSwatch
                  key={id}
                  id={id}
                  label={t(`themes.${id}`)}
                  active={draft.theme === id}
                  disabled={pending}
                  onSelect={() => chooseTheme(id)}
                />
              ))}
            </div>
          </div>

          {/*
            AKCENT I KROJE — reużyty `StylePanel` z kreatora (ADR-230). Ten sam
            komponent wpina się tu w `save` → `set_tenant_style`, bez `siteId`.
          */}
          <div className="border-border bg-card flex flex-col rounded-lg border p-4">
            <StylePanel
              disabled={pending}
              style={draft}
              locale={locale}
              idPrefix={idPrefix}
              onSave={save}
            />
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">{t("preview.title")}</p>
              <p className="text-muted-foreground text-[13px] leading-[18px]">
                {t("preview.description")}
              </p>
            </div>
            <AppearancePreview
              style={draft}
              eyebrow={t("preview.eyebrow")}
              heading={t("preview.heading")}
              body={t("preview.body")}
              cta={t("preview.cta")}
            />
            {/* Nazwa pary krojów bierze się z DANYCH rdzenia, nie z panelu. */}
            <p className="text-muted-foreground text-[13px] leading-[18px]">
              {t("preview.fontsLabel", { pair: FONT_PAIRS[draft.fontPair].label[language] })}
            </p>
          </div>
        </div>
      </div>

      {error ? (
        <p role="alert" data-appearance-error className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/**
 * Próbka motywu — trzy paski z palety motywu (akcent + tekst + tło) i nazwa.
 * Kolory idą z REJESTRU rdzenia (`themeTokens`), nigdy z ręcznej palety: paleta
 * wpisana tutaj rozjechałaby się z tą, którą render pokazuje klientowi.
 */
function ThemeSwatch({
  id,
  label,
  active,
  disabled,
  onSelect,
}: {
  id: SiteThemeId;
  label: string;
  active: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const tokens = themeTokens(id);
  const band = tokens.bands.default;
  const accentFill = tokens.accents[tokens.defaultAccent]![band.accent]!.fill;
  const stripes = [accentFill, band.ink, band.surface];

  return (
    <button
      type="button"
      data-appearance-theme={id}
      aria-pressed={active}
      aria-label={label}
      disabled={disabled}
      onClick={onSelect}
      className={`focus-visible:outline-accent dark:focus-visible:outline-ring flex cursor-pointer flex-col overflow-hidden rounded-lg border-2 outline-none transition-colors [transition-duration:var(--motion-fast)] focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 disabled:cursor-not-allowed ${
        active ? "border-accent" : "border-border hover:border-foreground"
      }`}
    >
      <span aria-hidden className="flex h-10">
        {stripes.map((color, index) => (
          <span key={index} className="flex-1" style={{ background: color }} />
        ))}
      </span>
      <span className="px-2 py-1.5 text-[12px] leading-[16px] font-medium">{label}</span>
    </button>
  );
}

/**
 * PODGLĄD NA ŻYWO — jeden pas hero ostylowany TOKENIZACJĄ RDZENIA
 * (`styleTokensFor`), nie ręcznymi kolorami. Korzeń niesie zmienne źródłowe
 * i klasę `site-root` (jak render sklepu), a arkusz `@avably/ui/site.css`
 * — zaimportowany w globals panelu — wybiera z nich zestaw CZYNNY klasą pasa.
 * Motyw, akcent, krój, kształt i wypełnienie przycisku pochodzą więc z tego
 * samego źródła, z którego bierze je storefront: tu nie ma ani jednego koloru
 * dopisanego ręcznie. `aria-hidden`, bo to obraz stanu, a nie treść do czytania.
 */
function AppearancePreview({
  style,
  eyebrow,
  heading,
  body,
  cta,
}: {
  style: ResolvedSiteStyle;
  eyebrow: string;
  heading: string;
  body: string;
  cta: string;
}) {
  const theme = themeTokens(style.theme);
  const styles = siteStyles();

  return (
    <div
      data-appearance-preview
      aria-hidden
      className="border-border site-root @container/site overflow-hidden rounded-md border"
      data-site-theme={style.theme}
      data-site-button={theme.shape.buttonFill}
      data-site-motion="off"
      style={styleTokensFor(style) as CSSProperties}
    >
      <div className="site-band-inverted px-6 py-8">
        <p className={styles.eyebrow}>{eyebrow}</p>
        {/* Krój i waga nagłówka z tokenów motywu; rozmiar zbity do skali kafla. */}
        <p className="landing-display mt-1" style={{ fontSize: "1.6rem", lineHeight: 1.12 }}>
          {heading}
        </p>
        <p className="site-text-muted mt-2 text-sm">{body}</p>
        <span className="site-cta mt-4 inline-flex items-center text-sm font-semibold">{cta}</span>
      </div>
    </div>
  );
}
