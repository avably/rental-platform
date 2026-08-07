"use server";

/**
 * Akcje ekranu domen sklepu (Zadanie 2.6, ADR-046).
 *
 * PODZIAŁ ODPOWIEDZIALNOŚCI. Własność domeny waliduje DOSTAWCA (rekord DNS u
 * rejestratora najemcy); my wyłącznie ODZWIERCIEDLAMY jego werdykt w kolumnie
 * `verified`. Nigdzie w tym pliku nie ustawiamy `verified = true` z własnej
 * decyzji — jedyne miejsce, gdzie to robimy, to app.create_tenant (0022) dla
 * subdomeny platformy, bo tam host jest nasz z definicji.
 *
 * ODPORNOŚĆ NA AWARIĘ DOSTAWCY. Każde wywołanie sieciowe idzie przez
 * `registerDomainSafely`/`checkDomainSafely`, które NIE RZUCAJĄ (ADR-033/036):
 * wiersz w bazie powstaje/aktualizuje się niezależnie, a powód niepowodzenia
 * ląduje w `last_error` i na ekranie. Operacja najemcy nigdy nie pada przez
 * cudzą usługę.
 *
 * Zapis otwarty dla KAŻDEGO członka, spójnie z polityką RLS domains z 0019
 * (jak ustawienia dostaw i e-maili) — UI nie udaje bramki, której baza nie ma.
 */
import { revalidatePath } from "next/cache";

import {
  VercelDomainsClient,
  checkDomainSafely,
  registerDomainSafely,
  tenantSubdomainHost,
} from "@avably/core";

import { AuthError } from "@/lib/auth";
import { zodErrorToState, type FormState } from "@/lib/form-state";
import { requireMember } from "@/lib/supabase-server";

import { customDomainInputFromFormData, customDomainSchema } from "./domains-validation";

const PG_UNIQUE_VIOLATION = "23505";
const PG_CHECK_VIOLATION = "23514";

type MemberContext = Awaited<ReturnType<typeof requireMember>>;

async function member(): Promise<MemberContext | FormState> {
  try {
    return await requireMember();
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }
}

function isFormState(value: MemberContext | FormState): value is FormState {
  return !("supabase" in value);
}

/** Host z formularza akcji wierszowych (weryfikuj / usuń). */
function hostFromFormData(formData: FormData): string | null {
  const raw = formData.get("domain");
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/**
 * Dodanie własnej domeny: wiersz (kind='custom', verified=false) → rejestracja
 * u dostawcy → zapis jego odpowiedzi. Kolejność jest istotna: WIERSZ PIERWSZY,
 * bo to on jest trwałym stanem, do którego najemca może wrócić i ponowić.
 * Rejestracja najpierw zostawiałaby przy awarii zapisu host wpięty u dostawcy
 * i niewidoczny w panelu.
 */
export async function addCustomDomainAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = customDomainSchema.safeParse(customDomainInputFromFormData(formData));
  if (!parsed.success) return zodErrorToState(parsed.error);

  const ctx = await member();
  if (isFormState(ctx)) return ctx;

  const host = parsed.data.domain;

  const { error } = await ctx.supabase.from("domains").insert({
    tenant_id: ctx.tenantId,
    domain: host,
    kind: "custom",
    // NIGDY true z naszej decyzji — dowodem własności jest werdykt dostawcy.
    verified: false,
  });
  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      // UNIQUE na `domain` jest GLOBALNY, więc kolizja może oznaczać zarówno
      // „już ją dodałeś", jak i „ma ją inny najemca". Komunikat celowo nie
      // rozróżnia tych przypadków — inaczej formularz stałby się sondą
      // ujawniającą, czyje domeny są w systemie.
      return { formError: "Ta domena jest już w systemie." };
    }
    if (error.code === PG_CHECK_VIOLATION) {
      return { formError: "Baza odrzuciła tę domenę — sprawdź, czy to poprawny host." };
    }
    return { formError: error.message };
  }

  const result = await registerDomainSafely(host);
  await ctx.supabase
    .from("domains")
    .update({ provider_domain_id: result.providerDomainId, last_error: result.error })
    .eq("tenant_id", ctx.tenantId)
    .eq("domain", host);

  revalidatePath("/", "layout");
  return { success: host };
}

