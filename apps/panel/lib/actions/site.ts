"use server";

/**
 * Akcje modelu sekcyjnego storefrontu (Zadanie 2.3a, ADR-041) — WARSTWA LOGIKI
 * dla edytora 2.3b (UI powstaje osobno).
 *
 * PUBLIKACJA JEST JEDYNĄ BRAMKĄ (ADR-091, migracja 0045). Każda akcja z tego
 * pliku poza `publishSite` pisze WYŁĄCZNIE do kolumn SZKICU
 * (`content_draft`, `position`, `enabled`, `sites.template`,
 * `deleted_in_draft`). Publiczny odczyt `app.get_published_site` czyta wyłącznie
 * bliźniaki `*_published`, więc żadna z nich nie zmienia strony klienta — do
 * momentu publikacji. Gwarancji NIE niesie ten kod (można ją stąd obejść
 * dowolnym zapytaniem), tylko rozdzielenie kolumn w bazie.
 *
 * Bezpieczeństwo: każda akcja działa klientem zalogowanego membera — bramką
 * izolacji jest RLS (0019), nie ten kod. Filtry .eq("tenant_id", …) są
 * zawężeniem zapytania i czytelnym błędem, nie mechanizmem ochrony.
 * Treść sekcji waliduje @avably/core/site (jedyne źródło kształtu).
 */
import { revalidatePath, revalidateTag } from "next/cache";

import { tenantCacheTag } from "@avably/core/site";

import { AuthError } from "@/lib/auth";
import {
  reorderPlan,
  reorderSectionsInputSchema,
  toggleSectionInputSchema,
  updateTemplateInputSchema,
  upsertSectionInputSchema,
  MAX_SECTIONS,
  type SiteActionResult,
  type UpsertSectionInput,
} from "@/lib/site-validation";
import { uuidSchema } from "@/lib/catalog-validation";
import { requireMember } from "@/lib/supabase-server";

type Ctx = Awaited<ReturnType<typeof requireMember>>;

/** Wspólny prolog akcji: kontekst membera albo czytelna odmowa. */
async function memberCtx(): Promise<
  { ok: true; ctx: Ctx; tenantId: string } | { ok: false; error: string }
> {
  try {
    const ctx = await requireMember();
    // requireMember rzuca dla sesji bez organizacji — tu claim tenanta już jest.
    return { ok: true, ctx, tenantId: ctx.tenantId! };
  } catch (err) {
    if (err instanceof AuthError) return { ok: false, error: err.message };
    throw err;
  }
}

/**
 * Zwraca stronę tenanta, tworząc ją przy pierwszym wejściu do edytora (jedna
 * strona per tenant — UNIQUE 0019). Wyścig dwóch kart rozstrzyga baza:
 * przegrany INSERT (23505) kończy się ponownym odczytem zwycięzcy.
 */
export async function ensureSite(): Promise<SiteActionResult<{ siteId: string }>> {
  const auth = await memberCtx();
  if (!auth.ok) return auth;
  const { ctx } = auth;

  const { data: existing, error: selectError } = await ctx.supabase
    .from("sites")
    .select("id")
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (selectError) return { ok: false, error: selectError.message };
  if (existing) return { ok: true, siteId: existing.id as string };

  const { data: created, error: insertError } = await ctx.supabase
    .from("sites")
    .insert({ tenant_id: ctx.tenantId })
    .select("id")
    .single();
  if (created) return { ok: true, siteId: created.id as string };

  // 23505 = przegrany wyścig o UNIQUE(tenant_id) — strona już jest, czytamy ją.
  if (insertError?.code === "23505") {
    const { data: winner } = await ctx.supabase
      .from("sites")
      .select("id")
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle();
    if (winner) return { ok: true, siteId: winner.id as string };
  }
  return { ok: false, error: insertError?.message ?? "Nie udało się utworzyć strony." };
}

/**
 * Upsert sekcji: sectionId obecne = aktualizacja draftu (typ niezmienny),
 * nieobecne = dodanie sekcji. Zapis WYŁĄCZNIE do content_draft.
 */
