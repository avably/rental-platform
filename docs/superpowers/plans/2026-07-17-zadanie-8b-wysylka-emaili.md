# Zadanie 8b — wysyłka e-maili cyklu najmu z panelu

> **Dla wykonawców agentowych:** WYMAGANA PODUMIEJĘTNOŚĆ: użyj
> superpowers:subagent-driven-development (zalecane) albo
> superpowers:executing-plans, żeby wykonać ten plan zadanie po zadaniu.
> Kroki mają składnię checkboxów (`- [ ]`).

**Cel:** operator panelu, zmieniając status zamówienia, może świadomie wysłać
klientowi e-mail cyklu najmu — a przy niekompletnej konfiguracji system mówi
o tym wprost, zamiast udawać wysyłkę.

**Architektura:** port transportu w `packages/core/src/email/` (wzorzec portu
GlobKurier: funkcje czyste + wstrzykiwany `fetchFn`, zero I/O w silniku),
migracja `0014` waliduje klucz `tenant_settings.email_sender` CHECK-iem wzorem
0013, a `apps/panel` skleja dane zamówienia z szablonami `@avably/emails`
(kontrakt ZASTANY — pakietu nie dotykamy). Wysyłka jest krokiem PO udanej
tranzycji i nigdy jej nie blokuje.

**Stack:** TypeScript, Next.js (Server Actions, `useActionState`), Supabase
(RLS, PostgREST), Vitest, react-email, Resend (HTTP API przez `fetch`).

## Ograniczenia globalne

- Gałąź `feat/zadanie-8b-wysylka-emaili`, worktree
  `/Users/godekmaciej/rental-platform/.claude/worktrees/emaile-cyklu`.
  **NIGDY push na main.** PR do main.
- Autor commitów: `Avably <admin@avably.io>`. Zero wzmianek o AI, zero
  `Co-Authored-By`, zero odniesień do konkurencji. Komunikaty i komentarze
  po polsku.
- Kody błędów DB: **wyłącznie standardowe SQLSTATE** (23514/23503). Kody
  `P0xxx` PostgREST zjada do gołego 500 bez treści.
- **NIE dotykamy:** `packages/emails`, `apps/storefront`, `packages/ui`,
  `packages/pdf`. Jeśli kontrakt szablonów nie wystarcza — STOP i raport do PM.
- Testy nie biją w sieć: transport jest wstrzykiwany, w testach mockowany.
- Środowisko: `export PATH="/opt/homebrew/opt/node@22/bin:$HOME/.local/share/supabase:$PATH"`.
- Numery przydzielone z góry: **ADR-033**, migracja **0014**. (0012 celowo
  wolne, 0013 zajęte przez dostawy.)

## Decyzje projektowe (do spisania w ADR-033)

Rozstrzygnięcia podjęte na zweryfikowanym stanie repo — trzy z nich odbiegają
od litery briefu, bo repo okazało się bogatsze, niż brief zakładał:

1. **Nadawca: wspólny adres platformy + nazwa tenanta w polu From.**
   Klucz `email_sender` = `{name, reply_to?}` — **bez `address`** (brief
   podawał `{name, address}` jako „np."). Adres nadawcy jest stałą platformy
   (`RESEND_FROM_EMAIL`, fallback `DEFAULT_FROM_EMAIL` z `@avably/core`), bo
   adres per tenant wymaga weryfikacji DNS domeny każdego najemcy z osobna —
   koszt nieproporcjonalny do fazy 1. Tenant personalizuje nazwę wyświetlaną
   i opcjonalny `reply_to`, na który klient realnie odpowiada.
2. **Locale e-maila = `tenants.locale`** (kolumna z 0005, `not null default
   'pl'`), nie klucz `tenant_settings`. Brief rekomendował „locale tenanta
   z jego ustawień" — trafia w dobrą oś, ale źródło jest prostsze i już
   istnieje. Dług bez zmian: preferencja językowa klienta (`customers` nie
   ma locale).
3. **Waluta z `getTenantCurrency`** (`apps/panel/lib/tenant-currency.ts`),
   nie z `plans.currency`. Brief wskazywał `plans.currency`, ale panel
   wyświetla kwoty zamówienia właśnie przez `getTenantCurrency`; e-mail musi
   pokazać klientowi **tę samą** kwotę, którą operator widzi na ekranie.
   Rozjazd tych dwóch źródeł byłby cichym bugiem.
4. **Transport w `packages/core/src/email/`**, nie w `packages/security`.
   Precedens: port GlobKurier (`packages/core/src/courier/`) — integracja
   z zewnętrznym dostawcą przez wstrzykiwany `fetch`. „Security" byłoby
   semantycznie fałszywe dla wysyłki poczty.
5. **Semantyka konfiguracji ŚWIADOMIE INNA niż Turnstile.** Turnstile bez
   sekretu robi dev-skip = `ok: true` (przepuszcza). Dla poczty taki
   odpowiednik byłby cichym sukcesem — klient nie dostaje maila, panel mówi
   „wysłano". Dlatego brak `RESEND_API_KEY` = wysyłka **jawnie niedostępna**
   (przełącznik wyłączony + czytelny powód), nigdy udawany sukces. Wspólne
   z Turnstile zostaje to, co istotne: konfiguracja rozstrzyga się jawnie,
   a nie przez zgadywanie z `NODE_ENV`.
6. **Temat wiadomości składa panel**, nie szablon. `renderRental*` zwraca
   `{html, text}` bez tematu, ale `emailMessages` jest z pakietu
   eksportowane — temat budujemy z `rentalLifecycle[template].heading`.
   Kontrakt wystarcza, cudzego pasa nie ruszamy.

## Struktura plików

**Tworzone:**
- `packages/db/supabase/migrations/0014_email_sender.sql` — CHECK kształtu
  `tenant_settings.email_sender`.
- `packages/db/test/email-sender.test.ts` — kształty i pułapka NULL.
- `packages/core/src/email/types.ts` — typy portu.
- `packages/core/src/email/tenant-config.ts` — parser `email_sender`
  (czysty, wzorzec `courier/tenant-config.ts`) + `EmailConfigError`.
- `packages/core/src/email/transport.ts` — port Resend + `emailAvailability`.
- `packages/core/src/email/index.ts` — reeksport.
- `packages/core/src/email/tenant-config.test.ts`, `transport.test.ts`.
- `apps/panel/app/[locale]/zamowienia/[id]/rental-email.ts` — mapowanie
  tranzycja→szablon + złożenie propsów.
- `apps/panel/app/[locale]/zamowienia/[id]/rental-email.test.ts`.

**Modyfikowane:**
- `packages/core/src/index.ts` — reeksport modułu email.
- `apps/panel/app/[locale]/zamowienia/actions.ts` — `changeOrderStatusAction`:
  wysyłka po tranzycji.
- `apps/panel/app/[locale]/zamowienia/[id]/status-buttons.tsx` — checkbox.
- `apps/panel/app/[locale]/zamowienia/[id]/page.tsx` — przekazanie stanu
  dostępności wysyłki.
- `apps/panel/messages/{en,pl}.json` — teksty UI.
- `docs/dokumentacja/index.html`, `docs/DOKUMENTACJA.md` — ADR-033, karta
  modułu, dziennik.

---

### Zadanie 1: Migracja 0014 — walidacja klucza `email_sender`

**Pliki:**
- Utwórz: `packages/db/supabase/migrations/0014_email_sender.sql`
- Test: `packages/db/test/email-sender.test.ts`

**Interfejsy:**
- Produkuje: klucz `tenant_settings.email_sender` o kształcie
  `{name: string (1..120 po btrim), reply_to?: string (3..320)}`;
  naruszenie → SQLSTATE **23514**.

- [ ] **Krok 1: Napisz failujący test**

Wzorzec seedu i klienta bierz z `packages/db/test/courier-shipments.test.ts`
(ten sam serwisowy klient, ten sam `seed-tenants.ts`). Test musi zawierać
**pułapkę NULL** — to nie ozdoba, to mechanizm ochronny:

```ts
it("odrzuca email_sender bez name (pułapka NULL w jsonb)", async () => {
  const { error } = await service
    .from("tenant_settings")
    .upsert({ tenant_id: tenantA, key: "email_sender", value: { reply_to: "a@b.pl" } });
  expect(error?.code).toBe("23514");
});

it("odrzuca name złożone z samych spacji", async () => {
  const { error } = await service
    .from("tenant_settings")
    .upsert({ tenant_id: tenantA, key: "email_sender", value: { name: "   " } });
  expect(error?.code).toBe("23514");
});

it("odrzuca reply_to o złym typie", async () => {
  const { error } = await service
    .from("tenant_settings")
    .upsert({ tenant_id: tenantA, key: "email_sender", value: { name: "Demo", reply_to: 42 } });
  expect(error?.code).toBe("23514");
});

it("przyjmuje poprawny nadawca z reply_to i bez", async () => {
  const bez = await service
    .from("tenant_settings")
    .upsert({ tenant_id: tenantA, key: "email_sender", value: { name: "Wypożyczalnia Demo" } });
  expect(bez.error).toBeNull();

  const z = await service
    .from("tenant_settings")
    .upsert({ tenant_id: tenantA, key: "email_sender", value: { name: "Demo", reply_to: "kontakt@demo.pl" } });
  expect(z.error).toBeNull();
});
```

- [ ] **Krok 2: Uruchom test — musi failować**

Uruchom: `cd packages/db && pnpm vitest run test/email-sender.test.ts`
Oczekiwane: FAIL — wstawki przechodzą (`error` jest `null`), bo CHECK-a
jeszcze nie ma.

- [ ] **Krok 3: Napisz migrację**

Każda koniunkcja **owinięta w `coalesce(..., false)`** — bez tego brak klucza
daje SQL NULL, a CHECK z wynikiem NULL PRZECHODZI (trójwartościowa logika,
pułapka z 0011/0013).

```sql
-- Migracja 0014 — nadawca e-maili cyklu najmu (ADR-033).
--
-- Klucz tenant_settings.email_sender: {name, reply_to?}.
--
-- ŚWIADOMIE BEZ pola `address`: adres nadawcy jest stałą platformy
-- (RESEND_FROM_EMAIL / DEFAULT_FROM_EMAIL), bo adres per tenant wymaga
-- weryfikacji DNS domeny każdego najemcy. Tenant personalizuje nazwę
-- w polu From i opcjonalny reply_to — patrz ADR-033.
--
-- KONWENCJE (docs/konwencje-migracji.md, nagłówki 0007/0011/0013):
--   * walidacja U ŹRÓDŁA, przy zapisie ustawienia (wzorzec 0007),
--   * wyłącznie standardowe SQLSTATE (23514) — P0xxx PostgREST zjada,
--   * coalesce(..., false) wokół KAŻDEJ koniunkcji (pułapka NULL, 0011).
--
-- NUMERACJA: 0012 pozostaje świadomie wolne (kolejność stosowania jest
-- leksykalna, luka jest legalna).
alter table public.tenant_settings
  add constraint tenant_settings_email_sender_valid check (
    key <> 'email_sender' or coalesce((
      jsonb_typeof(value) = 'object'
      and jsonb_typeof(value->'name') = 'string'
      and length(btrim(value->>'name')) between 1 and 120
      and (not (value ? 'reply_to') or (
        jsonb_typeof(value->'reply_to') = 'string'
        and length(value->>'reply_to') between 3 and 320
      ))
    ), false)
  );

comment on constraint tenant_settings_email_sender_valid on public.tenant_settings is
  'Kształt tenant_settings.email_sender: {name text 1..120, reply_to? text 3..320} (ADR-033). Adres nadawcy jest stałą platformy, nie danymi tenanta.';
```

- [ ] **Krok 4: Zastosuj migrację i uruchom test**

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$HOME/.local/share/supabase:$PATH"
cd packages/db && supabase db reset
pnpm vitest run test/email-sender.test.ts
```
Oczekiwane: PASS (4/4). **Po `db reset` odtwórz dane demo** (`demo@avably.local`,
tenant „Wypożyczalnia Demo", zamówienie AV-2026-001) — wzorzec w
`packages/db/test/helpers/seed-tenants.ts`.

- [ ] **Krok 5: Dowód mutacyjny — zdejmij `coalesce`**

Zamień `coalesce((...), false)` na goły `(...)` i uruchom test ponownie.
Oczekiwane: test „odrzuca email_sender bez name" **czerwony** (wstawka
przechodzi). Przywróć `coalesce`. Zapisz wynik do raportu.

- [ ] **Krok 6: Commit**

```bash
git add packages/db/supabase/migrations/0014_email_sender.sql packages/db/test/email-sender.test.ts
git commit -m "feat(db): walidacja nadawcy e-maili cyklu najmu (0014)"
```

---

### Zadanie 2: Port transportu — dostępność wysyłki i parser nadawcy

**Pliki:**
- Utwórz: `packages/core/src/email/types.ts`, `tenant-config.ts`,
  `transport.ts`, `index.ts`
- Test: `packages/core/src/email/tenant-config.test.ts`, `transport.test.ts`
- Modyfikuj: `packages/core/src/index.ts`

**Interfejsy:**
- Konsumuje: `TenantSettingRow` z `./courier` (ten sam kształt wiersza).
- Produkuje:
  - `EMAIL_SENDER_KEY = "email_sender"`
  - `class EmailConfigError extends Error { problems: string[] }`
  - `emailSenderFromSettings(rows: TenantSettingRow[]): EmailSender`
  - `interface EmailSender { name: string; replyTo?: string }`
  - `interface EmailAvailability { available: boolean; reason?: string }`
  - `emailAvailability(opts?: { apiKey?: string }): EmailAvailability`
  - `interface OutgoingEmail { from: string; to: string; replyTo?: string; subject: string; html: string; text: string }`
  - `interface EmailTransport { send(email: OutgoingEmail): Promise<void> }`
  - `class EmailTransportError extends Error {}`
  - `resendTransport(opts?: { apiKey?: string; fetchFn?: typeof fetch }): EmailTransport`
  - `platformFromAddress(tenantName: string, opts?: { fromEmail?: string }): string`

- [ ] **Krok 1: Napisz failujące testy parsera**

```ts
import { describe, expect, it } from "vitest";
import { EmailConfigError, emailSenderFromSettings } from "./tenant-config";

describe("emailSenderFromSettings", () => {
  it("czyta nazwę i reply_to (snake_case → camelCase)", () => {
    const sender = emailSenderFromSettings([
      { key: "email_sender", value: { name: "Wypożyczalnia Demo", reply_to: "kontakt@demo.pl" } },
    ]);
    expect(sender).toEqual({ name: "Wypożyczalnia Demo", replyTo: "kontakt@demo.pl" });
  });

  it("reply_to jest opcjonalne", () => {
    const sender = emailSenderFromSettings([{ key: "email_sender", value: { name: "Demo" } }]);
    expect(sender).toEqual({ name: "Demo" });
  });

  // ZERO CICHYCH FALLBACKÓW: brak ustawienia to błąd konfiguracji, nie
  // podstawienie nazwy platformy — klient dostałby maila od obcej marki.
  it("brak klucza → EmailConfigError z czytelnym brakiem", () => {
    expect(() => emailSenderFromSettings([])).toThrow(EmailConfigError);
    try {
      emailSenderFromSettings([]);
    } catch (err) {
      expect((err as EmailConfigError).problems.join(" ")).toContain("nadawc");
    }
  });

  it("pusta nazwa → EmailConfigError", () => {
    expect(() => emailSenderFromSettings([{ key: "email_sender", value: { name: "  " } }])).toThrow(
      EmailConfigError,
    );
  });
});
```

- [ ] **Krok 2: Uruchom — musi failować**

Uruchom: `cd packages/core && pnpm vitest run src/email/tenant-config.test.ts`
Oczekiwane: FAIL — „Cannot find module './tenant-config'".

- [ ] **Krok 3: Napisz typy i parser**

`packages/core/src/email/types.ts`:

```ts
/** Nadawca e-maili tenanta. Adres jest stałą platformy — patrz ADR-033. */
export interface EmailSender {
  /** Nazwa wyświetlana w polu From (personalizacja tenanta). */
  name: string;
  /** Adres, na który realnie odpowiada klient. Opcjonalny. */
  replyTo?: string;
}

/** Wiadomość gotowa do wysyłki — wartości sformatował WOŁAJĄCY. */
export interface OutgoingEmail {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailTransport {
  send(email: OutgoingEmail): Promise<void>;
}

/** Czy wysyłka jest w ogóle dostępna i — jeśli nie — dlaczego. */
export interface EmailAvailability {
  available: boolean;
  /** Powód niedostępności, do pokazania operatorowi. */
  reason?: string;
}
```

`packages/core/src/email/tenant-config.ts`:

```ts
/**
 * Parser nadawcy e-maili tenanta z wierszy tenant_settings.
 *
 * FUNKCJA CZYSTA (bez I/O): zapytanie żyje w warstwie wywołującej (panel,
 * przez RLS) — jak parser kurierski (courier/tenant-config.ts).
 *
 * ZERO CICHYCH FALLBACKÓW: brak konfiguracji nie podstawia nazwy platformy.
 * Klient dostałby wtedy wiadomość podpisaną obcą marką — a operator nie
 * dowiedziałby się, że czegoś nie ustawił. Brak jest zawsze GŁOŚNY.
 *
 * Kształt jsonb w bazie jest snake_case (spójnie z kolumnami), typy silnika
 * camelCase — mapowanie tylko tutaj. Walidacja jest lustrem CHECK-a z 0014:
 * baza jest bramką autorytatywną, parser daje czytelny komunikat wcześniej.
 */
import type { TenantSettingRow } from "../courier";
import type { EmailSender } from "./types";

export const EMAIL_SENDER_KEY = "email_sender";

export class EmailConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Konfiguracja nadawcy e-maili jest niekompletna: ${problems.join("; ")}`);
    this.name = "EmailConfigError";
  }
}

export function emailSenderFromSettings(rows: TenantSettingRow[]): EmailSender {
  const row = rows.find((r) => r.key === EMAIL_SENDER_KEY);
  const value = row?.value as Record<string, unknown> | undefined;
  const problems: string[] = [];

  const name = typeof value?.name === "string" ? value.name.trim() : "";
  if (!name) problems.push("brak nazwy nadawcy (Ustawienia → E-maile)");

  const replyToRaw = value?.reply_to;
  if (replyToRaw !== undefined && typeof replyToRaw !== "string") {
    problems.push("adres odpowiedzi ma nieprawidłowy format");
  }

  if (problems.length > 0) throw new EmailConfigError(problems);

  const replyTo = typeof replyToRaw === "string" && replyToRaw.trim() ? replyToRaw.trim() : undefined;
  return replyTo ? { name, replyTo } : { name };
}
```

- [ ] **Krok 4: Uruchom — musi przejść**

Uruchom: `cd packages/core && pnpm vitest run src/email/tenant-config.test.ts`
Oczekiwane: PASS (4/4).

- [ ] **Krok 5: Napisz failujące testy transportu**

```ts
import { describe, expect, it, vi } from "vitest";
import { emailAvailability, platformFromAddress, resendTransport, EmailTransportError } from "./transport";

describe("emailAvailability", () => {
  // Kluczowa różnica wobec Turnstile: brak klucza NIE przepuszcza po cichu.
  it("brak klucza → niedostępna z czytelnym powodem", () => {
    const result = emailAvailability({ apiKey: undefined });
    expect(result.available).toBe(false);
    expect(result.reason).toContain("RESEND_API_KEY");
  });

  it("klucz ustawiony → dostępna", () => {
    expect(emailAvailability({ apiKey: "re_test" })).toEqual({ available: true });
  });
});

describe("platformFromAddress", () => {
  it("wstawia nazwę tenanta przed adres platformy", () => {
    expect(platformFromAddress("Wypożyczalnia Demo", { fromEmail: "Avably <noreply@avably.io>" })).toBe(
      "Wypożyczalnia Demo <noreply@avably.io>",
    );
  });

  it("cudzysłowy w nazwie są escapowane (nie rozbijają nagłówka)", () => {
    expect(platformFromAddress('Sprzęt "Pro"', { fromEmail: "noreply@avably.io" })).toBe(
      '"Sprzęt \\"Pro\\"" <noreply@avably.io>',
    );
  });
});

describe("resendTransport", () => {
  it("bez klucza rzuca zamiast udawać wysyłkę", async () => {
    const transport = resendTransport({ apiKey: undefined, fetchFn: vi.fn() });
    await expect(
      transport.send({ from: "a@b.pl", to: "c@d.pl", subject: "s", html: "<p/>", text: "t" }),
    ).rejects.toThrow(EmailTransportError);
  });

  it("wysyła przez API i przekazuje reply_to", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "1" }) });
    const transport = resendTransport({ apiKey: "re_test", fetchFn: fetchFn as unknown as typeof fetch });
    await transport.send({
      from: "Demo <noreply@avably.io>",
      to: "klient@example.com",
      replyTo: "kontakt@demo.pl",
      subject: "Rezerwacja potwierdzona",
      html: "<p>x</p>",
      text: "x",
    });
    const [, init] = fetchFn.mock.calls[0];
    expect(JSON.parse(init.body)).toMatchObject({
      to: ["klient@example.com"],
      reply_to: "kontakt@demo.pl",
      subject: "Rezerwacja potwierdzona",
    });
  });

  it("odmowa API → EmailTransportError, nigdy cichy sukces", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => '{"message":"domain not verified"}',
    });
    const transport = resendTransport({ apiKey: "re_test", fetchFn: fetchFn as unknown as typeof fetch });
    await expect(
      transport.send({ from: "a@b.pl", to: "c@d.pl", subject: "s", html: "<p/>", text: "t" }),
    ).rejects.toThrow(EmailTransportError);
  });
});
```

- [ ] **Krok 6: Uruchom — musi failować**

Uruchom: `cd packages/core && pnpm vitest run src/email/transport.test.ts`
Oczekiwane: FAIL — „Cannot find module './transport'".

- [ ] **Krok 7: Napisz transport**

```ts
/**
 * Port wysyłki e-maili (Resend HTTP API).
 *
 * SEMANTYKA KONFIGURACJI — ŚWIADOMIE INNA NIŻ TURNSTILE (ADR-032/033):
 * Turnstile bez sekretu robi dev-skip i PRZEPUSZCZA, bo brak CAPTCHY
 * w dev jest nieszkodliwy. Tu odpowiednik byłby CICHYM SUKCESEM: panel
 * mówi „wysłano", klient nie dostaje nic, nikt się nie dowiaduje. Dlatego
 * brak RESEND_API_KEY = wysyłka JAWNIE niedostępna (emailAvailability
 * gasi przełącznik z powodem), a próba wysyłki mimo to = wyjątek.
 * Wspólne z Turnstile zostaje to, co istotne: konfiguracja rozstrzyga się
 * jawnie, nie przez zgadywanie z NODE_ENV, a transport jest wstrzykiwany,
 * żeby testy nie biły w sieć.
 */
import { DEFAULT_FROM_EMAIL } from "../brand";
import type { EmailAvailability, EmailTransport, OutgoingEmail } from "./types";

export const RESEND_SEND_URL = "https://api.resend.com/emails";

export class EmailTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailTransportError";
  }
}

export interface EmailTransportOptions {
  /** Klucz API; domyślnie process.env.RESEND_API_KEY. */
  apiKey?: string | undefined;
  /** Transport do testów; domyślnie globalny fetch. */
  fetchFn?: typeof fetch;
}

// `in` zamiast `??`: jawne `apiKey: undefined` to decyzja wołającego
// (test, wymuszony brak) i nie może spaść na env procesu — wzorzec z
// verifyTurnstile.
function resolveApiKey(options: EmailTransportOptions): string | undefined {
  return "apiKey" in options ? options.apiKey : process.env.RESEND_API_KEY;
}

export function emailAvailability(options: EmailTransportOptions = {}): EmailAvailability {
  const apiKey = resolveApiKey(options);
  if (!apiKey) {
    return {
      available: false,
      reason: "Wysyłka e-maili nie jest skonfigurowana (brak RESEND_API_KEY).",
    };
  }
  return { available: true };
}

/**
 * Adres From: nazwa TENANTA + adres PLATFORMY. Adres per tenant wymagałby
 * weryfikacji DNS domeny każdego najemcy (ADR-033).
 */
export function platformFromAddress(
  tenantName: string,
  options: { fromEmail?: string } = {},
): string {
  const configured = options.fromEmail ?? process.env.RESEND_FROM_EMAIL ?? DEFAULT_FROM_EMAIL;
  // Adres platformy może przyjść w formie "Marka <adres>" albo gołego
  // adresu — nazwę tenanta wstawiamy zawsze, więc wyłuskujemy sam adres.
  const match = configured.match(/<([^>]+)>/);
  const address = (match ? match[1] : configured).trim();
  // Cudzysłów w nazwie rozbiłby nagłówek From — escapujemy, gdy trzeba.
  const name = /["\\]/.test(tenantName)
    ? `"${tenantName.replace(/(["\\])/g, "\\$1")}"`
    : tenantName;
  return `${name} <${address}>`;
}