/**
 * PONOWIENIE REJESTRACJI SUBDOMENY (Zadanie 2.6b, domknięcie ADR-046).
 *
 * PO CO. ADR-046 świadomie pozwala zakładaniu organizacji dojść do końca, gdy
 * rejestracja hosta u dostawcy padnie — i to jest słuszne. Ale bez tej akcji
 * druga połowa wzorca nie istniała: `last_error` był stanem trwałym, którego
 * najemca nie miał jak ruszyć z panelu. Każda chwilowa awaria dostawcy (albo
 * wiersz z backfillu 0022, nigdy nierejestrowany, `provider_domain_id IS NULL`)
 * zamieniała się w zgłoszenie do supportu. „Uczciwa częściowa porażka" bez
 * ponowienia to po prostu porażka opisana ładnymi słowami.
 *
 * HOST WYŁĄCZNIE Z `tenants.slug` — NIGDY Z FORMULARZA. To jest bramka
 * bezpieczeństwa tej akcji, z dokładnie tego powodu, dla którego 0022
 * hardcoduje root domeny: wiersz subdomeny powstaje z `verified = true` BEZ
 * dowodu własności DNS (host jest nasz z definicji). Gdyby host przychodził
 * z klienta, dowolny zalogowany członek wpisałby cudzy host — albo nasz kanon
 * marketingowy — i dostałby go od razu jako routujący. Konwencja składania
 * hosta jest lustrem 0022 (`tenantSubdomainHost` = `lower(slug) || root`).
 *
 * NIE RZUCA. `registerDomainSafely` zwraca powód zamiast wyjątku, a my go
 * zapisujemy i pokazujemy — ten sam wzorzec co przy zakładaniu organizacji.
 * Sukces CZYŚCI `last_error`, inaczej ekran pokazywałby zaległy powód przy
 * działającym adresie.
 *
 * IDEMPOTENCJA. Ponowienie dla hosta już wpiętego w NASZ projekt jest
 * SUKCESEM, nie błędem: dostawca oddaje 409, a `VercelDomainsClient.addDomain`
 * dopytuje o stan i zwraca go jak świeżą rejestrację (patrz api.ts). Dzięki
 * temu podwójne kliknięcie i ponowienie po zerwanym połączeniu nie zostawiają
 * najemcy z czerwonym komunikatem przy adresie, który działa.
 */
export async function retrySubdomainAction(
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const ctx = await member();
  if (isFormState(ctx)) return ctx;

  // Slug czytany PO tenant_id z sesji (na wierzchu RLS, jak w checkDomainAction):
  // to jedyne źródło hosta w tej akcji.
  const { data: tenant, error: tenantError } = await ctx.supabase
    .from("tenants")
    .select("slug")
    .eq("id", ctx.tenantId)
    .maybeSingle();
  if (tenantError) return { formError: tenantError.message };
  if (!tenant?.slug) return { formError: "Nie znaleziono organizacji." };

  const host = tenantSubdomainHost(tenant.slug as string);

  // Wiersza może NIE BYĆ mimo 0022: `on conflict (domain) do nothing` przy
  // slugu odtworzonym po skasowanym tenancie zostawia organizację bez adresu.
  // Ponowienie ma ten stan naprawić, a nie tylko zaraportować.
  const { data: existing, error: readError } = await ctx.supabase
    .from("domains")
    .select("id")
    .eq("tenant_id", ctx.tenantId)
    .eq("domain", host)
    .maybeSingle();
  if (readError) return { formError: readError.message };

  if (!existing) {
    const { error: insertError } = await ctx.supabase.from("domains").insert({
      tenant_id: ctx.tenantId,
      domain: host,
      // verified = true bez dowodu DNS jest tu legalne WYŁĄCZNIE dlatego, że
      // host powstał z naszego slugu i naszej stałej roota — nie z wejścia.
      kind: "subdomain",
      verified: true,
      verified_at: new Date().toISOString(),
    });
    if (insertError) {
      if (insertError.code === PG_UNIQUE_VIOLATION) {
        // UNIQUE na `domain` jest globalny: host trzyma KTOŚ INNY (odtworzony
        // slug). Sami tego nie rozstrzygniemy — zmiana cudzego wiersza byłaby
        // przejęciem hosta. To jedyny przypadek, w którym kontakt z nami jest
        // uczciwą odpowiedzią, a nie zbyciem najemcy.
        return { formError: "Ten adres jest już zajęty w systemie — napisz do nas." };
      }
      if (insertError.code === PG_CHECK_VIOLATION) {
        return { formError: "Baza odrzuciła adres zbudowany z nazwy organizacji." };
      }
      return { formError: insertError.message };
    }
  }

  const result = await registerDomainSafely(host);

  const { error: updateError } = await ctx.supabase
    .from("domains")
    .update({ provider_domain_id: result.providerDomainId, last_error: result.error })
    .eq("tenant_id", ctx.tenantId)
    .eq("domain", host);
  if (updateError) return { formError: updateError.message };

  revalidatePath("/", "layout");
  return result.ok
    ? { success: host }
    : { formError: result.error ?? "Rejestracja adresu nie powiodła się." };
}

