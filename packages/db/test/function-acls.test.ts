/**
 * Bramka ACL funkcji app.* (0064, ADR-132) — konwencja W3 ze spike'u J2.
 *
 * FAKT, KTÓREGO TA BRAMKA PILNUJE: `create function` w PostgreSQL nadaje
 * EXECUTE roli PUBLIC domyślnie. Każda nowa funkcja w schemacie `app`
 * (wystawionym przez PostgREST) rodzi się więc wołalna publicznym kluczem
 * anon z przeglądarki — dopóki autor migracji nie zrobi
 * `revoke all on function ... from public` (konwencja w
 * docs/konwencje-migracji.md). Pamięć autora nie jest mechanizmem:
 * przed 0064 dziesięć funkcji (w tym app.superadmin_set_plan) niosło
 * EXECUTE dla PUBLIC latami i nikt tego nie widział.
 *
 * Jak bramka łapie NOWĄ funkcję domyślnie: introspekcja idzie po pg_proc
 * przez aclexplode(coalesce(proacl, acldefault(...))) — funkcja bez
 * jawnego ACL (proacl IS NULL) jest raportowana z PUBLIC, bo tak
 * rozstrzyga ją silnik, a nie dlatego, że ktoś ją dopisał do listy.
 * Dowodem jest test-przynęta: świeża funkcja z domyślnym ACL musi
 * zostać wykryta, inaczej pusta lista naruszeń byłaby dekoracją.
 *
 * Allowlista dotyczy WYŁĄCZNIE roli anon i wylicza publiczne RPC
 * storefrontu/checkoutu (SECURITY DEFINER z własnymi bramkami w środku).
 * Dla PUBLIC wyjątków nie ma i nie będzie: PUBLIC obejmuje każdą rolę,
 * także przyszłe, więc „wyjątek dla PUBLIC" to brak bramki.
 */
import { afterEach, describe, expect, it } from "vitest";
import postgres from "postgres";

import { integrationEnv } from "./helpers/integration-env";

const REQUIRED_ENV = ["SUPABASE_LOCAL_URL"] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

/**
 * Publiczne RPC wołalne rolą anon — każda pozycja to ŚWIADOMA decyzja
 * z własnej migracji (grant jawny, funkcja z wewnętrzną bramką: bilet
 * HMAC checkoutu, rate-limit, odczyt wyłącznie opublikowanych danych).
 * Nowa funkcja dla anon = nowy wpis TUTAJ + uzasadnienie w migracji.
 */