export function resendTransport(options: EmailTransportOptions = {}): EmailTransport {
  const apiKey = resolveApiKey(options);
  const fetchFn = options.fetchFn ?? fetch;

  return {
    async send(email: OutgoingEmail): Promise<void> {
      if (!apiKey) {
        throw new EmailTransportError(
          "Wysyłka e-maili nie jest skonfigurowana (brak RESEND_API_KEY).",
        );
      }

      const response = await fetchFn(RESEND_SEND_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: email.from,
          to: [email.to],
          subject: email.subject,
          html: email.html,
          text: email.text,
          ...(email.replyTo ? { reply_to: email.replyTo } : {}),
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new EmailTransportError(
          `Dostawca poczty odrzucił wysyłkę (HTTP ${response.status}). ${body}`.trim(),
        );
      }
    },
  };
}
```

`packages/core/src/email/index.ts`:

```ts
export { EMAIL_SENDER_KEY, EmailConfigError, emailSenderFromSettings } from "./tenant-config";
export {
  RESEND_SEND_URL,
  EmailTransportError,
  emailAvailability,
  platformFromAddress,
  resendTransport,
  type EmailTransportOptions,
} from "./transport";
export type { EmailAvailability, EmailSender, EmailTransport, OutgoingEmail } from "./types";
```

- [ ] **Krok 8: Uruchom testy transportu**

Uruchom: `cd packages/core && pnpm vitest run src/email/`
Oczekiwane: PASS (10/10).

- [ ] **Krok 9: Podłącz reeksport w `packages/core/src/index.ts`**

Dopisz blok na końcu pliku (styl jak blok `./courier`):

```ts
export {
  EMAIL_SENDER_KEY,
  EmailConfigError,
  EmailTransportError,
  RESEND_SEND_URL,
  emailAvailability,
  emailSenderFromSettings,
  platformFromAddress,
  resendTransport,
  type EmailAvailability,
  type EmailSender,
  type EmailTransport,
  type EmailTransportOptions,
  type OutgoingEmail,
} from "./email";
```

- [ ] **Krok 10: Dowód mutacyjny — zamień brak klucza na cichy sukces**

W `resendTransport.send` zamień `throw new EmailTransportError(...)` przy
braku klucza na `return;`. Uruchom `pnpm vitest run src/email/transport.test.ts`.
Oczekiwane: test „bez klucza rzuca zamiast udawać wysyłkę" **czerwony**.
Przywróć `throw`. Zapisz wynik do raportu.

- [ ] **Krok 11: Commit**

```bash
git add packages/core/src/email packages/core/src/index.ts
git commit -m "feat(core): port wysyłki e-maili z jawną semantyką konfiguracji"
```

---

### Zadanie 3: Mapowanie tranzycja → szablon i złożenie wiadomości

**Pliki:**
- Utwórz: `apps/panel/app/[locale]/zamowienia/[id]/rental-email.ts`
- Test: `apps/panel/app/[locale]/zamowienia/[id]/rental-email.test.ts`

**Interfejsy:**
- Konsumuje: `renderRental*` i `emailMessages` z `@avably/emails`;
  `formatMoney`, `platformFromAddress`, `type EmailSender` z `@avably/core`.
- Produkuje:
  - `TEMPLATE_FOR_STATUS: Partial<Record<OrderStatus, RentalLifecycleTemplate>>`
  - `interface RentalEmailInput { status: OrderStatus; locale: Locale; currency: CurrencyCode; sender: EmailSender; tenantName: string; customerEmail: string; customerName: string; orderNumber: string; startDate: string; endDate: string; totalRentalGrosze: number; pickupLocationName?: string; fromEmail?: string }`
  - `buildRentalEmail(input: RentalEmailInput): OutgoingEmail | null`
    (`null` = dla tego statusu nie ma szablonu — nie błąd)

- [ ] **Krok 1: Napisz failujący test**

```ts
import { describe, expect, it } from "vitest";
import { TEMPLATE_FOR_STATUS, buildRentalEmail } from "./rental-email";

