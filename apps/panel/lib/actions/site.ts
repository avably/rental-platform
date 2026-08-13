"use server";

/**
 * Akcje modelu sekcyjnego storefrontu (Zadanie 2.3a, ADR-041) — WARSTWA LOGIKI
 * dla edytora 2.3b (UI powstaje osobno).
 *
 * PUBLIKACJA JEST JEDYNĄ BRAMKĄ (ADR-091, migracja 0045). Każda akcja z tego
 * pliku poza `publishSite` pisze WYŁĄCZNIE do kolumn SZKICU
 * (`content_draft`, `position`, `enabled`, `tenants.style_draft`,
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
  HOME_PAGE_SLUG,
  normalizeSectionOrder,
  orderWithSectionBefore,
  starterPhoto,
  starterTemplateContents,
  starterTemplatePhotoSlots,
  starterTemplateTheme,
  tenantCacheTag,
  type SectionType,
  type StarterTemplate,
} from "@avably/core/site";

import { triggerUnsplashDownload } from "@/lib/unsplash";

import { AuthError } from "@/lib/auth";
import {
  applyStarterTemplateInputSchema,
  reorderPlan,
  reorderSectionsInputSchema,
  toggleSectionInputSchema,
  updateStoreStyleInputSchema,
  upsertSectionInputSchema,
  createSiteInputSchema,
  renameSiteInputSchema,
  hasHomePage,
  MAX_SECTIONS,
  MAX_SITES,
  type ApplyStarterTemplateInput,
  type CreateSiteInput,
  type RenameSiteInput,
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
 * NOWA WERSJA STRONY (0048, ADR-093).
 *
 * Do 0047 stało tu `ensureSite()`: strona powstawała jako SKUTEK UBOCZNY
 * wejścia w zakładkę, bo mogła być tylko jedna. Przy wielu wersjach taki
 * automat jest nie do obronienia — operator dostawałby wersję, o którą nie
 * prosił, przy każdym kliknięciu w menu. Tworzenie jest odtąd jawnym
 * czasownikiem, a pusta lista pokazuje stan pusty z przyciskiem.
 *
 * Wersja rodzi się NIEŻYWA: `published_at` zostaje NULL, bo jego zapis jest
 * zastrzeżony dla `app.publish_site` (strażnik 0045 odpowiada 42501). Czyli
 * nowa wersja nie ma jak urodzić się publiczna nawet przez pomyłkę.
 *
 * STRONA GŁÓWNA POWSTAJE TĄ SAMĄ DROGĄ (ADR-168), bez klucza `slug`. Onboarding
 * jej NIE zasiewa (`app.create_tenant`, ostatnia definicja w 0070, tworzy
 * najemcę, członkostwo, dowód akceptacji regulaminu i subdomenę — ani jednego
 * wiersza `sites`), więc to jest jedyne miejsce w systemie, w którym korzeń
 * sklepu w ogóle może się pojawić.
 */