const ANON_EXECUTE_ALLOWLIST = [
  "attach_payment_intent", // 0029 — checkout: przypięcie intencji płatności (bramka: checkout_token)
  "check_rate_limit", // 0052 — licznik anti-abuse, sam jest mechanizmem obronnym
  "get_legal_document_version", // 0063 — permalink opublikowanej wersji dokumentu
  "get_platform_terms", // 0070 — żywa wersja regulaminu platformy (LP pokazuje umowę przed rejestracją)
  "get_platform_terms_version", // 0070 — permalink wersji regulaminu platformy (szkic nie wychodzi)
  "get_public_availability", // 0020 — publiczna dostępność produktu
  // 0081 — dostępność DZIENNA jednego sprzętu (ADR-179). anon z tego samego
  // powodu, co get_public_availability: siatka kalendarza maluje się
  // w przeglądarce klienta najemcy. Oddaje WYŁĄCZNIE liczby, izolacja stoi na
  // jawnym zawężeniu tenant_id w ciele (SECURITY DEFINER), a szerokość okna
  // ogranicza sufit w samej funkcji — pilnuje tego
  // public-availability-calendar.test.ts.
  "get_public_availability_days",
  "get_public_catalog", // 0020 — publiczny katalog aktywnego tenanta
  // 0081 — dostępność CAŁEGO katalogu w jednym wywołaniu (ADR-179). anon, bo
  // kafel katalogu pyta o dostępność tą samą drogą, co o sam katalog.
  "get_public_catalog_availability",
  // 0085 — JEDNA STRONA katalogu publicznego dla trasy /katalog (ADR-186).
  // anon z dokładnie tego samego powodu, co get_public_catalog, i o WĘŻSZYM
  // zakresie: te same pozycje i te same kolumny, które katalog publiczny
  // pokazuje anonimowemu odwiedzającemu, tylko okno zamiast całości. Izolacja
  // stoi na jawnym zawężeniu tenant_id w każdym podzapytaniu (SECURITY
  // DEFINER), a rozmiar odczytu na zacisku p_limit — pilnuje tego
  // catalog-page.test.ts.
  "get_public_catalog_page",
  // 0109 — MENU KATEGORII dla tras /katalog i /kategoria (ADR-266). anon
  // z dokładnie tego samego powodu, co get_public_catalog: nagłówek sklepu
  // renderuje się dla anonimowego odwiedzającego, a menu kategorii jest jego
  // częścią. Oddaje WYŁĄCZNIE nazwy, adresy i LICZBY pozycji per kategoria
  // (kategorie niepuste) — ani jednej pozycji, więc odczyt jest O(kategorii),
  // a nie O(katalogu). Izolacja stoi na jawnym zawężeniu tenant_id w każdym
  // złączeniu (SECURITY DEFINER) — pilnuje tego category-nav.test.ts.
  "get_public_category_nav",
  // 0101 — JEDNA STRONA jednej kategorii publicznej dla trasy /kategoria/{slug}
  // (ADR-244). anon z dokładnie tego samego powodu, co get_public_catalog_page,
  // i o WĘŻSZYM zakresie: te same pozycje i te same kolumny, które katalog
  // publiczny pokazuje anonimowemu odwiedzającemu, tylko zawężone do jednej
  // kategorii i do okna strony. Izolacja stoi na jawnym zawężeniu tenant_id
  // w każdym podzapytaniu (SECURITY DEFINER), a rozmiar odczytu na zacisku
  // p_page_size — pilnuje tego category-page.test.ts.
  "get_public_category_page",
  "get_public_custom_fields", // 0058 — publiczne definicje pól checkoutu
  // 0084 — wąski odczyt JEDNEJ pozycji dla strony sprzętu (ADR-185). anon
  // z dokładnie tego samego powodu, co get_public_catalog, i o WĘŻSZYM
  // zakresie: oddaje tę samą pozycję i te same kolumny, które katalog
  // publiczny pokazuje anonimowemu odwiedzającemu, tylko jedną zamiast
  // wszystkich. Izolacja stoi na jawnym zawężeniu tenant_id w każdym
  // podzapytaniu (SECURITY DEFINER) — pilnuje tego public-product.test.ts.
  "get_public_product",
  // 0083 — rejestr ADRESÓW sprzętu (ADR-182). anon z tego samego powodu, co
  // get_public_catalog: kafel katalogu buduje link do strony sprzętu tą samą
  // drogą, którą bierze sam katalog, a trasa /produkt/{slug} musi rozstrzygnąć
  // adres, zanim cokolwiek wyrenderuje. Oddaje WYŁĄCZNIE identyfikatory
  // i adresy pozycji, które katalog publiczny i tak pokazuje; izolacja stoi na
  // jawnym zawężeniu tenant_id w ciele (SECURITY DEFINER) — pilnuje tego
  // product-slug.test.ts.
  "get_public_product_slugs",
  // 0090 — flagi POWŁOKI sklepu (ADR-203). anon z tego samego powodu, co
  // get_tenant_appearance: powłoka renderuje się dla anonimowego odwiedzającego,
  // a flaga rozstrzyga, czy pasek niesie pigułkę terminu. Oddaje WYŁĄCZNIE
  // przełączniki zachowania (na start term_calendar_enabled) i wyłącznie dla
  // najemcy w oknie handlowym; izolacja stoi na jawnym zawężeniu tenant_id
  // w ciele (SECURITY DEFINER) — pilnuje tego store-term-flag.test.ts.
  "get_public_store_flags",
  "get_public_order_payment", // 0029 — status płatności zamówienia (bramka: checkout_token)
  "get_public_payment_account", // 0028 — publiczny identyfikator konta płatności
  "get_published_legal_document", // 0063 — żywa wersja dokumentu prawnego
  "get_published_legal_documents", // 0063 — spis opublikowanych dokumentów (bez treści)
  "get_published_page", // 0074 — opublikowana strona sklepu POD ADRESEM (rdzeń odczytu)
  // 0080 — opublikowany SZABLON strony produktu (ADR-178). anon, bo to JEST
  // publiczny odczyt sklepu: treść strony każdego sprzętu idzie tą funkcją do
  // przeglądarki klienta najemcy, tak samo jak treść strony pod adresem idzie
  // przez get_published_page. Czyta wyłącznie kolumny *_published i wyłącznie
  // dla najemcy w oknie handlowym; izolacja stoi na jawnym zawężeniu
  // tenant_id/kind w ciele (SECURITY DEFINER), pilnowanym przez
  // site-product-template.test.ts.
  "get_published_product_template",
  "get_published_site", // 0019 — opublikowana strona GŁÓWNA sklepu (wejście do 0074)
  "get_tenant_appearance", // 0079 — znak firmy i wygląd sklepu (odczyt WYŁĄCZNIE kolumn *_published najemcy)
  "get_tenant_pages", // 0074 — rejestr żywych adresów stron najemcy dla proxy sklepu
  "is_settlement_writer", // 0032 — predykat polityk rozliczeń kaucji
  "is_superadmin", // 0001 — czytnik claimu używany w politykach RLS
  // join_waitlist (0006) ZDJĘTA w 0071 — waitlista nie wraca (decyzja
  // właściciela 2026-08-12); nieobecności funkcji pilnuje
  // waitlist-decommission.test.ts, a bramka „wpisy martwe" niżej broni
  // przed cichym powrotem wpisu bez grantu.
  "log_public_checkout_email", // 0021 — dziennik wysyłek checkoutu (bramka: log_token)
  "public_checkout", // 0020/0059 — publiczne zamówienie (bramka: bilet HMAC)
  "reserved_subdomains", // 0023 — lista slugów zarezerwowanych (jawna z definicji)
  "resolve_tenant_by_domain", // 0022 — routing: domena → uuid tenanta
  "resolve_tenant_by_slug", // 0017 — routing: slug subdomeny → uuid tenanta
  "tenant_id", // 0001 — czytnik claimu używany w politykach RLS
  "verify_api_key", // 0053 — weryfikacja klucza publicznego API
] as const;