const base = {
  locale: "pl" as const,
  currency: "PLN" as const,
  sender: { name: "Wypożyczalnia Demo", replyTo: "kontakt@demo.pl" },
  tenantName: "Wypożyczalnia Demo",
  customerEmail: "klient@example.com",
  customerName: "Jan Kowalski",
  orderNumber: "AV-2026-001",
  startDate: "2026-08-01",
  endDate: "2026-08-05",
  totalRentalGrosze: 55000,
  fromEmail: "Avably <noreply@avably.io>",
};

describe("TEMPLATE_FOR_STATUS", () => {
  it("mapuje pięć statusów cyklu najmu", () => {
    expect(TEMPLATE_FOR_STATUS).toEqual({
      reserved: "confirmed",
      ready_for_pickup: "readyForPickup",
      picked_up: "pickedUp",
      returned: "returned",
      cancelled: "cancelled",
    });
  });
});

describe("buildRentalEmail", () => {
  it("status bez szablonu → null (nie błąd)", async () => {
    expect(await buildRentalEmail({ ...base, status: "draft" })).toBeNull();
  });

  it("formatuje kwotę wg locale i waluty tenanta", async () => {
    const email = await buildRentalEmail({ ...base, status: "reserved" });
    // 55000 groszy = 550,00 zł; NBSP w wyniku Intl — normalizujemy.
    expect(email!.html.replace(/ /g, " ")).toContain("550,00 zł");
  });

  it("temat pochodzi z nagłówka szablonu w locale tenanta", async () => {
    const pl = await buildRentalEmail({ ...base, status: "reserved" });
    expect(pl!.subject).toBe("Rezerwacja potwierdzona");
    const en = await buildRentalEmail({ ...base, status: "reserved", locale: "en" });
    expect(en!.subject).toBe("Reservation confirmed");
  });

  it("From niesie nazwę tenanta, reply-to z ustawień", async () => {
    const email = await buildRentalEmail({ ...base, status: "returned" });
    expect(email!.from).toBe("Wypożyczalnia Demo <noreply@avably.io>");
    expect(email!.replyTo).toBe("kontakt@demo.pl");
    expect(email!.to).toBe("klient@example.com");
  });
});
```

- [ ] **Krok 2: Uruchom — musi failować**

Uruchom: `cd apps/panel && pnpm vitest run "app/[locale]/zamowienia/[id]/rental-email.test.ts"`
Oczekiwane: FAIL — „Cannot find module './rental-email'".

- [ ] **Krok 3: Napisz moduł**

```ts
/**
 * Złożenie e-maila cyklu najmu dla tranzycji statusu.
 *
 * KONTRAKT SZABLONÓW (Zadanie 8a, packages/emails — pas cudzy, nie ruszamy):
 * renderRental* przyjmuje gotowe STRINGI i zwraca {html, text}. Formatowanie
 * kwot i dat należy do WOŁAJĄCEGO — czyli tutaj. Tematu szablon nie zwraca,
 * więc budujemy go z emailMessages (też z pakietu eksportowane).
 */