export async function createSite(
  input: CreateSiteInput,
): Promise<SiteActionResult<{ siteId: string }>> {
  const parsed = createSiteInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Nieprawidłowa nazwa strony." };
  }
  const auth = await memberCtx();
  if (!auth.ok) return auth;
  const { ctx } = auth;

  // Limit liczony ze STANU BAZY, nie z listy przekazanej przez klienta
  // (lekcja wyścigu z K6-delty): dwa szybkie kliknięcia „Nowa strona" nie mają
  // jak przekroczyć limitu, bo każde z nich liczy od nowa.
  const { count, error: countError } = await ctx.supabase
    .from("sites")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", ctx.tenantId);
  if (countError) return { ok: false, error: countError.message };
  if ((count ?? 0) >= MAX_SITES) {
    return { ok: false, error: `Sklep może mieć najwyżej ${MAX_SITES} stron.` };
  }

  // ADRES od razu przy zakładaniu (Faza 2, 0073): strona bez podanego adresu
  // jest STRONĄ GŁÓWNĄ — to samo, czym wiersz `sites` był do 0072.
  const slug = parsed.data.slug ?? HOME_PAGE_SLUG;

  /*
   * STRONA GŁÓWNA MOŻE BYĆ JEDNA — ZAWĘŻENIE, NIE ZAKAZ (ADR-168).
   *
   * Do tej poprawki panel bronił się przed drugą stroną główną zakazem
   * w schemacie: pusty adres nie przechodził NIGDY. Zakaz był po właściwej
   * stronie ryzyka (druga strona główna pada dopiero na publikacji, przez
   * 23505, już po zbudowaniu treści), ale bronił też przed PIERWSZĄ — a nowy
   * najemca ma zero stron, więc korzeń jego sklepu zostawał pusty na zawsze.
   *
   * Warunek jest odtąd stanem BAZY, a nie kształtem wejścia, i dlatego stoi
   * tutaj, a nie w Zodzie. Odczyt jest w tej samej roli co limit `MAX_SITES`:
   * UPRZEDZA odmowę zdaniem, którym operator umie się posłużyć. Bramką
   * zostaje unikat `sites_live_slug_unique_idx` — dwie żywe strony pod `/`
   * są niereprezentowalne niezależnie od tego kodu, także dla surowego
   * PostgREST-a, który tego odczytu nie wykona.
   */
  if (slug === HOME_PAGE_SLUG) {
    const { data: pages, error: pagesError } = await ctx.supabase
      .from("sites")
      .select("slug, slug_published")
      .eq("tenant_id", ctx.tenantId);
    if (pagesError) return { ok: false, error: pagesError.message };
    if (
      hasHomePage(
        (pages ?? []).map((page) => ({
          slug: page.slug as string,
          slugPublished: page.slug_published as string | null,
        })),
      )
    ) {
      return {
        ok: false,
        error:
          "Sklep ma już stronę główną — pod adresem „/” może stać tylko jedna. Otwórz ją w kreatorze albo utwórz stronę pod własnym adresem.",
      };
    }
  }

  const { data: created, error } = await ctx.supabase
    .from("sites")
    .insert({
      tenant_id: ctx.tenantId,
      name: parsed.data.name,
      slug,
    })
    .select("id")
    .single();
  if (error || !created) {
    return { ok: false, error: siteWriteError(error, "Nie udało się utworzyć strony.") };
  }

  // BEZ revalidateTag: nowa wersja jest nieżywa, więc sklep się nie zmienił.
  revalidatePath("/", "layout");
  return { ok: true, siteId: created.id as string };
}

/**
 * Zmiana NAZWY i ADRESU strony.
 *
 * Nazwa jest daną wyłącznie szkicową (sklep jej nie widzi). Adres NIE JEST:
 * jest tym, co klient ma w pasku. Dlatego zapis idzie do kolumny SZKICU
 * (`slug`), a żywy adres zmienia się dopiero publikacją — bliźniak
 * `slug_published` pisze wyłącznie `app.publish_site` (0073, ADR-091/157).
 * Operator ma więc dokładnie jedno miejsce, w którym adres wchodzi do sklepu,
 * i dokładnie jeden moment, w którym trzeba wystawić przekierowanie.
 */
export async function renameSite(input: RenameSiteInput): Promise<SiteActionResult> {
  const parsed = renameSiteInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Nieprawidłowa nazwa strony." };
  }
  const auth = await memberCtx();
  if (!auth.ok) return auth;
  const { ctx } = auth;

  const { data, error } = await ctx.supabase
    .from("sites")
    .update({
      name: parsed.data.name,
      // Brak sluga w wejściu = „nie ruszaj adresu" (strona główna nie ma
      // adresu do zmiany). `undefined` nie trafia do zapytania PostgREST.
      ...(parsed.data.slug === undefined ? {} : { slug: parsed.data.slug }),
      ...(parsed.data.redirectOldSlug === undefined
        ? {}
        : { redirect_old_slug: parsed.data.redirectOldSlug }),
    })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", parsed.data.siteId)
    .select("id");
  if (error) return { ok: false, error: siteWriteError(error, error.message) };
  if ((data ?? []).length === 0) return { ok: false, error: "Nie znaleziono strony." };

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Tłumaczenie odmów BAZY na zdania dla operatora (Faza 2, 0073/0074).
 *
 * 22023 przychodzi z triggera `sites_slug_guard` i NIESIE ADRES, o który
 * chodzi — dlatego idzie wprost, bez przepisywania. 23505 to unikat żywego
 * adresu: publikacja pod adresem, który ma już inna żywa strona.
 */
