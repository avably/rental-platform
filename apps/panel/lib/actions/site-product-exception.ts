"use server";

/**
 * WŁASNA STRONA WYBRANEGO PRODUKTU — AKCJE FAZY B (ADR-200, na schemacie 0088
 * z fazy A / ADR-199).
 *
 * Dwa czasowniki i ani jednej nowej reguły w TS — reguły stoją w BAZIE:
 *
 *   • `forkProductPage` — FORK: nowy wiersz `sites` z `kind='product'`
 *     i `product_id`, z PEŁNĄ KOPIĄ treści roboczej szablonu-matki (ADR-199
 *     rozstrzygnięcie 6: kopia, nie referencja — zmiana matki po forku NIE
 *     propaguje). Limit 5 produktów z własną stroną egzekwuje trigger
 *     `sites_product_exception_limit` (PT409 + hint) — ta akcja go ŁAPIE
 *     i tłumaczy na zdanie, niczego nie licząc przed wstawką: drugie źródło
 *     prawdy o limicie rozjechałoby się z bazą przy pierwszej zmianie planu.
 *
 *   • `restoreDefaultProductPage` — PRZYWRÓCENIE SZABLONU DOMYŚLNEGO
 *     (zabezpieczenie §4.5 dokumentu architektury): usunięcie wiersza wyjątku.
 *     Wiersz ŻYWY najpierw schodzi ze sklepu (`app.unpublish_site` — tylko ona
 *     wolno jej pisać `published_at`, strażnik 0045), bo kasowania żywej strony
 *     broni trigger `sites_guard_live_delete`. Po usunięciu sklep rozstrzyga
 *     sam (faza A): adres produktu wraca pod matkę albo pod stronę wbudowaną.
 *
 * Bezpieczeństwo: obie akcje działają klientem zalogowanego membera — bramką
 * izolacji jest RLS (0019) i FK złożony (tenant_id, product_id) → products
 * (0088): fork cudzego produktu jest niereprezentowalny, zanim jakikolwiek
 * filtr się wypowie. Filtry .eq("tenant_id", …) są zawężeniem zapytania
 * i czytelnym błędem, nie mechanizmem ochrony. Rola członka wystarcza ŚWIADOMIE:
 * tworzenie stron (`createSite`) jest w tym repo pracą lady (polityki 0019 dla
 * każdego członka), a fork jest tym samym czasownikiem na innym wierszu —
 * bramka ownera robiłaby z dwóch dróg do strony dwie różne reguły.
 */
import { revalidatePath, revalidateTag } from "next/cache";
import { getTranslations } from "next-intl/server";

import {
  PRODUCT_TEMPLATE_SITE_KIND,
  tenantCacheTag,
  type SectionType,
} from "@avably/core/site";

import { AuthError } from "@/lib/auth";
import { uuidSchema } from "@/lib/catalog-validation";
import {
  MAX_PRODUCT_EXCEPTIONS,
  forkProductPageInputSchema,
  isProductExceptionLimitError,
  type ForkProductPageInput,
  type SiteActionResult,
} from "@/lib/site-validation";
import { requireMember } from "@/lib/supabase-server";

type Ctx = Awaited<ReturnType<typeof requireMember>>;

/** Wspólny prolog akcji: kontekst membera albo czytelna odmowa (wzorzec site.ts). */
async function memberCtx(): Promise<
  { ok: true; ctx: Ctx; tenantId: string } | { ok: false; error: string }
> {
  try {
    const ctx = await requireMember();
    return { ok: true, ctx, tenantId: ctx.tenantId! };
  } catch (err) {
    if (err instanceof AuthError) return { ok: false, error: err.message };
    throw err;
  }
}

