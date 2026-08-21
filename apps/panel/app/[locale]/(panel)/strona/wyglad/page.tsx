/**
 * EKRAN „WYGLĄD SKLEPU" (ADR-230) — dedykowana podtrasa designu tenanta.
 *
 * DLACZEGO OSOBNY EKRAN. Motyw, akcent, kroje, logo i pigułka terminu są
 * własnością NAJEMCY (ADR-160/161/203), a nie żadnej ze stron — a dotąd motyw,
 * akcent i kroje zmieniało się WYŁĄCZNIE z kreatora konkretnej strony. Ten ekran
 * zbiera całą powłokę wizualną sklepu w jednym miejscu na poziomie sklepu; to
 * RELOKACJA istniejących kontrolek plus jedno rozprzęgnięcie (niedestrukcyjna
 * zmiana motywu — patrz `store-appearance-editor`). BEZ MIGRACJI.
 *
 * PODTRASA, NIE POZYCJA NAWIGACJI. `/strona/wyglad` podświetla „Strona sklepu"
 * dopasowaniem PREFIKSOWYM `matchNavItem`, więc kontrakt nawigacji (dokładny
 * artefakt 15 pozycji) zostaje NIETKNIĘTY. Wejściem jest karta wyglądu na
 * `/strona` (C4).
 *
 * NIEUDANY ODCZYT WIERSZA NAJEMCY gasi CAŁY ekran stanem błędu, a nie rysuje
 * edytor na domyśle: cały sens tego ekranu to pokazać i zmienić wygląd, którego
 * po nieudanym odczycie nie znamy (kanon ADR-174 — kreator rzuca, zamiast udawać
 * domyślny motyw i zapraszać do jego nadpisania).
 */
import { getTranslations } from "next-intl/server";

import { resolveSiteStyle } from "@avably/core/site";

import { ScreenHeader } from "@/components/screens/screen-header";
import { footerMarkGaps, type FooterMarkGap } from "@/lib/footer-mark-reach";
import { requireMemberPage } from "@/lib/member-page";
import { updateStoreStyle } from "@/lib/actions/site";
import { listSites } from "@/lib/site-queries";
import { tenantLogo } from "@/lib/tenant-logo-render";

import { publishTenantAppearanceAction } from "./appearance-actions";
import { StoreLogoCard } from "../store-logo-card";
import { StoreTermPillCard } from "../store-term-pill-card";
import { StoreAppearanceEditor } from "./store-appearance-editor";

export default async function StoreAppearancePage() {
  const ctx = await requireMemberPage("/strona/wyglad");
  const t = await getTranslations("storeAppearance");
  const tSite = await getTranslations("site");

  /*
    JEDEN ODCZYT WIERSZA NAJEMCY — wygląd (ADR-161), znak (ADR-160) i flaga
    pigułki (ADR-203) to ten sam wiersz `tenants`, widoczny przez `own_select`.
    Nieudany odczyt znaczy „nie wiadomo", więc gasi ekran stanem błędu.
  */
  const tenantRow = await ctx.supabase
    .from("tenants")
    .select(
      "logo_draft, logo_published, template, template_published, style_draft, style_published, store_term_calendar_enabled",
    )
    .eq("id", ctx.tenantId!)
    .maybeSingle();

  if (tenantRow.error || !tenantRow.data) {
    return (
      <div className="flex flex-col gap-4">
        <ScreenHeader back={{ href: "/strona", label: t("back") }} title={t("title")} />
        <div
          data-appearance-load-error
          className="border-border bg-card flex flex-col gap-1 rounded-lg border p-4"
        >
          <p className="text-sm font-medium">{tSite("loadErrorTitle")}</p>
          <p role="alert" className="text-destructive text-[13px] leading-[18px]">
            {tSite("loadError")}
          </p>
        </div>
      </div>
    );
  }

  const draft = resolveSiteStyle(
    tenantRow.data.style_draft,
    (tenantRow.data.template as string | null) ?? undefined,
  );
  const published = resolveSiteStyle(
    tenantRow.data.style_published,
    (tenantRow.data.template_published as string | null) ?? undefined,
  );

  /*
    STRONY, NA KTÓRYCH ZNAK DO STOPKI NIE DOTRZE (ADR-167) — liczy je serwer
    tą samą regułą, którą stosuje render sklepu. To informacja POBOCZNA karty
    logo: jej nieudany odczyt gasi wyłącznie listę luk, a nie ekran designu,
    po który operator tu wszedł. Dlatego lista stron leci przez try/catch do
    pustej listy, zamiast wywracać trasę.
  */
  let footerGaps: FooterMarkGap[];
  try {
    const sites = await listSites();
    const footerRows = await ctx.supabase
      .from("site_sections")
      .select("site_id, content_published")
      .eq("tenant_id", ctx.tenantId!)
      .eq("type", "footer")
      .eq("enabled_published", true)
      .not("content_published", "is", null);
    footerGaps = footerMarkGaps(
      sites.map((site) => ({
        id: site.id,
        name: site.name,
        live: site.published_at !== null,
      })),
      footerRows.data ?? [],
    );
  } catch {
    footerGaps = [];
  }

  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader back={{ href: "/strona", label: t("back") }} title={t("title")} />
      <p className="text-muted-foreground text-sm">{t("intro")}</p>

      <StoreAppearanceEditor
        initialDraft={draft}
        initialPublished={published}
        saveStyle={updateStoreStyle}
        publish={publishTenantAppearanceAction}
      />

      <StoreLogoCard
        state={{
          draft: tenantLogo(tenantRow.data.logo_draft),
          published: tenantLogo(tenantRow.data.logo_published),
        }}
        footerGaps={footerGaps}
      />

      <StoreTermPillCard
        initialEnabled={(tenantRow.data.store_term_calendar_enabled as boolean | null) ?? true}
      />
    </div>
  );
}
