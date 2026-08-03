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

import {
  starterPhoto,
  starterTemplateCanvases,
  starterTemplatePhotoSlots,
  starterTemplateTheme,
  tenantCacheTag,
  type StarterTemplate,
} from "@avably/core/site";

import { triggerUnsplashDownload } from "@/lib/unsplash";

import { AuthError } from "@/lib/auth";
import {
  applyStarterTemplateInputSchema,
  reorderPlan,
  reorderSectionsInputSchema,
  toggleSectionInputSchema,
  updateSiteStyleInputSchema,
  upsertSectionInputSchema,
  MAX_SECTIONS,
  type ApplyStarterTemplateInput,
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
 * ZAPIS STYLU STRONY — motyw, akcent i para fontów (K5, ADR-090).
 *
 * Pisze WYŁĄCZNIE do `style_draft`, dokładnie tak, jak edycja sekcji pisze
 * wyłącznie do `content_draft` (ADR-091: publikacja jedyną bramką). Publiczny
 * wygląd zmienia dopiero publikacja, która kopiuje styl tą samą transakcją co
 * treść (0046).
 */
export async function updateSiteStyle(
  siteId: string,
  style: unknown,
): Promise<SiteActionResult> {
  const parsed = updateSiteStyleInputSchema.safeParse({ siteId, style });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Nieprawidłowy styl strony." };
  }
  const auth = await memberCtx();
  if (!auth.ok) return auth;
  const { ctx } = auth;

  const { data, error } = await ctx.supabase
    .from("sites")
    .update({ style_draft: parsed.data.style })
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
 * SZABLON STARTOWY — GOTOWA STRONA DO SZKICU (K5, ADR-090 na kanonie ADR-091).
 *
 * Operacja jest DESTRUKCYJNA dla szkicu i interfejs musi ją potwierdzić. Dla
 * strony OPUBLIKOWANEJ nie jest destrukcyjna wcale — i to jest różnica, którą
 * przyniosło ADR-091.
 *
 * DLACZEGO USUNIĘCIE I WSTAWIENIE, A NIE NADPISANIE W MIEJSCU. Typ sekcji jest
 * NIEZMIENNY (patrz upsertSection: treść published starego typu nie może wisieć
 * pod nowym typem do następnej publikacji). Szablon startowy przynosi własną
 * sekwencję typów, która z zastaną nie ma powodu się pokrywać — nadpisanie
 * w miejscu byłoby więc możliwe tylko tam, gdzie typy przypadkiem się zgadzają,
 * a to jest gorsze niż jedna jasna zasada.
 *
 * USUNIĘCIE IDZIE NAGROBKIEM, NIE KASOWANIEM WIERSZA. Do 0045 ta akcja
 * kasowała komplet sekcji, więc zastosowanie szablonu ZDEJMOWAŁO sekcje z żywej
 * strony natychmiast — mimo że nowe sekcje wchodziły wyłącznie do szkicu.
 * Operator, który chciał obejrzeć inny szablon, gasił sobie sklep. Odtąd:
 *
 *   • sekcja stojąca na żywej stronie dostaje `deleted_in_draft = true` —
 *     wiersz zostaje, klient dalej ją widzi, a znika dopiero przy publikacji;
 *   • sekcja NIGDY nieopublikowana jest kasowana (nagrobek na takiej sekcji
 *     jest zabroniony CHECK-iem 0045: nie ma czego chronić).
 *
 * Publikacja pozostaje więc jedyną bramką Z KONSTRUKCJI, a nie z uprzejmości
 * tego kodu: żadna linijka niżej nie dotyka kolumn `*_published`, a strażnik
 * bazy (ADR-091) i tak by na to nie pozwolił.
 *
 * MOTYW WCHODZI RAZEM ZE STRONĄ. Wybór szablonu JEST wyborem świata wizualnego
 * (ADR-090), więc ta sama akcja zapisuje motyw do `style_draft`. Gdyby motyw
 * szedł osobnym wywołaniem, istniałby stan pośredni „treść nowa, wygląd stary",
 * a operator zobaczyłby przez chwilę stronę, której nikt nie zaprojektował.
 *
 * WYZWALACZ POBRANIA — WARUNEK LICENCJI, nie telemetria. Dostawca zdjęć wymaga
 * wywołania `download_location` w chwili UŻYCIA kadru; szablon startowy używa
 * kilkunastu naraz. Wywołania idą po zapisie i NIE blokują odpowiedzi: ich
 * niepowodzenie nie może cofnąć zastosowanego szablonu, bo to nie jest warunek
 * poprawności treści, tylko zobowiązanie wobec dostawcy.
 */
export async function applyStarterTemplate(
  input: ApplyStarterTemplateInput,
): Promise<SiteActionResult<{ sectionIds: string[] }>> {
  const parsed = applyStarterTemplateInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Nieprawidłowy szablon startowy." };
  }
  const auth = await memberCtx();
  if (!auth.ok) return auth;
  const { ctx } = auth;
  const { siteId, starterId, locale } = parsed.data;

  const sections = starterTemplateCanvases(starterId, locale);
  if (sections.length > MAX_SECTIONS) {
    return { ok: false, error: "Szablon startowy ma za dużo sekcji." };
  }

  // Zawężenie do (tenant, site) jest drugą warstwą — bramką izolacji zostaje
  // RLS (0019). Szablon ZASTĘPUJE stronę, więc zastane sekcje schodzą ze szkicu
  // w komplecie; rozstrzygnięcie „nagrobek czy kasowanie" idzie po tym, czy
  // sekcja stoi na żywej stronie (ADR-091).
  const { data: existing, error: readError } = await ctx.supabase
    .from("site_sections")
    .select("id, content_published")
    .eq("tenant_id", ctx.tenantId)
    .eq("site_id", siteId);
  if (readError) return { ok: false, error: readError.message };

  const published = (existing ?? []).filter((row) => row.content_published !== null).map((row) => row.id as string);
  const drafts = (existing ?? []).filter((row) => row.content_published === null).map((row) => row.id as string);

  if (published.length > 0) {
    const { error } = await ctx.supabase
      .from("site_sections")
      .update({ deleted_in_draft: true, updated_at: new Date().toISOString() })
      .eq("tenant_id", ctx.tenantId)
      .eq("site_id", siteId)
      .in("id", published);
    if (error) return { ok: false, error: error.message };
  }
  if (drafts.length > 0) {
    const { error } = await ctx.supabase
      .from("site_sections")
      .delete()
      .eq("tenant_id", ctx.tenantId)
      .eq("site_id", siteId)
      .in("id", drafts);
    if (error) return { ok: false, error: error.message };
  }

  // Wstawienie jednym zapytaniem: częściowo zastosowany szablon (kilka sekcji
  // weszło, reszta nie) zostawiłby stronę-hybrydę, której operator nie umie
  // odróżnić od własnej pracy. content_published celowo NIE ustawiane —
  // domyślny NULL czyni każdą wstawioną sekcję nieopublikowaną.
  const { data: created, error: insertError } = await ctx.supabase
    .from("site_sections")
    .insert(
      sections.map((section, position) => ({
        tenant_id: ctx.tenantId,
        site_id: siteId,
        type: section.type,
        content_draft: section.content,
        position,
        enabled: true,
      })),
    )
    .select("id");
  if (insertError || !created) {
    return {
      ok: false,
      error:
        insertError?.code === "23503"
          ? "Nie znaleziono strony."
          : (insertError?.message ?? "Nie udało się zastosować szablonu startowego."),
    };
  }

  // Motyw szablonu do SZKICU stylu — jedno wywołanie, ta sama operacja co treść.
  const { error: styleError } = await ctx.supabase
    .from("sites")
    .update({ style_draft: { theme: starterTemplateTheme(starterId) } })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", siteId);
  if (styleError) return { ok: false, error: styleError.message };

  // Wyzwalacz pobrania per kadr — po zapisie, bez blokowania odpowiedzi.
  void triggerStarterPhotoDownloads(starterId);

  revalidatePath("/", "layout");
  return { ok: true, sectionIds: created.map((row) => row.id as string) };
}

/**
 * Wywołanie `download_location` dla KAŻDEGO kadru szablonu (wymóg regulaminu
 * dostawcy — z tych wywołań liczą się statystyki autora zdjęcia).
 *
 * Świadomie NIE `await` w akcji: pojedyncze wywołanie bywa wolne, a operator ma
 * zobaczyć stronę od razu. Wyodrębnione do funkcji, żeby dało się je podmienić
 * atrapą w teście — inaczej „szablon odpala wyzwalacz" byłoby zdaniem, którego
 * nikt nie sprawdza.
 */
export async function triggerStarterPhotoDownloads(starterId: StarterTemplate): Promise<void> {
  await Promise.all(
    starterTemplatePhotoSlots(starterId).map(async (slot) => {
      const photo = starterPhoto(slot);
      if (photo?.kind === "unsplash") await triggerUnsplashDownload(photo.downloadLocation);
    }),
  );
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