function siteWriteError(
  error: { code?: string; message: string } | null,
  fallback: string,
): string {
  if (!error) return fallback;
  if (error.code === "22023") return error.message;
  if (error.code === "23505") {
    return "Inna opublikowana strona ma już ten adres. Zmień adres jednej z nich.";
  }
  return error.message || fallback;
}

/**
 * USUNIĘCIE WERSJI STRONY (0048, ADR-093).
 *
 * Twardy DELETE, bez nagrobków — i to jest poprawne dokładnie dlatego, że
 * usunąć da się wyłącznie wersję NIEŻYWĄ. Strona z `published_at is null` nie
 * wnosi do `app.get_published_site` ani jednego bajtu, więc nie ma czego
 * chronić; nagrobki bronią treści STOJĄCEJ NA ŻYWEJ STRONIE.
 *
 * Sprawdzenia „czy żywa" NIE MA w tej akcji i to też jest świadome: robi je
 * trigger `sites_guard_live_delete` (42501). Warunek w kodzie panelu byłby
 * drugą prawdą o tej samej regule — i tą słabszą, bo omijalną.
 */
export async function deleteSite(siteId: string): Promise<SiteActionResult> {
  const parsed = uuidSchema.safeParse(siteId);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  const auth = await memberCtx();
  if (!auth.ok) return auth;
  const { ctx } = auth;

  const { data, error } = await ctx.supabase
    .from("sites")
    .delete()
    .eq("tenant_id", ctx.tenantId)
    .eq("id", parsed.data)
    .select("id");
  if (error) {
    /*
     * 42501 = strażnik żywej strony. Odmowa dostaje własny komunikat, bo
     * operator ma usłyszeć, CO zrobić, a nie „brak uprawnień".
     *
     * ZDANIE WSKAZUJE DROGĘ, KTÓRA ISTNIEJE (ADR-170). Do 0078 stało tu
     * „Najpierw opublikuj inną" — rada prawdziwa do 0073, gdy publikacja
     * PRZEŁĄCZAŁA żywą stronę. Od 0074 strony współistnieją, więc operator
     * wykonywał polecenie i wracał dokładnie w to samo miejsce.
     */
    return {
      ok: false,
      error:
        error.code === "42501"
          ? "Tej strony nie można usunąć, bo widzą ją klienci. Najpierw zdejmij ją ze sklepu."
          : error.message,
    };
  }
  if ((data ?? []).length === 0) return { ok: false, error: "Nie znaleziono strony." };

  // BEZ revalidateTag: usunięta wersja była nieżywa, więc sklep się nie zmienił.
  revalidatePath("/", "layout");
  return { ok: true };
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
  const { siteId, sectionId, type, content, position, insertBefore, enabled } = parsed.data;

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

  /*
   * SEKCJA PRZYPIĘTA MUSI ZOSTAĆ OSTATNIA JUŻ TU (K6-delta, ADR-092),
   * A ŚWIEŻA SEKCJA MA STANĄĆ TAM, GDZIE OPERATOR KLIKNĄŁ „+" (E2).
   *
   * Wstawka idzie na `max(position) + 1`, czyli POD STOPKĘ. Do delty prostował
   * to dopiero krok drugi po stronie klienta (`reorderSections` z kompletem
   * pozycji) — a ten krok bywa przegrany: dwa szybkie kliknięcia puszczają dwa
   * zapisy w locie (zapisy strukturalne przestały blokować kreator w #172),
   * więc drugi reorder liczy plan na stanie klienta, który nie zna sekcji
   * dodanej przez pierwszy. Efekt zgłoszony przez PM: obie nowe sekcje trwale
   * pod stopką w szkicu, do najbliższej operacji strukturalnej.
   *
   * E2 idzie tą samą drogą do końca: kroku drugiego NIE MA WCALE. Miejsce
   * wstawienia przyjeżdża od klienta jako SĄSIAD (`insertBefore`), a układa je
   * to samo przenumerowanie ze STANU BAZY — czyli z listy, która zna także
   * sekcje dodane sekundę wcześniej przez inne kliknięcie.
   */
  const placed = await renumberFromDatabase(ctx, siteId, {
    id: created.id as string,
    before: insertBefore,
  });
  if (!placed.ok) return placed;

  revalidatePath("/", "layout");
  return { ok: true, sectionId: created.id as string };
}