/**
 * FORK: utworzenie WŁASNEJ STRONY wskazanego produktu (ADR-200, B1).
 *
 * Kolejność jest treścią akcji:
 *   1. PRODUKT z katalogu najemcy (nazwa nowej strony; cudzy produkt = „nie
 *      znaleziono", bo RLS tnie wiersz — celowo nieodróżnialne od braku);
 *   2. SZABLON-MATKA (`kind='product' AND product_id IS NULL`) — bez niej fork
 *      nie ma czego kopiować i odmawia zdaniem, które wskazuje następny krok;
 *   3. INSERT wiersza wyjątku Z KOPIĄ kolumn szkicu matki (`template`,
 *      `style_draft`) — tu pada odmowa limitu z bazy (PT409), tłumaczona na
 *      zdanie z liczbą;
 *   4. KOPIA sekcji roboczych matki (bez nagrobków `deleted_in_draft` — one są
 *      w szkicu USUNIĘTE, więc kopiowanie ich wskrzeszałoby treść, którą
 *      operator już skasował). Jedno zapytanie, jak w `applyStarterTemplate`:
 *      strona-hybryda z połową sekcji jest gorsza niż odmowa. Nieudana kopia
 *      sprząta po sobie świeży wiersz — wyjątek BEZ treści matki nie jest
 *      forkiem, tylko pustą stroną udającą go.
 *
 * Nowy wiersz rodzi się NIEŻYWY (`published_at` NULL — strażnik 0045 nie
 * pozwala inaczej), więc sklep się nie zmienia: publikacja to osobny krok
 * tego samego potoku, którym chodzi każda strona.
 */
export async function forkProductPage(
  input: ForkProductPageInput,
): Promise<SiteActionResult<{ siteId: string }>> {
  const parsed = forkProductPageInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Nieprawidłowy produkt." };
  }
  const auth = await memberCtx();
  if (!auth.ok) return auth;
  const { ctx } = auth;
  const t = await getTranslations("site");

  const { data: product, error: productError } = await ctx.supabase
    .from("products")
    .select("id, name")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", parsed.data.productId)
    .maybeSingle();
  if (productError) return { ok: false, error: productError.message };
  if (!product) return { ok: false, error: t("pages.exceptionProductNotFound") };

  /*
   * MATKA: przy dwóch wierszach roli (stan legalny dla bazy — unikat pilnuje
   * wyłącznie ŻYWEGO szablonu, panel drugiego szkicu nie zakłada) kopiujemy
   * ŻYWĄ, a spośród nieżywych najnowszą: to jest wiersz, który operator widzi
   * jako „swój szablon".
   */
  const { data: mother, error: motherError } = await ctx.supabase
    .from("sites")
    .select("id, template, style_draft")
    .eq("tenant_id", ctx.tenantId)
    .eq("kind", PRODUCT_TEMPLATE_SITE_KIND)
    .is("product_id", null)
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (motherError) return { ok: false, error: motherError.message };
  if (!mother) return { ok: false, error: t("pages.exceptionNoTemplate") };

  const { data: motherSections, error: sectionsError } = await ctx.supabase
    .from("site_sections")
    .select("type, content_draft, enabled, position")
    .eq("tenant_id", ctx.tenantId)
    .eq("site_id", mother.id)
    .eq("deleted_in_draft", false)
    .order("position", { ascending: true })
    .order("id", { ascending: true });
  if (sectionsError) return { ok: false, error: sectionsError.message };

  /*
   * NAZWA nowej strony = nazwa produktu (dana czysto panelowa, sklep jej nie
   * widzi) — na liście stron wiersz wyjątku ma mówić, KTÓREGO sprzętu dotyczy,
   * zanim ktokolwiek doczyta odznakę. CHECK długości nazwy: 1–80 po przycięciu.
   */
  const name = product.name.trim().slice(0, 80) || t("pages.exceptionDefaultName");

  const { data: created, error: insertError } = await ctx.supabase
    .from("sites")
    .insert({
      tenant_id: ctx.tenantId,
      name,
      // Adres strony wyjątku to adres PRODUKTU — własnego nie ma (CHECK-i 0080
      // dziedziczone po roli), więc slug jest pusty i NIE znaczy „strona główna".
      slug: "",
      kind: PRODUCT_TEMPLATE_SITE_KIND,
      product_id: product.id,
      // Kopia kolumn SZKICU matki — fork ma wyglądać jak matka w chwili
      // odłączenia, także w zastanym fallbacku szablonu graficznego.
      template: mother.template,
      style_draft: mother.style_draft,
    })
    .select("id")
    .single();
  if (insertError || !created) {
    if (insertError && isProductExceptionLimitError(insertError)) {
      return {
        ok: false,
        error: t("pages.exceptionLimitReached", { max: MAX_PRODUCT_EXCEPTIONS }),
      };
    }
    // 23503 = FK złożony (produkt spoza tenanta — niereprezentowalny) —
    // celowo to samo zdanie, co brak produktu: nieodróżnialne dla wołającego.
    if (insertError?.code === "23503") {
      return { ok: false, error: t("pages.exceptionProductNotFound") };
    }
    return { ok: false, error: insertError?.message ?? "Nie udało się utworzyć strony produktu." };
  }
  const siteId = created.id as string;

  if ((motherSections ?? []).length > 0) {
    const { error: copyError } = await ctx.supabase.from("site_sections").insert(
      (motherSections ?? []).map((section) => ({
        tenant_id: ctx.tenantId,
        site_id: siteId,
        type: section.type as SectionType,
        // KOPIA treści roboczej 1:1 (jsonb w całości). `content_published`
        // celowo NIE ustawiane — domyślny NULL czyni każdą sekcję nieopublikowaną.
        content_draft: section.content_draft,
        enabled: section.enabled as boolean,
        position: section.position as number,
      })),
    );
    if (copyError) {
      // Sprzątanie: wiersz bez treści matki nie jest forkiem. Świeży wiersz
      // jest nieżywy, więc DELETE przechodzi; nieudane sprzątanie nie zmienia
      // werdyktu — operator dostaje odmowę i widzi pustą stronę na liście.
      await ctx.supabase
        .from("sites")
        .delete()
        .eq("tenant_id", ctx.tenantId)
        .eq("id", siteId);
      return { ok: false, error: copyError.message };
    }
  }

  // BEZ revalidateTag: nowy wiersz jest nieżywy, więc sklep się nie zmienił.
  revalidatePath("/", "layout");
  return { ok: true, siteId };
}