import {
  emailMessages,
  renderRentalCancelled,
  renderRentalConfirmed,
  renderRentalPickedUp,
  renderRentalReadyForPickup,
  renderRentalReturned,
  type RentalLifecycleEmailProps,
  type RenderedEmail,
} from "@avably/emails";
import {
  formatMoney,
  platformFromAddress,
  type CurrencyCode,
  type EmailSender,
  type Locale,
  type OrderStatus,
  type OutgoingEmail,
} from "@avably/core";

type RentalLifecycleTemplate =
  | "confirmed"
  | "readyForPickup"
  | "pickedUp"
  | "returned"
  | "cancelled";

/**
 * Tranzycja → szablon. Statusy spoza mapy (draft) NIE mają szablonu i to
 * jest stan legalny, nie błąd — patrz buildRentalEmail → null.
 */
export const TEMPLATE_FOR_STATUS: Partial<Record<OrderStatus, RentalLifecycleTemplate>> = {
  reserved: "confirmed",
  ready_for_pickup: "readyForPickup",
  picked_up: "pickedUp",
  returned: "returned",
  cancelled: "cancelled",
};

const RENDERERS: Record<
  RentalLifecycleTemplate,
  (props: RentalLifecycleEmailProps) => Promise<RenderedEmail>
> = {
  confirmed: renderRentalConfirmed,
  readyForPickup: renderRentalReadyForPickup,
  pickedUp: renderRentalPickedUp,
  returned: renderRentalReturned,
  cancelled: renderRentalCancelled,
};

export interface RentalEmailInput {
  status: OrderStatus;
  locale: Locale;
  currency: CurrencyCode;
  sender: EmailSender;
  tenantName: string;
  customerEmail: string;
  customerName: string;
  orderNumber: string;
  startDate: string;
  endDate: string;
  totalRentalGrosze: number;
  pickupLocationName?: string;
  /** Nadpisanie adresu platformy (test); domyślnie env/stała. */
  fromEmail?: string;
}

/** Data w locale tenanta — szablon dostaje gotowy string (kontrakt 8a). */
function formatDate(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date(`${iso}T00:00:00Z`));
}