interface ExecuteGrant {
  fn: string;
  grantee: string;
}

/**
 * Każde (funkcja app.*, EXECUTE, PUBLIC|anon) wprost z silnika.
 * coalesce z acldefault: proacl IS NULL znaczy „domyślne ACL", a domyślne
 * ACL funkcji ZAWIERA PUBLIC — pominięcie tego coalesce ślepłoby bramkę
 * dokładnie na przypadek, dla którego istnieje (świeża funkcja bez revoke).
 */
async function listPublicOrAnonExecute(
  sql: ReturnType<typeof postgres>,
): Promise<ExecuteGrant[]> {
  const rows = await sql<ExecuteGrant[]>`
    select
      p.proname as fn,
      case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as grantee
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname = 'app'
      and a.privilege_type = 'EXECUTE'
      and (a.grantee = 0 or a.grantee::regrole::text = 'anon')
    order by p.proname
  `;
  return rows.map((r) => ({ fn: r.fn, grantee: r.grantee }));
}

describe.skipIf(!hasEnv)("ACL funkcji app.* (konwencja revoke-from-public, 0064)", () => {
  const sql = postgres(process.env.SUPABASE_LOCAL_URL as string, { max: 1 });

  afterEach(async () => {
    // Sprzątanie przynęty niezależnie od wyniku testu — wisząca funkcja
    // z PUBLIC EXECUTE wywracałaby kolejne przebiegi na współdzielonej bazie.
    await sql.unsafe(`
      do $$
      declare r record;
      begin
        for r in
          select p.oid::regprocedure as fn
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app' and p.proname like '_acl_bait_%'
        loop
          execute format('drop function %s', r.fn);
        end loop;
      end;
      $$
    `);
  });

  it("żadna funkcja app.* nie ma EXECUTE dla PUBLIC, a dla anon tylko allowlista", async () => {
    const grants = await listPublicOrAnonExecute(sql);
    const allow = new Set<string>(ANON_EXECUTE_ALLOWLIST);
    const violations = grants.filter((g) => g.grantee === "PUBLIC" || !allow.has(g.fn));
    expect(
      violations,
      "funkcje app.* wołalne publicznie poza allowlistą (nowa funkcja wymaga " +
        "`revoke all ... from public` w migracji — docs/konwencje-migracji.md):\n" +
        violations.map((v) => `  app.${v.fn}: EXECUTE dla ${v.grantee}`).join("\n"),
    ).toEqual([]);
  });

  it("allowlista anon nie zawiera wpisów martwych (każdy odpowiada realnemu grantowi)", async () => {
    // Bez tej kontroli allowlista gnije w drugą stronę: wpis po usuniętej
    // albo pozbawionej grantu funkcji zostaje i CICHO legalizuje przyszłe
    // ponowne nadanie EXECUTE, którego nikt już nie zamierzał.
    const grants = await listPublicOrAnonExecute(sql);
    const anonFns = new Set(grants.filter((g) => g.grantee === "anon").map((g) => g.fn));
    const stale = ANON_EXECUTE_ALLOWLIST.filter((fn) => !anonFns.has(fn));
    expect(
      stale,
      `wpisy allowlisty bez pokrycia w faktycznych grantach anon: ${stale.join(", ")}`,
    ).toEqual([]);
  });

  it("test-przynęta: świeża funkcja z DOMYŚLNYM ACL zostaje wykryta jako PUBLIC", async () => {
    const baitName = `_acl_bait_${Date.now()}`;
    // Celowo bez revoke — dokładnie tak wygląda funkcja, której autor
    // zapomniał o konwencji. proacl zostaje NULL do pierwszego GRANT/REVOKE.
    await sql.unsafe(`create function app.${baitName}() returns int language sql as 'select 1'`);
    const grants = await listPublicOrAnonExecute(sql);
    expect(
      grants.some((g) => g.fn === baitName && g.grantee === "PUBLIC"),
      "introspekcja nie wykryła świeżej funkcji z domyślnym PUBLIC EXECUTE — bramka jest dekoracją",
    ).toBe(true);
  });

  it("czujnik nie jest pusty: schemat app ma funkcje, a introspekcja je widzi", async () => {
    // `toEqual([])` w bramce przechodzi też przy zepsutym zapytaniu —
    // kontrola czujnika odróżnia „czysto" od „nie ma czego sprawdzać".
    const [{ count }] = await sql<{ count: number }[]>`
      select count(*)::int as count
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app'
    `;
    expect(count, "introspekcja nie widzi żadnej funkcji w schemacie app").toBeGreaterThan(30);
    const grants = await listPublicOrAnonExecute(sql);
    expect(
      grants.filter((g) => g.grantee === "anon").length,
      "introspekcja nie widzi grantów anon, które istnieją z definicji (publiczne RPC storefrontu)",
    ).toBeGreaterThan(0);
  });
});