/**
 * PRZYWRÓCENIE SZABLONU DOMYŚLNEGO (ADR-200, B3; §4.5 dokumentu architektury):
 * usunięcie wiersza WYJĄTKU — i wyłącznie jego.
 *
 * Zawężenie `product_id IS NOT NULL` jest treścią czasownika, nie ostrożnością:
 * ta akcja obiecuje „produkt wraca pod matkę", więc wiersz, który matką JEST
 * (albo zwykłą stroną), ma dostać odmowę, a nie zniknąć. Bramką izolacji
 * pozostaje RLS — cudzy wiersz jest nieodróżnialny od nieistniejącego.
 *
 * Wiersz ŻYWY schodzi ze sklepu PRZED usunięciem (`app.unpublish_site`):
 * kasowania żywej strony broni trigger `sites_guard_live_delete` (42501),
 * a rozbicie na dwa jawne kroki w kodzie panelu jest tańsze niż druga wersja
 * tej reguły. Cena jest jawna: to NIE jest jedna transakcja — nieudane
 * usunięcie po udanym zdjęciu zostawia wyjątek jako szkic (stan widoczny na
 * liście, naprawialny ponownym kliknięciem), a sklep już pokazuje matkę.
 */
export async function restoreDefaultProductPage(siteId: string): Promise<SiteActionResult> {
  const parsed = uuidSchema.safeParse(siteId);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  const auth = await memberCtx();
  if (!auth.ok) return auth;
  const { ctx } = auth;
  const t = await getTranslations("site");

  const { data: site, error: readError } = await ctx.supabase
    .from("sites")
    .select("id, product_id, published_at")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", parsed.data)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  if (!site) return { ok: false, error: "Nie znaleziono strony." };
  if (site.product_id === null) {
    return { ok: false, error: t("pages.restoreDefaultNotException") };
  }

  const wasLive = site.published_at !== null;
  if (wasLive) {
    const { error: unpublishError } = await ctx.supabase
      .schema("app")
      .rpc("unpublish_site", { p_site_id: parsed.data });
    if (unpublishError) {
      return {
        ok: false,
        error:
          unpublishError.code === "22023"
            ? "Nie znaleziono strony."
            : (unpublishError.message ?? "Nie udało się zdjąć strony ze sklepu."),
      };
    }
  }

  const { data: deleted, error: deleteError } = await ctx.supabase
    .from("sites")
    .delete()
    .eq("tenant_id", ctx.tenantId)
    .eq("id", parsed.data)
    .not("product_id", "is", null)
    .select("id");
  if (deleteError) return { ok: false, error: deleteError.message };
  if ((deleted ?? []).length === 0) return { ok: false, error: "Nie znaleziono strony." };

  revalidatePath("/", "layout");
  // Tag leci TYLKO gdy wiersz był żywy: zdjęcie ze sklepu zmieniło stronę
  // klienta (adres produktu wraca pod matkę / stronę wbudowaną). Usunięcie
  // szkicu sklepu nie zmienia — kłamstwo o zmianie kosztuje cache całego sklepu.
  if (wasLive) revalidateTag(tenantCacheTag(auth.tenantId), "max");
  return { ok: true };
}