export async function buildRentalEmail(input: RentalEmailInput): Promise<OutgoingEmail | null> {
  const template = TEMPLATE_FOR_STATUS[input.status];
  if (!template) return null;

  const props: RentalLifecycleEmailProps = {
    locale: input.locale,
    tenantName: input.tenantName,
    orderNumber: input.orderNumber,
    customerName: input.customerName,
    startDate: formatDate(input.startDate, input.locale),
    endDate: formatDate(input.endDate, input.locale),
    totalRentalFormatted: formatMoney(input.totalRentalGrosze, input.currency, input.locale),
    ...(input.pickupLocationName ? { pickupLocationName: input.pickupLocationName } : {}),
  };

  const { html, text } = await RENDERERS[template](props);
  const subject = emailMessages(input.locale).rentalLifecycle[template].heading;

  return {
    from: platformFromAddress(input.tenantName, input.fromEmail ? { fromEmail: input.fromEmail } : {}),
    to: input.customerEmail,
    subject,
    html,
    text,
    ...(input.sender.replyTo ? { replyTo: input.sender.replyTo } : {}),
  };
}
```

- [ ] **Krok 4: Uruchom — musi przejść**

Uruchom: `cd apps/panel && pnpm vitest run "app/[locale]/zamowienia/[id]/rental-email.test.ts"`
Oczekiwane: PASS (5/5).

Jeśli `emailMessages` nie jest eksportowane albo `heading` nie istnieje —
**STOP, raport do PM** (kontrakt cudzego pasa), nie łataj `packages/emails`.

- [ ] **Krok 5: Commit**

```bash
git add "apps/panel/app/[locale]/zamowienia/[id]/rental-email.ts" "apps/panel/app/[locale]/zamowienia/[id]/rental-email.test.ts"
git commit -m "feat(panel): mapowanie tranzycji na szablon e-maila cyklu najmu"
```

---

### Zadanie 4: Akcja tranzycji wysyła e-mail, nie blokując zmiany statusu

**Pliki:**
- Modyfikuj: `apps/panel/app/[locale]/zamowienia/actions.ts:202-260`
- Modyfikuj: `apps/panel/lib/order-validation.ts` (pole `sendEmail`)
- Test: `apps/panel/app/[locale]/zamowienia/status-email.test.ts` (utwórz)

**Interfejsy:**
- Konsumuje: `buildRentalEmail` (Zadanie 3), `emailAvailability`,
  `emailSenderFromSettings`, `resendTransport`, `EmailConfigError` (Zadanie 2).
- Produkuje: `changeOrderStatusAction` przyjmuje `sendEmail` z formularza;
  zwraca `{ success: "changed" }` (wysłano lub nie proszono) albo
  `{ success: "changed", formError: <powód niewysłania> }` — **tranzycja
  zawsze utrwalona**.

- [ ] **Krok 1: Rozszerz schemat walidacji**

W `apps/panel/lib/order-validation.ts` dopisz do `statusChangeSchema` pole:

```ts
  // Checkbox HTML nie wysyła nic, gdy odznaczony — stąd optional.
  sendEmail: z.literal("on").optional(),
```

- [ ] **Krok 2: Napisz failujący test**

Kluczowy mechanizm ochronny: **błąd wysyłki nie cofa tranzycji**.

```ts
import { describe, expect, it, vi } from "vitest";
import { sendRentalEmailForTransition } from "./actions";

describe("sendRentalEmailForTransition", () => {
  const order = {
    order_number: "AV-2026-001",
    start_date: "2026-08-01",
    end_date: "2026-08-05",
    total_rental_grosze: 55000,
    customers: { full_name: "Jan Kowalski", email: "klient@example.com" },
    pickup_locations: null,
  };

  it("brak klucza Resend → czytelny powód, zero prób wysyłki", async () => {
    const send = vi.fn();
    const result = await sendRentalEmailForTransition({
      status: "reserved",
      order,
      tenantName: "Demo",
      locale: "pl",
      currency: "PLN",
      settings: [{ key: "email_sender", value: { name: "Demo" } }],
      availability: { available: false, reason: "Wysyłka e-maili nie jest skonfigurowana (brak RESEND_API_KEY)." },
      transport: { send },
    });
    expect(send).not.toHaveBeenCalled();
    expect(result).toContain("RESEND_API_KEY");
  });

  // Twardy DoD planu fazy: klucz JEST, nadawcy NIE MA → czytelny błąd
  // konfiguracji, nie cichy sukces.
  it("brak nadawcy tenanta → czytelny błąd konfiguracji", async () => {
    const send = vi.fn();
    const result = await sendRentalEmailForTransition({
      status: "reserved",
      order,
      tenantName: "Demo",
      locale: "pl",
      currency: "PLN",
      settings: [],
      availability: { available: true },
      transport: { send },
    });
    expect(send).not.toHaveBeenCalled();
    expect(result).toContain("nadawc");
  });

  it("odmowa dostawcy → powód zwrócony, wyjątek nie ucieka", async () => {
    const send = vi.fn().mockRejectedValue(new Error("HTTP 422"));
    const result = await sendRentalEmailForTransition({
      status: "reserved",
      order,
      tenantName: "Demo",
      locale: "pl",
      currency: "PLN",
      settings: [{ key: "email_sender", value: { name: "Demo" } }],
      availability: { available: true },
      transport: { send },
    });
    expect(result).toBeTruthy();
  });

  it("sukces → brak powodu", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const result = await sendRentalEmailForTransition({
      status: "reserved",
      order,
      tenantName: "Demo",
      locale: "pl",
      currency: "PLN",
      settings: [{ key: "email_sender", value: { name: "Demo" } }],
      availability: { available: true },
      transport: { send },
    });
    expect(send).toHaveBeenCalledOnce();
    expect(result).toBeUndefined();
  });

  it("klient bez adresu → czytelny powód, zero prób", async () => {
    const send = vi.fn();
    const result = await sendRentalEmailForTransition({
      status: "reserved",
      order: { ...order, customers: null },
      tenantName: "Demo",
      locale: "pl",
      currency: "PLN",
      settings: [{ key: "email_sender", value: { name: "Demo" } }],
      availability: { available: true },
      transport: { send },
    });
    expect(send).not.toHaveBeenCalled();
    expect(result).toContain("adresu e-mail");
  });
});
```

- [ ] **Krok 3: Uruchom — musi failować**

Uruchom: `cd apps/panel && pnpm vitest run "app/[locale]/zamowienia/status-email.test.ts"`
Oczekiwane: FAIL — „sendRentalEmailForTransition is not a function".

- [ ] **Krok 4: Zaimplementuj helper i wepnij w akcję**

W `apps/panel/app/[locale]/zamowienia/actions.ts` dopisz eksportowany helper
(czysty względem I/O bazy — dane dostaje w argumencie, transport wstrzyknięty,
dzięki czemu testuje się bez Supabase i bez sieci):

```ts
/**
 * Wysyłka e-maila po udanej tranzycji. Zwraca POWÓD NIEWYSŁANIA albo
 * undefined przy sukcesie.
 *
 * NIGDY nie rzuca: tranzycja jest już utrwalona w bazie i żaden problem
 * z pocztą nie może jej cofnąć ani przebrać w błąd (wzorzec uczciwej
 * częściowej porażki z ADR-027 — mówimy dokładnie, co się nie udało,
 * zamiast udawać pełny sukces albo pełną porażkę).
 */