/**
 * PRZENUMEROWANIE POZYCJI ZE STANU BAZY (K6-delta, ADR-092; miejsce wstawienia
 * — E2).
 *
 * Jedno miejsce, w którym powstaje kolejność zapisana, gdy wołający nie ma
 * własnego zdania o niej (wstawka). Czyta komplet sekcji strony PRAWDZIWY
 * w chwili wywołania, przepuszcza go przez `normalizeSectionOrder` (sekcje
 * przypięte na koniec) i zapisuje pozycje.
 *
 * `place` opisuje ŚWIEŻĄ sekcję: dokąd ma trafić względem SĄSIADA. Kotwica jest
 * rozwiązywana tutaj, na liście z bazy — dlatego dwa wstawienia w locie nie
 * przeszkadzają sobie nawzajem, a kotwica, której już nie ma, degraduje do
 * końca treści zamiast wywracać zapis.
 *
 * Dlaczego to nie jest to samo, co normalizacja w `reorderSections`: tam
 * kolejność ZWYKŁYCH sekcji przychodzi od operatora i ma zostać uszanowana;
 * tutaj szanujemy wyłącznie kolejność zastaną plus jedno wskazane miejsce.
 * Wspólna funkcja z parametrem „czyja kolejność" odpowiadałaby na dwa różne
 * pytania naraz.
 */