export async function upsertSection(
  input: UpsertSectionInput,
): Promise<SiteActionResult<{ sectionId: string }>> {
  const parsed = upsertSectionInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane sekcji." };
  }
  const auth = await memberCtx();
  if (!auth.ok) return auth;
  const { ctx } = auth;
  const { siteId, sectionId, type, content, position, enabled } = parsed.data;

  if (sectionId) {
    // Typ jest niezmienny: treść published starego typu nie może wisieć pod
    // nowym typem do następnej publikacji. Zmiana typu = usunięcie + dodanie.
    const { data: existing, error: readError } = await ctx.supabase
      .from("site_sections")
      .select("id, type")
      .eq("tenant_id", ctx.tenantId)
      .eq("site_id", siteId)
      .eq("id", sectionId)
      .maybeSingle();
    if (readError) return { ok: false, error: readError.message };
    if (!existing) return { ok: false, error: "Nie znaleziono sekcji." };
    if (existing.type !== type) {
      return { ok: false, error: "Typ sekcji jest niezmienny — usuń sekcję i dodaj nową." };
    }

    const { error } = await ctx.supabase
      .from("site_sections")
      .update({
        content_draft: content,
        ...(position === undefined ? {} : { position }),
        ...(enabled === undefined ? {} : { enabled }),
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", ctx.tenantId)
      .eq("id", sectionId);
    if (error) return { ok: false, error: error.message };

    revalidatePath("/", "layout");
    return { ok: true, sectionId };
  }

  // Nowa sekcja: bez podanej pozycji ląduje na końcu (max + 1, wzorzec 0018).
  let nextPosition = position;
  if (nextPosition === undefined) {
    const { data: last, error: lastError } = await ctx.supabase
      .from("site_sections")
      .select("position")
      .eq("tenant_id", ctx.tenantId)
      .eq("site_id", siteId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastError) return { ok: false, error: lastError.message };
    nextPosition = last ? last.position + 1 : 0;
  }

  const { count } = await ctx.supabase
    .from("site_sections")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", ctx.tenantId)
    .eq("site_id", siteId);
  if ((count ?? 0) >= MAX_SECTIONS) {
    return { ok: false, error: "Strona osiągnęła maksymalną liczbę sekcji." };
  }

  const { data: created, error } = await ctx.supabase
    .from("site_sections")
    .insert({
      tenant_id: ctx.tenantId,
      site_id: siteId,
      type,
      content_draft: content,
      position: nextPosition,
      enabled: enabled ?? true,
    })
    .select("id")
    .single();
  // 23503 = FK złożony (site spoza tenanta — ADR-019) zamieniony na czytelną odmowę.
  if (error || !created) {
    return { ok: false, error: error?.code === "23503" ? "Nie znaleziono strony." : (error?.message ?? "Nie udało się dodać sekcji.") };
  }

  revalidatePath("/", "layout");
  return { ok: true, sectionId: created.id as string };
}

/** Nowa kolejność sekcji strony — orderedIds musi być permutacją kompletu (patrz reorderPlan). */
export async function reorderSections(
  siteId: string,
  orderedIds: string[],
): Promise<SiteActionResult> {
  const parsed = reorderSectionsInputSchema.safeParse({ siteId, orderedIds });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane kolejności." };
  }
  const auth = await memberCtx();
  if (!auth.ok) return auth;
  const { ctx } = auth;

  const { data: current, error: readError } = await ctx.supabase
    .from("site_sections")
    .select("id")
    .eq("tenant_id", ctx.tenantId)
    .eq("site_id", parsed.data.siteId);
  if (readError) return { ok: false, error: readError.message };

  const plan = reorderPlan(
    (current ?? []).map((row) => row.id as string),
    parsed.data.orderedIds,
  );
  if (!plan.ok) return plan;

  // Seria UPDATE-ów (przejściowe duplikaty position są legalne — 0019); przy
  // kilkunastu sekcjach to koszt pomijalny, a częściowa awaria psuje najwyżej
  // kolejność (odwracalna kolejnym reorderem), nie treść.
  const now = new Date().toISOString();
  for (const { id, position } of plan.updates) {
    const { error } = await ctx.supabase
      .from("site_sections")
      .update({ position, updated_at: now })
      .eq("tenant_id", ctx.tenantId)
      .eq("site_id", parsed.data.siteId)
      .eq("id", id);
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

/** Włączenie/wyłączenie sekcji (wyłączona zostaje w edytorze, znika z publikacji przy odczycie). */
export async function toggleSection(
  sectionId: string,
  enabled: boolean,
): Promise<SiteActionResult> {
  const parsed = toggleSectionInputSchema.safeParse({ sectionId, enabled });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane." };
  }
  const auth = await memberCtx();
  if (!auth.ok) return auth;
  const { ctx } = auth;

  const { data, error } = await ctx.supabase
    .from("site_sections")
    .update({ enabled: parsed.data.enabled, updated_at: new Date().toISOString() })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", parsed.data.sectionId)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "Nie znaleziono sekcji." };

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Usunięcie sekcji — OPERACJA SZKICU (ADR-091). Dwie drogi, rozstrzygane
 * stanem sekcji, nie wyborem operatora:
 *
 *   * sekcja STOI NA ŻYWEJ STRONIE (content_published nie jest NULL-em) →
 *     `deleted_in_draft = true`. Wiersz zostaje: na stronie klienta sekcja
 *     wisi dalej (bo to publikacja o tym decyduje), a w kreatorze widać ją
 *     z chipem „usunięta w szkicu" i akcją „przywróć". Kasuje ją dopiero
 *     app.publish_site.
 *   * sekcja NIGDY nie była opublikowana → twardy DELETE. Nie ma czego
 *     chronić do publikacji, a nagrobek bez stanu opublikowanego jest
 *     w bazie niereprezentowalny (CHECK site_sections_tombstone_published).
 *
 * `mode` mówi wołającemu, co się stało — UI dobiera komunikat i decyduje, czy
 * sekcja zniknęła z płótna, czy tylko zmieniła wygląd.
 */
export async function deleteSection(
  sectionId: string,
): Promise<SiteActionResult<{ mode: "marked" | "removed" }>> {
  const parsed = uuidSchema.safeParse(sectionId);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  const auth = await memberCtx();
  if (!auth.ok) return auth;
  const { ctx } = auth;

  const { data: existing, error: readError } = await ctx.supabase
    .from("site_sections")
    .select("id, content_published")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", parsed.data)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  if (!existing) return { ok: false, error: "Nie znaleziono sekcji." };

  if (existing.content_published === null) {
    const { data, error } = await ctx.supabase
      .from("site_sections")
      .delete()
      .eq("tenant_id", ctx.tenantId)
      .eq("id", parsed.data)
      .select("id");
    if (error) return { ok: false, error: error.message };
    if (!data || data.length === 0) return { ok: false, error: "Nie znaleziono sekcji." };

    revalidatePath("/", "layout");
    return { ok: true, mode: "removed" };
  }

  const { data, error } = await ctx.supabase
    .from("site_sections")
    .update({ deleted_in_draft: true, updated_at: new Date().toISOString() })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", parsed.data)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "Nie znaleziono sekcji." };

  revalidatePath("/", "layout");
  return { ok: true, mode: "marked" };
}

/**
 * Cofnięcie usunięcia PRZED publikacją (ADR-091). Zdejmuje znacznik z sekcji,
 * która wciąż stoi na żywej stronie — po publikacji nie ma czego przywracać,
 * bo wiersza już nie ma, i wtedy odmowa jest prawdziwa („nie znaleziono").
 */
export async function restoreSection(sectionId: string): Promise<SiteActionResult> {
  const parsed = uuidSchema.safeParse(sectionId);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  const auth = await memberCtx();
  if (!auth.ok) return auth;
  const { ctx } = auth;

  const { data, error } = await ctx.supabase
    .from("site_sections")
    .update({ deleted_in_draft: false, updated_at: new Date().toISOString() })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", parsed.data)
    .eq("deleted_in_draft", true)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "Nie znaleziono usuniętej sekcji." };

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Duplikat sekcji: kopia tego samego typu z content_draft oryginału, wstawiona
 * TUŻ ZA nim na liście. Kopia jest z definicji NIEOPUBLIKOWANA — content_published
 * zostaje NULL (domyślne 0019), więc żyje w edytorze i podglądzie szkicu, a na
 * publicznej stronie pojawia się dopiero po następnej publikacji. Po wstawieniu
 * strona jest przenumerowana, by kopia DETERMINISTYCZNIE sąsiadowała z oryginałem:
 * sam remis position nie gwarantowałby miejsca, bo odczyt sortuje (position, id).
 */
export async function duplicateSection(
  sectionId: string,
): Promise<SiteActionResult<{ sectionId: string }>> {
  const parsed = uuidSchema.safeParse(sectionId);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  const auth = await memberCtx();
  if (!auth.ok) return auth;
  const { ctx } = auth;

  // Oryginał — zawężony do tenanta (RLS jest bramką; filtr to druga warstwa).
  const { data: original, error: readError } = await ctx.supabase
    .from("site_sections")
    .select("id, site_id, type, content_draft, enabled, position")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", parsed.data)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  if (!original) return { ok: false, error: "Nie znaleziono sekcji." };

  // Komplet sekcji strony w kolejności — do limitu i do przenumerowania niżej.
  const { data: siblings, error: siblingsError } = await ctx.supabase
    .from("site_sections")
    .select("id")
    .eq("tenant_id", ctx.tenantId)
    .eq("site_id", original.site_id)
    .order("position", { ascending: true })
    .order("id", { ascending: true });
  if (siblingsError) return { ok: false, error: siblingsError.message };
  if ((siblings?.length ?? 0) >= MAX_SECTIONS) {
    return { ok: false, error: "Strona osiągnęła maksymalną liczbę sekcji." };
  }

  // Kopia: ten sam typ i enabled, content_draft skopiowany 1:1. content_published
  // celowo NIE ustawiane — domyślny NULL czyni kopię nieopublikowaną. Pozycja jest
  // tymczasowa (original+1); ostateczny porządek nadaje przenumerowanie niżej.
  const { data: created, error: insertError } = await ctx.supabase
    .from("site_sections")
    .insert({
      tenant_id: ctx.tenantId,
      site_id: original.site_id,
      type: original.type,
      content_draft: original.content_draft,
      enabled: original.enabled,
      position: original.position + 1,
    })
    .select("id")
    .single();
  // 23503 = FK złożony (site spoza tenanta — ADR-019) zamieniony na czytelną odmowę.
  if (insertError || !created) {
    return {
      ok: false,
      error:
        insertError?.code === "23503"
          ? "Nie znaleziono strony."
          : (insertError?.message ?? "Nie udało się zduplikować sekcji."),
    };
  }
  const newId = created.id as string;

  // Przenumerowanie: kopia ląduje tuż za oryginałem, reszta zachowuje kolejność.
  // Seria UPDATE-ów (przejściowe duplikaty position legalne — 0019); częściowa
  // awaria psuje najwyżej kolejność (odwracalną kolejnym reorderem), nie treść.
  const order = (siblings ?? []).map((row) => row.id as string);
  order.splice(order.indexOf(original.id as string) + 1, 0, newId);
  const now = new Date().toISOString();
  for (let position = 0; position < order.length; position++) {
    const { error } = await ctx.supabase
      .from("site_sections")
      .update({ position, updated_at: now })
      .eq("tenant_id", ctx.tenantId)
      .eq("site_id", original.site_id)
      .eq("id", order[position]);
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath("/", "layout");
  return { ok: true, sectionId: newId };
}

/**
 * Zmiana szablonu strony — OPERACJA SZKICU (ADR-091). Do 0045 szablon był
 * kolumną WSPÓLNĄ: przełączenie „classic ↔ bold" przemalowywało stronę klienta
 * natychmiast (akcja unieważniała nawet cache storefrontu, żeby zmiana była
 * widoczna od razu). Odtąd pisze do `sites.template`, a publiczny odczyt bierze
 * `template_published` — więc szablon wchodzi na żywą stronę razem z resztą,
 * przy publikacji.
 */
export async function updateTemplate(
  siteId: string,
  template: string,
): Promise<SiteActionResult> {
  const parsed = updateTemplateInputSchema.safeParse({ siteId, template });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Nieprawidłowy szablon." };
  }
  const auth = await memberCtx();
  if (!auth.ok) return auth;
  const { ctx } = auth;

  const { data, error } = await ctx.supabase
    .from("sites")
    .update({ template: parsed.data.template })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", parsed.data.siteId)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "Nie znaleziono strony." };

  revalidatePath("/", "layout");
  // BEZ revalidateTag: opublikowana strona się nie zmieniła, więc unieważnianie
  // cache storefrontu byłoby kłamstwem o zmianie (i jedynym miejscem w panelu,
  // które ruszałoby publiczny cache poza publikacją).
  return { ok: true };
}

/**
 * Publikacja strony: atomowa kopia content_draft→content_published wszystkich
 * sekcji + sites.published_at — w RPC app.publish_site (SECURITY INVOKER,
 * bramką jest RLS; PostgREST nie umie `set kolumna = kolumna`). Po sukcesie
 * unieważnia cache storefrontu tagiem tenanta (kontrakt ADR-041).
 */
export async function publishSite(
  siteId: string,
): Promise<SiteActionResult<{ publishedAt: string }>> {
  const parsed = uuidSchema.safeParse(siteId);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  const auth = await memberCtx();
  if (!auth.ok) return auth;
  const { ctx } = auth;

  const { data, error } = await ctx.supabase
    .schema("app")
    .rpc("publish_site", { p_site_id: parsed.data });
  if (error || !data) {
    // 22023 = site_not_found (nieistniejąca ALBO cudza strona — celowo nieodróżnialne).
    return {
      ok: false,
      error: error?.code === "22023" ? "Nie znaleziono strony." : (error?.message ?? "Publikacja nie powiodła się."),
    };
  }

  revalidatePath("/", "layout");
  // Kontrakt ADR-041: publikacja emituje tag tenanta ("max" = natychmiast).
  revalidateTag(tenantCacheTag(auth.tenantId), "max");
  return { ok: true, publishedAt: data as string };
}