export async function sendRentalEmailForTransition(input: {
  status: OrderStatus;
  order: {
    order_number: string;
    start_date: string;
    end_date: string;
    total_rental_grosze: number;
    customers: { full_name: string | null; email: string } | null;
    pickup_locations: { name: string } | null;
  };
  tenantName: string;
  locale: Locale;
  currency: CurrencyCode;
  settings: TenantSettingRow[];
  availability: EmailAvailability;
  transport: EmailTransport;
}): Promise<string | undefined> {
  if (!input.availability.available) return input.availability.reason;

  const email = input.order.customers?.email;
  if (!email) return "Zamówienie nie ma adresu e-mail klienta — wiadomość nie została wysłana.";

  let sender;
  try {
    sender = emailSenderFromSettings(input.settings);
  } catch (err) {
    if (err instanceof EmailConfigError) return `${err.message} Wiadomość nie została wysłana.`;
    throw err;
  }

  try {
    const message = await buildRentalEmail({
      status: input.status,
      locale: input.locale,
      currency: input.currency,
      sender,
      tenantName: input.tenantName,
      customerEmail: email,
      customerName: input.order.customers?.full_name ?? email,
      orderNumber: input.order.order_number,
      startDate: input.order.start_date,
      endDate: input.order.end_date,
      totalRentalGrosze: input.order.total_rental_grosze,
      ...(input.order.pickup_locations?.name
        ? { pickupLocationName: input.order.pickup_locations.name }
        : {}),
    });
    if (!message) return undefined; // status bez szablonu — nie ma czego wysyłać
    await input.transport.send(message);
    return undefined;
  } catch (err) {
    return `Status zmieniony, ale nie udało się wysłać wiadomości: ${
      err instanceof Error ? err.message : "nieznany błąd"
    }`;
  }
}
```

W `changeOrderStatusAction`, **po** udanym UPDATE i **przed** `revalidatePath`,
wstaw blok wysyłki:

```ts
  // Wysyłka jest krokiem PO utrwalonej tranzycji i nigdy jej nie blokuje.
  let emailProblem: string | undefined;
  if (parsed.data.sendEmail === "on") {
    const [{ data: order }, { data: settings }, { data: tenant }, currency] = await Promise.all([
      ctx.supabase
        .from("orders")
        .select(
          "order_number, start_date, end_date, total_rental_grosze, customers(full_name, email), pickup_locations(name)",
        )
        .eq("tenant_id", ctx.tenantId)
        .eq("id", orderId)
        .maybeSingle(),
      ctx.supabase
        .from("tenant_settings")
        .select("key, value")
        .eq("tenant_id", ctx.tenantId)
        .eq("key", EMAIL_SENDER_KEY),
      ctx.supabase.from("tenants").select("name, locale").eq("id", ctx.tenantId).maybeSingle(),
      getTenantCurrency(ctx.supabase, ctx.tenantId),
    ]);

    if (order && tenant) {
      emailProblem = await sendRentalEmailForTransition({
        status: to as OrderStatus,
        order: order as never,
        tenantName: (tenant as { name: string }).name,
        locale: ((tenant as { locale: string }).locale === "en" ? "en" : "pl") as Locale,
        currency,
        settings: (settings ?? []) as TenantSettingRow[],
        availability: emailAvailability(),
        transport: resendTransport(),
      });
    }
  }

  revalidatePath("/", "layout");
  // Sukces NIESIE powód niewysłania: status JEST zmieniony, ale operator
  // musi wiedzieć, że klient nic nie dostał.
  return emailProblem ? { success: "changed", formError: emailProblem } : { success: "changed" };
```

Uzupełnij importy w `actions.ts`:

```ts
import {
  EMAIL_SENDER_KEY,
  EmailConfigError,
  emailAvailability,
  emailSenderFromSettings,
  resendTransport,
  type CurrencyCode,
  type EmailAvailability,
  type EmailTransport,
  type Locale,
  type TenantSettingRow,
} from "@avably/core";
import { getTenantCurrency } from "@/lib/tenant-currency";
import { buildRentalEmail } from "./[id]/rental-email";
```

- [ ] **Krok 5: Uruchom — musi przejść**

Uruchom: `cd apps/panel && pnpm vitest run "app/[locale]/zamowienia/status-email.test.ts"`
Oczekiwane: PASS (5/5).

- [ ] **Krok 6: Dowód mutacyjny — niech wysyłka blokuje tranzycję**

W `sendRentalEmailForTransition` zamień `return ...` w bloku `catch` na
`throw err`. Uruchom testy. Oczekiwane: test „odmowa dostawcy → powód
zwrócony, wyjątek nie ucieka" **czerwony**. Przywróć `return`.

Drugi dowód: usuń warunek `if (!input.availability.available)`. Oczekiwane:
test „brak klucza Resend → czytelny powód, zero prób wysyłki" **czerwony**
(`send` zostaje wywołany). Przywróć. Zapisz oba do raportu.

- [ ] **Krok 7: Commit**

```bash
git add "apps/panel/app/[locale]/zamowienia/actions.ts" "apps/panel/app/[locale]/zamowienia/status-email.test.ts" apps/panel/lib/order-validation.ts
git commit -m "feat(panel): e-mail cyklu najmu przy tranzycji, bez blokowania zmiany statusu"
```

---

### Zadanie 5: Przełącznik „wyślij e-mail" w UI

**Pliki:**
- Modyfikuj: `apps/panel/app/[locale]/zamowienia/[id]/status-buttons.tsx`
- Modyfikuj: `apps/panel/app/[locale]/zamowienia/[id]/page.tsx`
- Modyfikuj: `apps/panel/messages/en.json`, `apps/panel/messages/pl.json`

**Interfejsy:**
- Konsumuje: `TEMPLATE_FOR_STATUS` (Zadanie 3), `emailAvailability` (Zadanie 2).
- Produkuje: `StatusButtons` przyjmuje dodatkowo
  `emailAvailability: { available: boolean; reason?: string }`.

- [ ] **Krok 1: Dopisz teksty i18n**

W `apps/panel/messages/pl.json`, w `orders.detail`:

```json
      "sendEmail": "Wyślij e-mail do klienta",
      "sendEmailUnavailable": "Wysyłka e-maili nie jest skonfigurowana — klient nie dostanie powiadomienia.",
      "sendEmailNoTemplate": "Dla tego przejścia nie ma wiadomości do klienta."
```

W `apps/panel/messages/en.json`, w `orders.detail`:

```json
      "sendEmail": "Send email to customer",
      "sendEmailUnavailable": "Email sending is not configured — the customer will not be notified.",
      "sendEmailNoTemplate": "This transition has no customer message."