async function renumberFromDatabase(
  ctx: Ctx,
  siteId: string,
  place?: { id: string; before?: string },
): Promise<SiteActionResult> {
  const { data, error } = await ctx.supabase
    .from("site_sections")
    .select("id, type, position")
    .eq("tenant_id", ctx.tenantId)
    .eq("site_id", siteId)
    .order("position", { ascending: true })
    .order("id", { ascending: true });
  if (error) return { ok: false, error: error.message };

  const known = (data ?? []).map((row) => ({
    id: row.id as string,
    type: row.type as SectionType,
    position: row.position as number,
  }));
  const zastana = known.map((row) => row.id);
  const ordered = normalizeSectionOrder(
    place ? orderWithSectionBefore(zastana, place.id, place.before) : zastana,
    known,
  );

  // Piszemy WYŁĄCZNIE wiersze, których pozycja naprawdę się zmienia — przy
  // stronie już poprawnej ta funkcja nie robi ani jednego zapytania zapisu.
  const now = new Date().toISOString();
  for (const [position, id] of ordered.entries()) {
    if (known.find((row) => row.id === id)?.position === position) continue;
    const { error: writeError } = await ctx.supabase
      .from("site_sections")
      .update({ position, updated_at: now })
      .eq("tenant_id", ctx.tenantId)
      .eq("site_id", siteId)
      .eq("id", id);
    if (writeError) return { ok: false, error: writeError.message };
  }
  return { ok: true };
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
    .select("id, type")
    .eq("tenant_id", ctx.tenantId)
    .eq("site_id", parsed.data.siteId);
  if (readError) return { ok: false, error: readError.message };

  /*
   * PRZYPIĘCIE STOPKI JEST NORMALIZACJĄ, NIE ODMOWĄ (K6, ADR-092).
   *
   * Kolejność ze stopką w środku strony nie jest atakiem ani błędem klienta —
   * bywa zwykłym skutkiem przeciągnięcia sekcji pod nią. Odrzucenie zapisu
   * zostawiłoby operatora z komunikatem zamiast wyniku; normalizacja daje mu
   * dokładnie to, co widział na płótnie: sekcję NAD stopką.
   *
   * Reguła stoi po stronie SERWERA, a nie tylko w płótnie, bo płótno jest jedną
   * z dróg zapisu, nie jedyną — klient, który wyśle kolejność własnym żądaniem,
   * ma dostać stronę z tym samym niezmiennikiem.
   */
  const known = (current ?? []).map((row) => ({
    id: row.id as string,
    type: row.type as SectionType,
  }));

  /*
   * ŻĄDANIE NIEPEŁNE TO WYŚCIG, NIE BŁĄD — ŻĄDANIE OBCE TO BŁĄD (K6-delta).
   *
   * Do delty bramką był `reorderPlan(komplet, żądanie)`, czyli wymóg DOKŁADNEJ
   * permutacji. To odrzucało jednym komunikatem dwa różne zdarzenia:
   *
   *   • sekcję, której klient nie mógł znać, bo powstała po jego odczycie (dwa
   *     `addSection` w locie) — zdarzenie NORMALNE, a odmowa zostawiała świeżą
   *     sekcję na `max(position) + 1`, czyli POD STOPKĄ, na stałe;
   *   • identyfikator spoza tej strony — zdarzenie, które ma zostać odmówione
   *     (macierz izolacji: reorder cudzej strony nie ma prawa się udać).
   *
   * Rozdzielamy je: nieznany identyfikator = odmowa (dla cudzej strony komplet
   * znanych jest PUSTY, więc odmowa izolacji zostaje bez zmian), identyfikator
   * BRAKUJĄCY = uzupełnienie ze stanu bazy. Uzupełnia `normalizeSectionOrder`,
   * dopisując nieznane klientowi sekcje w kolejności kompletu — i, jak zawsze,
   * przypięte na koniec.
   */
  if (new Set(parsed.data.orderedIds).size !== parsed.data.orderedIds.length) {
    return { ok: false, error: "Kolejność zawiera zduplikowane sekcje." };
  }
  const knownIds = new Set(known.map((row) => row.id));
  if (parsed.data.orderedIds.some((id) => !knownIds.has(id))) {
    return { ok: false, error: "Kolejność obejmuje sekcje spoza tej strony — odśwież edytor." };
  }

  const plan = reorderPlan(
    known.map((row) => row.id),
    normalizeSectionOrder(parsed.data.orderedIds, known),
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
  // TYP jedzie razem z identyfikatorem, bo przenumerowanie musi wiedzieć, które
  // sekcje są PRZYPIĘTE (K6-delta, ADR-092).
  const { data: siblings, error: siblingsError } = await ctx.supabase
    .from("site_sections")
    .select("id, type")
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
          : // 23505 = unikat jednej ŻYWEJ stopki (0047). Duplikat stopki jest
            // niereprezentowalny z definicji, więc odmowa ma to powiedzieć.
            insertError?.code === "23505"
            ? "Strona może mieć tylko jedną stopkę."
            : (insertError?.message ?? "Nie udało się zduplikować sekcji."),
    };
  }
  const newId = created.id as string;

  // Przenumerowanie: kopia ląduje tuż za oryginałem, reszta zachowuje kolejność,
  // a sekcje PRZYPIĘTE i tak schodzą na koniec (K6-delta) — duplikat sekcji
  // stojącej tuż nad stopką nie ma prawa wylądować pod nią.
  // Seria UPDATE-ów (przejściowe duplikaty position legalne — 0019); częściowa
  // awaria psuje najwyżej kolejność (odwracalną kolejnym reorderem), nie treść.
  const rodzenstwo = (siblings ?? []).map((row) => ({
    id: row.id as string,
    type: row.type as SectionType,
  }));
  const wanted = rodzenstwo.map((row) => row.id);
  wanted.splice(wanted.indexOf(original.id as string) + 1, 0, newId);
  const order = normalizeSectionOrder(wanted, [
    ...rodzenstwo,
    { id: newId, type: original.type as SectionType },
  ]);
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
 * ZAPIS STYLU SKLEPU — motyw, akcent i para krojów (K5, ADR-090; poziom
 * NAJEMCY od ADR-161).
 *
 * ARGUMENTU ZE STRONĄ TU NIE MA I TO JEST CAŁA ZMIANA ADR-161. Do fazy 2
 * wiersz `sites` był WERSJĄ jednej strony, więc „styl wersji" i „styl sklepu"
 * znaczyły to samo. Odkąd wiersze są osobnymi STRONAMI, ten sam zapis znaczyłby
 * „inny wygląd na każdej podstronie" — czyli nagłówek zmieniający krój przy
 * przejściu z „O nas" na „Kontakt".
 *
 * Zapis idzie do kolumny SZKICU najemcy, dokładnie tak, jak edycja sekcji pisze
 * wyłącznie do `content_draft` (ADR-091: publikacja jedyną bramką). Drogą jest
 * RPC `app.set_tenant_style`, bo członek nie ma UPDATE na `tenants` (RLS
 * przepuszcza tam wyłącznie superadmina) — zapis wprost skończyłby się CICHYM
 * „zero wierszy", bez błędu i bez koloru.
 */