/**
 * „Sprawdź weryfikację": odczyt werdyktu dostawcy i odzwierciedlenie go
 * w bazie. `verified` idzie DOKŁADNIE z odpowiedzi — także w dół, gdy dostawca
 * cofnie potwierdzenie (rekord DNS zdjęty). Trzymanie raz zdobytego `true`
 * zostawiałoby routing na hoście, którego najemca już nie kontroluje.
 */
export async function checkDomainAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const host = hostFromFormData(formData);
  if (!host) return { formError: "Brak domeny do sprawdzenia." };

  const ctx = await member();
  if (isFormState(ctx)) return ctx;

  const result = await checkDomainSafely(host);

  const { data, error } = await ctx.supabase
    .from("domains")
    .update({
      verified: result.verified,
      verified_at: result.verified ? new Date().toISOString() : null,
      provider_domain_id: result.providerDomainId,
      last_error: result.error,
    })
    // Filtr po tenant_id NA WIERZCHU RLS (pas i szelki): host podaje klient,
    // a RLS i tak przytnie cudzy wiersz — ale jawny filtr sprawia, że nawet
    // regresja polityki nie zamieni tego w zapis do cudzej domeny.
    .eq("tenant_id", ctx.tenantId)
    .eq("domain", host)
    .select("domain");
  if (error) return { formError: error.message };
  if (!data || data.length === 0) return { formError: "Nie znaleziono tej domeny." };

  revalidatePath("/", "layout");
  return result.verified ? { success: host } : { formError: result.error ?? "pending" };
}

/**
 * Usunięcie WŁASNEJ domeny. Subdomena platformy jest nieusuwalna z UI (bramka
 * własności przepuszcza wyłącznie `kind = 'custom'`): jest jedynym
 * gwarantowanym adresem sklepu, a jej skasowanie zostawiłoby najemcę bez
 * działającego storefrontu.
 *
 * BRAMKA WŁASNOŚCI PRZED DOSTAWCĄ (ADR-100). Host przychodzi z formularza,
 * a hosty WSZYSTKICH najemców siedzą w jednym projekcie u dostawcy — samo
 * `removeDomain(host)` wypięłoby więc także host, który nie należy do
 * wywołującego, gasząc cudzy storefront; tenant-scoped DB-delete trafiałby
 * wtedy 0 wierszy, a ofiara dalej widziałaby u siebie `verified = true`.
 * Dlatego NAJPIERW tenant-scoped odczyt wiersza `custom` i dopiero dowiedziona
 * własność otwiera wywołanie sieciowe. Komunikat odmowy jest celowo tożsamy
 * z checkDomainAction — inaczej akcja byłaby sondą ujawniającą, czyje domeny
 * są w systemie.
 *
 * Kolejność odwrotna niż przy dodawaniu — najpierw dostawca, potem wiersz:
 * skasowany wiersz bez wypięcia hosta zostawiłby u dostawcy sierotę, której
 * nikt już nie widzi w panelu. Wypięcie jest idempotentne (404 = stan
 * docelowy), a jego awaria NIE blokuje usunięcia wiersza — najemca ma prawo
 * przestać kierować swoją domenę do nas niezależnie od kondycji cudzego API.
 */
export async function removeCustomDomainAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const host = hostFromFormData(formData);
  if (!host) return { formError: "Brak domeny do usunięcia." };

  const ctx = await member();
  if (isFormState(ctx)) return ctx;

  const { data: owned, error: readError } = await ctx.supabase
    .from("domains")
    .select("id")
    // Filtr po tenant_id NA WIERZCHU RLS (pas i szelki, jak w checkDomainAction):
    // nawet regresja polityki nie zamieni tego odczytu w dowód na cudzy wiersz.
    .eq("tenant_id", ctx.tenantId)
    .eq("domain", host)
    .eq("kind", "custom")
    .maybeSingle();
  if (readError) return { formError: readError.message };
  if (!owned) return { formError: "Nie znaleziono tej domeny." };

  try {
    await new VercelDomainsClient().removeDomain(host);
  } catch {
    // Świadomie pochłonięte: patrz docblock. Stanem prawdziwym jest wiersz.
  }

  const { error } = await ctx.supabase
    .from("domains")
    .delete()
    .eq("tenant_id", ctx.tenantId)
    .eq("domain", host)
    .eq("kind", "custom");
  if (error) return { formError: error.message };

  revalidatePath("/", "layout");
  return { success: host };
}