```

- [ ] **Krok 2: Dodaj checkbox w `status-buttons.tsx`**

Zmień sygnaturę i wnętrze formularza. Checkbox **per przycisk** (każde
przejście to osobny `<form>`), domyślnie zaznaczony gdy konfiguracja
kompletna, wyłączony i odznaczony gdy nie:

```tsx
export function StatusButtons({
  action,
  orderId,
  currentStatus,
  paymentStatus,
  emailAvailability,
}: {
  action: (prevState: FormState, formData: FormData) => Promise<FormState>;
  orderId: string;
  currentStatus: OrderStatus;
  paymentStatus: PaymentStatus;
  emailAvailability: { available: boolean; reason?: string };
}) {
```

Wewnątrz `targets.map`, przed `<Button>`, dodaj (pamiętaj o imporcie
`TEMPLATE_FOR_STATUS` z `./rental-email`):

```tsx
          const hasTemplate = TEMPLATE_FOR_STATUS[target] !== undefined;
```

i pod przyciskiem, wewnątrz tego samego `<form>`:

```tsx
              {hasTemplate ? (
                <label className="mt-1 flex items-center gap-1.5 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    name="sendEmail"
                    defaultChecked={emailAvailability.available}
                    disabled={!emailAvailability.available || pending}
                  />
                  {t("sendEmail")}
                </label>
              ) : null}
```

Pod całą listą przycisków, obok `cancelBlocked`, dodaj **jawny powód
niedostępności** — brak konfiguracji ma być widoczny, nie domyślny:

```tsx
      {!emailAvailability.available ? (
        <p className="text-xs text-amber-700">{emailAvailability.reason ?? t("sendEmailUnavailable")}</p>
      ) : null}
```

- [ ] **Krok 3: Przekaż dostępność ze strony**

W `apps/panel/app/[locale]/zamowienia/[id]/page.tsx` dodaj import
`emailAvailability` z `@avably/core` i przekaż wynik do `StatusButtons`:

```tsx
        <StatusButtons
          action={changeOrderStatusAction}
          orderId={order.id}
          currentStatus={order.order_status}
          paymentStatus={order.payment_status}
          emailAvailability={emailAvailability()}
        />
```

- [ ] **Krok 4: Sprawdź typy i lint**

```bash
cd apps/panel && pnpm typecheck && pnpm lint
```
Oczekiwane: zero błędów.

- [ ] **Krok 5: Commit**

```bash
git add "apps/panel/app/[locale]/zamowienia/[id]/status-buttons.tsx" "apps/panel/app/[locale]/zamowienia/[id]/page.tsx" apps/panel/messages/en.json apps/panel/messages/pl.json
git commit -m "feat(panel): przełącznik wysyłki e-maila przy zmianie statusu"
```

---

### Zadanie 6: Weryfikacja w przeglądarce

**Pliki:** brak zmian (weryfikacja).

- [ ] **Krok 1: Sprawdź migracje przed weryfikacją**

Lekcja sesji równoległych — wspólny stack Supabase; cudzy `db reset` mógł
zdjąć twoją migrację:

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$HOME/.local/share/supabase:$PATH"
cd packages/db && supabase migration list
```
Oczekiwane: `0014` obecne lokalnie. Jeśli nie — `supabase db reset` i odtwórz
dane demo.

- [ ] **Krok 2: Uruchom panel i zaloguj demo**

`preview_start` z konfiguracją `avably-panel` (`.claude/launch.json`).
Zaloguj `demo@avably.local`, wejdź w zamówienie AV-2026-001.

- [ ] **Krok 3: Sprawdź stan bez klucza Resend**

Bez `RESEND_API_KEY` w środowisku panelu.
Oczekiwane: checkbox „Wyślij e-mail do klienta" **odznaczony i wyłączony**,
pod przyciskami widoczny powód („Wysyłka e-maili nie jest skonfigurowana…").
Zrób screenshot do raportu.

- [ ] **Krok 4: Wykonaj tranzycję i potwierdź uczciwy stan**

Zmień status (np. → `reserved`).
Oczekiwane: status **zmieniony** (tranzycja przeszła), UI **nie twierdzi**,
że wysłał wiadomość. Screenshot.

- [ ] **Krok 5: Kontrola negatywna — klucz ustawiony, nadawcy brak**

Zatrzymaj serwer, ustaw `RESEND_API_KEY=re_test_niepoprawny`, uruchom
ponownie (`RESEND_API_KEY` jest czytany po stronie serwera, ale **restart
jest konieczny** — proces czyta env na starcie).

Upewnij się, że tenant demo NIE ma klucza `email_sender`:

```sql
delete from public.tenant_settings where key = 'email_sender';
```

Zaznacz checkbox (teraz aktywny), wykonaj tranzycję.
Oczekiwane: status zmieniony + komunikat „Konfiguracja nadawcy e-maili jest
niekompletna: brak nazwy nadawcy…". **To jest twardy DoD planu fazy.**
Screenshot.

- [ ] **Krok 6: Pełne testy i bramki**

```bash
cd /Users/godekmaciej/rental-platform/.claude/worktrees/emaile-cyklu
pnpm test && pnpm typecheck && pnpm lint
```
Oczekiwane: zielone. Zweryfikuj bramki `--force` (czy któryś krok CI nie jest
przepychany flagą).

---

### Zadanie 7: Dokumentacja i PR

**Pliki:**
- Modyfikuj: `docs/dokumentacja/index.html` (ADR-033 + karta modułu),
  `docs/DOKUMENTACJA.md`, dziennik.

- [ ] **Krok 1: Napisz ADR-033**

Tytuł: „Wysyłka e-maili cyklu najmu: wspólny adres platformy, transport
wstrzykiwany, jawna niedostępność". Treść: **wszystkie sześć decyzji** z
sekcji „Decyzje projektowe" tego planu, każda z uzasadnieniem i odrzuconą
alternatywą. Obowiązkowo:
- dlaczego adres jest platformowy, a nie per tenant (koszt DNS per najemca),
- **dlaczego semantyka różni się od Turnstile** (cichy sukces jest tu
  groźniejszy niż brak weryfikacji CAPTCHY w dev),
- dlaczego locale z `tenants.locale`, nie z `tenant_settings` (odejście od
  rekomendacji briefu — źródło już istnieje, 0005),
- dlaczego waluta z `getTenantCurrency`, nie z `plans.currency` (odejście od
  briefu — e-mail musi zgadzać się z ekranem panelu),
- dług: preferencja językowa klienta (`customers` nie ma locale).

- [ ] **Krok 2: Karta modułu + dziennik**

Karta modułu e-maili cyklu najmu (co robi, gdzie mieszka, jak włączyć).
Wpis do dziennika **na górze**; cudzych wpisów nie ruszasz.

- [ ] **Krok 3: Rebase na main tuż przed PR**

```bash
git fetch origin && git rebase origin/main
```
Konflikt dziennika rozwiązujesz po swojej stronie (twój wpis na górze).
Po rebase **ponownie** `pnpm test`.

- [ ] **Krok 4: Commit i PR**

```bash
git add docs/
git commit -m "docs: ADR-033, karta modułu i dziennik wysyłki e-maili cyklu najmu"
git push -u origin feat/zadanie-8b-wysylka-emaili
```

PR do main z opisem: zakres, decyzje ADR-033, dowody mutacyjne, **lista
kroków właściciela w Resend** (Zadanie 8 poniżej).

---

### Zadanie 8: Lista kroków właściciela do włączenia realnej wysyłki

**Pliki:** sekcja w opisie PR + karta modułu.

- [ ] **Krok 1: Spisz dokładną listę**

Do raportu i do karty modułu — kod wchodzi bez konta Resend, więc lista musi
być wykonalna bez pytań zwrotnych:

1. Założyć konto na resend.com (region EU — spójnie ze stackiem).
2. Dodać domenę `send.avably.io` (Domains → Add Domain, region EU).
3. Wpiąć rekordy DNS w Cloudflare dla `avably.io`: `MX` + `TXT` (SPF)
   na `send`, `TXT` (DKIM) na `resend._domainkey.send`. **DNS only**
   (bez proxy — poczta nie chodzi przez proxy Cloudflare).
4. Poczekać na status „Verified" w panelu Resend.
5. Wygenerować klucz API (Sending access).
6. Wpiąć w Vercelu (projekt panelu): `RESEND_API_KEY` jako **sensitive**
   oraz `RESEND_FROM_EMAIL` = `Avably <noreply@send.avably.io>`.
7. Przebudować panel — `RESEND_API_KEY` czytany jest po stronie serwera przy
   starcie procesu.
8. Ustawić nadawcę tenanta w panelu (`email_sender.name`), inaczej wysyłka
   zablokuje się z czytelnym błędem konfiguracji — celowo.