export async function updateStoreStyle(style: unknown): Promise<SiteActionResult> {
  const parsed = updateStoreStyleInputSchema.safeParse({ style });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Nieprawidłowy styl sklepu." };
  }
  const auth = await memberCtx();
  if (!auth.ok) return auth;
  const { ctx } = auth;

  const { error } = await ctx.supabase
    .schema("app")
    .rpc("set_tenant_style", { p_style: parsed.data.style });
  if (error) {
    return {
      ok: false,
      error: error.code === "22023" ? "Nie można zapisać wyglądu sklepu." : error.message,
    };
  }

  revalidatePath("/", "layout");
  // BEZ revalidateTag: opublikowany wygląd się nie zmienił, więc unieważnianie
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

  const sections = starterTemplateContents(starterId, locale);
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

  /*
   * Motyw szablonu do SZKICU stylu NAJEMCY (ADR-161) — jedno wywołanie, ta sama
   * operacja co treść. Zapis jest CAŁKOWITY (`{ theme }`, bez akcentu i pary
   * krojów), dokładnie jak przed ADR-161: wybór szablonu startowego JEST
   * wyborem świata wizualnego, więc zastany akcent z innej palety zostawiony
   * na miejscu byłby kolorem, którego nikt w nowym motywie nie policzył.
   *
   * Skutek jest odtąd SKLEPOWY, a nie stronowy, i to jest właśnie żądana
   * zmiana: szablon wybrany na jednej stronie przemalowuje cały sklep.
   */
  const { error: styleError } = await ctx.supabase
    .schema("app")
    .rpc("set_tenant_style", { p_style: { theme: starterTemplateTheme(starterId) } });
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
 *
 * WYGLĄD SKLEPU IDZIE DRUGIM WYWOŁANIEM (ADR-161). Od przeniesienia stylu na
 * poziom najemcy publikacja ma dwa przedmioty: treść TEJ strony i wygląd
 * CAŁEGO sklepu. Drugi jedzie osobnym czasownikiem, bo `app.publish_site` jest
 * funkcją, którą w oknie wdrożeniowym woła STARY panel — dołożenie jej zdania
 * o tabeli `tenants` byłoby zmianą kontraktu pod działającym kodem.
 *
 * Cena jest jawna: to NIE jest jedna transakcja. Nieudane drugie wywołanie
 * zostawia stronę opublikowaną ze starym wyglądem — stan widoczny, opisany
 * komunikatem i naprawialny ponowną publikacją (operacja jest idempotentna).
 * Odwrotna kolejność byłaby gorsza: publikacja strony potrafi odmówić z powodu
 * biznesowego (zajęty adres, 23505), a wtedy wygląd wszedłby na żywo dla
 * operacji, która się nie odbyła.
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
    // 23505 = unikat ŻYWEGO ADRESU (0073): od 0074 publikacja nikogo nie gasi,
    // więc druga strona pod zajętym adresem jest ODMAWIANA, a nie po cichu
    // przełączana. Operator musi usłyszeć, co poprawić.
    if (error?.code === "23505") {
      return { ok: false, error: siteWriteError(error, "Publikacja nie powiodła się.") };
    }
    return {
      ok: false,
      error: error?.code === "22023" ? "Nie znaleziono strony." : (error?.message ?? "Publikacja nie powiodła się."),
    };
  }

  const { error: appearanceError } = await ctx.supabase
    .schema("app")
    .rpc("publish_tenant_appearance");

  revalidatePath("/", "layout");
  // Kontrakt ADR-041: publikacja emituje tag tenanta ("max" = natychmiast).
  // Tag leci TAKŻE przy nieudanym wyglądzie — treść strony weszła na żywo,
  // więc cache sklepu jest nieaktualny niezależnie od drugiego wywołania.
  revalidateTag(tenantCacheTag(auth.tenantId), "max");

  if (appearanceError) {
    return {
      ok: false,
      error:
        "Strona została opublikowana, ale wygląd sklepu nie — opublikuj jeszcze raz.",
    };
  }

  return { ok: true, publishedAt: data as string };
}

/**
 * ZDJĘCIE STRONY ZE SKLEPU (0078, ADR-170) — druga, po publikacji, jawna droga
 * zmiany tego, co widzi klient.
 *
 * Do tej akcji takiej drogi NIE BYŁO: `published_at` zerowało wyłącznie zdanie
 * gaszące w `app.publish_site`, a migracja 0074 to zdanie usunęła. Strona
 * opublikowana przez pomyłkę zostawała w sklepie na zawsze — usunąć jej nie
 * pozwalał (słusznie) trigger `sites_guard_live_delete`, a jego rada „najpierw
 * opublikuj inną" od 0074 nie zmienia w statusie tej strony ani jednego bitu.
 *
 * ZAPIS IDZIE RPC, NIE Z PANELU. `published_at` jest na liście strażnika
 * kolumn opublikowanych (0045), więc UPDATE stąd odbiłby się o 42501 — i tak
 * ma być. Flagę transakcyjną podnosi `app.unpublish_site`, dokładnie jak
 * publikacja.
 *
 * TAG CACHE LECI: w przeciwieństwie do utworzenia i usunięcia strony NIEŻYWEJ,
 * ta operacja zmienia sklep — adres, który przed chwilą oddawał stronę, oddaje
 * odtąd 404 (kontrakt ADR-041).
 */
export async function unpublishSite(siteId: string): Promise<SiteActionResult> {
  const parsed = uuidSchema.safeParse(siteId);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  const auth = await memberCtx();
  if (!auth.ok) return auth;
  const { ctx } = auth;

  const { error } = await ctx.supabase
    .schema("app")
    .rpc("unpublish_site", { p_site_id: parsed.data });
  if (error) {
    // 22023 = site_not_found (nieistniejąca ALBO cudza strona ALBO wygasłe
    // członkostwo — celowo nieodróżnialne, jak przy publikacji).
    return {
      ok: false,
      error:
        error.code === "22023"
          ? "Nie znaleziono strony."
          : (error.message ?? "Nie udało się zdjąć strony ze sklepu."),
    };
  }

  revalidatePath("/", "layout");
  revalidateTag(tenantCacheTag(auth.tenantId), "max");
  return { ok: true };
}
