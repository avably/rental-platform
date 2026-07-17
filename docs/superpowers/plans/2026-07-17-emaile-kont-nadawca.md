# E-maile kont na wspólnym transporcie + formularz nadawcy — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: użyj superpowers:executing-plans, żeby wykonać ten plan zadanie po zadaniu. Kroki mają checkboxy (`- [ ]`).

**Goal:** Przepiąć e-mail zaproszenia na wspólny transport (ADR-033) z szablonem 8a, dać operatorowi formularz nadawcy e-maili w panelu, i rozstrzygnąć (bez implementacji na siłę) wiring resetu/potwierdzenia/powiadomienia o zamówieniu.

**Architecture:** Trzy warstwy 8b reużywane 1:1 — port `@avably/core/email` (`resendTransport`, `emailAvailability`, `platformFromAddress`, `emailSenderFromSettings`), złożenie wiadomości w panelu (nowy builder w `apps/panel/lib/email.ts`, wzorem `zamowienia/[id]/rental-email.ts`), UI (formularz + banery stanu). Nadawca czytany z `tenant_settings.email_sender` (CHECK 0014, już istnieje). Zero nowych migracji.

**Tech Stack:** Next.js App Router (server actions, `useActionState`), Zod, next-intl (EN+PL), Supabase (RLS + CHECK), Resend przez wstrzykiwany `fetch`, Vitest.

## Global Constraints

- Gałąź `feat/emaile-kont-nadawca` (worktree `.claude/worktrees/emaile-kont` od `origin/main` 9748153); PR do `main`, NIGDY push na main.
- Autor commitów `Avably <admin@avably.io>`; zero wzmianek o AI, zero nazw konkurencji, zero `Co-Authored-By`; komunikaty commitów po polsku.
- `packages/emails` = pas cudzy: NIE zmieniamy szablonów ani ich kontraktu. Kontrakt `renderOrganizationInvitation({acceptanceUrl, locale, organizationName, role, recipientName?})` + `emailMessages(locale).organizationInvitation.heading` — wystarcza. Jeśli okaże się, że NIE wystarcza → STOP, zapisać i zgłosić PM.
- i18n: każdy NOWY klucz w OBU `apps/panel/messages/{en,pl}.json`.
- TDD + dowody mutacyjne dla każdego mechanizmu ochronnego. Asercje na KONKRETNYM zachowaniu, nie „cokolwiek". Pytanie kontrolne o maskowanie przy każdym dowodzie.
- Env testów (z katalogu `packages/db`): `export PATH="/opt/homebrew/opt/node@22/bin:$HOME/.local/share/supabase:$PATH"`; `supabase status -o env` → `SUPABASE_LOCAL_URL` = **DB_URL** (connection string Postgresa), `SUPABASE_LOCAL_API_URL` = API_URL, plus ANON/SERVICE_ROLE. NIE `db reset`; nie kasować kont demo.
- Podgląd panelu: własny wpis w `launch.json` (port 3022, ścieżka worktree). Nie ruszać portów 3000/3021.

## Decyzje projektowe (→ ADR-036)

**D1 — semantyka niedostępności zaproszeń = lustro ADR-033 (jawność, nigdy cichy sukces).** Brak `RESEND_API_KEY` → e-mail NIE wysłany; formularz zaproszeń pokazuje powód Z GÓRY (wzorzec 8b: powód przy kontrolce), a komunikat sukcesu po wysłaniu mówi WPROST „Zaproszenie utworzone; e-mail nie wysłany (brak konfiguracji wysyłki) — przekaż link ręcznie: <url>". Log linku w konsoli (relikt) zastąpiony JAWNYM linkiem w komunikacie UI — uczciwa opcja zaproponowana w briefie. Błąd dostawcy przy ustawionym kluczu → ta sama uczciwa częściowa porażka („Zaproszenie utworzone, ale e-mail nie wyszedł: <powód>. Link: <url>"). Rekord zaproszenia powstaje ZAWSZE — poczta nigdy nie blokuje operacji (wzorzec 8b).

**D2 — nadawca zaproszeń.** Pole From = `platformFromAddress(tenants.name)` — DOKŁADNIE jak 8b używa `tenantName` (nazwa wyświetlana z `tenants.name`, adres = stała platformy). Klucz `email_sender` wnosi wyłącznie `reply_to`. Fallback przy BRAKU `email_sender`: brak `reply_to`, wysyłka z `tenants.name` — legalne, bo `tenants.name` to WŁASNA nazwa najemcy, nie obca marka platformy, której ADR-033 zabrania podstawiać. Świadoma ASYMETRIA z 8b (które twardo blokuje e-maile cyklu najmu przy braku `email_sender`): e-maile najmu idą do KLIENTÓW (zewnętrzni, wrażliwi na markę, ekran nadawcy = jawny wybór operatora), zaproszenia idą do przyszłych OPERATORÓW, a `tenants.name` jest autorytatywne i już w ręku — bramkowanie pierwszego zaproszenia ekranem ustawień to tarcie bez korzyści ochronnej. `email_sender` OBECNY, ale wadliwy (zły typ `reply_to`) → uczciwy powód niewysłania (parser `emailSenderFromSettings` już to niesie).

**D3 — reset/potwierdzenie = dług deployu prod, nie kod.** `resetPasswordForEmail`/`signUp` idą przez wbudowany mailer GoTrue (Supabase Auth). Podmiana na szablony 8a wymaga Send Email Hooka albo custom SMTP w konfiguracji Supabase (dashboard prod / `config.toml`), czyli pracy poza kodem repo bez lokalnej weryfikacji czystej. → UDOKUMENTOWAĆ drogę operacyjną, NIE implementować.

**D4 — `new-order-notification` zostaje NIEwpięty.** Jedyny sensowny punkt wysyłki (zamówienie ze storefrontu) jeszcze nie istnieje. Zapis w karcie modułu.

---

## Struktura plików

- `apps/panel/lib/email.ts` — MODIFY (wymiana reliktu): builder `buildInvitationEmail` + `sendInvitationEmail` (nie rzuca, zwraca wynik), na `resendTransport`/`renderOrganizationInvitation`/`platformFromAddress`.
- `apps/panel/app/[locale]/zaproszenia/actions.ts` — MODIFY (tylko blok wysyłki): dociągnąć `tenants.name/locale` + `email_sender`, złożyć nadawcę, wywołać wysyłkę, złożyć uczciwy komunikat.
- `apps/panel/app/[locale]/zaproszenia/page.tsx` — MODIFY: policzyć `emailAvailability()`, podać powód do formularza.
- `apps/panel/app/[locale]/zaproszenia/form.tsx` — MODIFY (minimalnie): baner „wysyłka niedostępna" przy braku klucza.
- `apps/panel/app/[locale]/ustawienia-emaili/page.tsx` — CREATE: strona ustawień nadawcy + stan dostępności.
- `apps/panel/app/[locale]/ustawienia-emaili/email-settings-validation.ts` — CREATE: Zod lustro CHECK-a 0014.
- `apps/panel/app/[locale]/ustawienia-emaili/email-settings-actions.ts` — CREATE: upsert `email_sender`.
- `apps/panel/app/[locale]/ustawienia-emaili/email-settings-form.tsx` — CREATE: formularz (client).
- `apps/panel/app/[locale]/page.tsx` — MODIFY: link w nawigacji.
- `apps/panel/messages/{en,pl}.json` — MODIFY: namespace `emailSettings.*` + `home.emailSettingsLink`.
- `apps/panel/test/invitation-email.test.ts` — CREATE: testy buildera/wysyłki zaproszenia.
- `apps/panel/test/email-settings-validation.test.ts` — CREATE: testy schematu nadawcy.
- `packages/db/test/email-sender.integration.test.ts` — (jeśli nie pokrywa tego test z 8b) negatywna kontrola bramki bazy (23514) przy pustej nazwie. NAJPIERW zweryfikować istniejące pokrycie.
- `docs/dokumentacja/index.html` — MODIFY: ADR-036, dziennik, karta modułu, tabela długów.
- `docs/dokumentacja/hub.html` — MODIFY: nota „ostatnia zmiana".
- `.claude/launch.json` (worktree) — MODIFY: wpis podglądu na porcie 3022.

---

### Task 1: Builder i wysyłka zaproszenia na wspólnym transporcie

**Files:**
- Modify: `apps/panel/lib/email.ts` (całość — wymiana reliktu)
- Test: `apps/panel/test/invitation-email.test.ts`

**Interfaces:**
- Consumes z `@avably/core`: `emailAvailability`, `platformFromAddress`, `resendTransport`, `emailSenderFromSettings`, `EmailConfigError`, typy `EmailAvailability`, `EmailTransport`, `OutgoingEmail`, `TenantSettingRow`, `Locale`, `DEFAULT_TENANT_LOCALE`, `isLocale`. Z `@avably/emails`: `renderOrganizationInvitation`, `emailMessages`, typ `InvitationRole`.
- Produces (używane przez `actions.ts`):
  - `buildInvitationEmail(input: InvitationEmailInput): Promise<OutgoingEmail>`
  - `sendInvitationEmail(input: SendInvitationEmailInput): Promise<string | undefined>` — zwraca POWÓD niewysłania albo `undefined` (wysłano). NIGDY nie rzuca.
  - typy `InvitationEmailInput`, `SendInvitationEmailInput`.

```ts
export interface InvitationEmailInput {
  to: string;
  acceptUrl: string;
  locale: Locale;
  organizationName: string;   // tenants.name — nazwa w polu From i w treści (D2)
  role: InvitationRole;
  replyTo?: string;
  fromEmail?: string;         // nadpisanie adresu platformy w teście
}

export interface SendInvitationEmailInput {
  to: string;
  acceptUrl: string;
  locale: Locale;
  organizationName: string;
  role: InvitationRole;
  settings: TenantSettingRow[];   // wiersze email_sender (może być pusto)
  availability: EmailAvailability;
  transport: EmailTransport;
  fromEmail?: string;
}
```

- [ ] **Step 1: Testy (failing).** `apps/panel/test/invitation-email.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { EmailTransport, OutgoingEmail, TenantSettingRow } from "@avably/core";
import { buildInvitationEmail, sendInvitationEmail } from "@/lib/email";

const base = {
  to: "nowy@example.com",
  acceptUrl: "https://www.avably.io/zaproszenie/abc123",
  locale: "pl" as const,
  organizationName: "Wypożyczalnia Demo",
  role: "staff" as const,
};

function captureTransport(): { transport: EmailTransport; sent: OutgoingEmail[] } {
  const sent: OutgoingEmail[] = [];
  return { transport: { send: async (e) => void sent.push(e) }, sent };
}

describe("buildInvitationEmail", () => {
  it("składa From z nazwy tenanta i adresu platformy oraz temat z 8a", async () => {
    const email = await buildInvitationEmail({ ...base, fromEmail: "noreply@send.avably.io" });
    expect(email.from).toBe("Wypożyczalnia Demo <noreply@send.avably.io>");
    expect(email.to).toBe("nowy@example.com");
    expect(email.subject).toBe("Zaproszenie do organizacji"); // emailMessages("pl").organizationInvitation.heading
    expect(email.html).toContain("abc123");
    expect(email.text).toContain("abc123");
  });

  it("dokłada reply_to tylko gdy podany", async () => {
    const withReply = await buildInvitationEmail({ ...base, replyTo: "biuro@demo.pl" });
    expect(withReply.replyTo).toBe("biuro@demo.pl");
    const without = await buildInvitationEmail(base);
    expect(without.replyTo).toBeUndefined();
  });
});

describe("sendInvitationEmail", () => {
  const settings: TenantSettingRow[] = [];

  it("bez dostępności zwraca powód i NIE woła transportu", async () => {
    const { transport, sent } = captureTransport();
    const reason = await sendInvitationEmail({
      ...base, settings, transport,
      availability: { available: false, reason: "Wysyłka e-maili nie jest skonfigurowana (brak RESEND_API_KEY)." },
    });
    expect(reason).toMatch(/nie jest skonfigurowana/);
    expect(sent).toHaveLength(0);
  });

  it("przy dostępności wysyła i zwraca undefined; From ma nazwę tenanta", async () => {
    const { transport, sent } = captureTransport();
    const reason = await sendInvitationEmail({
      ...base, settings, transport,
      availability: { available: true }, fromEmail: "noreply@send.avably.io",
    });
    expect(reason).toBeUndefined();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.from).toBe("Wypożyczalnia Demo <noreply@send.avably.io>");
  });

  it("czyta reply_to z email_sender, gdy ustawiony", async () => {
    const { transport, sent } = captureTransport();
    await sendInvitationEmail({
      ...base, transport, availability: { available: true },
      settings: [{ key: "email_sender", value: { name: "X", reply_to: "biuro@demo.pl" } } as TenantSettingRow],
    });
    expect(sent[0]!.replyTo).toBe("biuro@demo.pl");
  });

  it("email_sender obecny, ale wadliwy → uczciwy powód, brak wysyłki", async () => {
    const { transport, sent } = captureTransport();
    const reason = await sendInvitationEmail({
      ...base, transport, availability: { available: true },
      settings: [{ key: "email_sender", value: { name: "X", reply_to: 42 } } as unknown as TenantSettingRow],
    });
    expect(reason).toBeTruthy();
    expect(sent).toHaveLength(0);
  });

  it("błąd transportu → powód, nie wyjątek", async () => {
    const reason = await sendInvitationEmail({
      ...base, settings, availability: { available: true },
      transport: { send: async () => { throw new Error("Dostawca odrzucił (HTTP 422)."); } },
    });
    expect(reason).toMatch(/422/);
  });
});
```

- [ ] **Step 2: Uruchom — czerwone.** `pnpm --filter @avably/panel test invitation-email` → FAIL (brak eksportów `buildInvitationEmail`/`sendInvitationEmail`).

- [ ] **Step 3: Implementacja** — całość `apps/panel/lib/email.ts`:

```ts
/**
 * Złożenie i wysyłka e-maila zaproszenia na WSPÓLNYM transporcie (ADR-033/036).
 *
 * Wymiana reliktu sprzed Zadania 8b (surowy fetch + inline HTML + cichy
 * dev-skip). Trzy warstwy 8b reużyte: szablon 8a (renderOrganizationInvitation),
 * port transportu (resendTransport, wstrzykiwany) i nadawca platformy
 * (platformFromAddress). Semantyka niedostępności = lustro ADR-033: brak klucza
 * to JAWNY powód niewysłania, nigdy udawany sukces (ADR-036 D1).
 *
 * Nadawca (ADR-036 D2): pole From = nazwa tenanta (tenants.name) + adres
 * platformy, dokładnie jak w e-mailach cyklu najmu. email_sender wnosi tylko
 * reply_to; jego BRAK jest legalny (fallback: bez reply_to) — nazwa najemcy to
 * nie obca marka, więc podstawienie nie łamie zakazu z ADR-033.
 *
 * NIE RZUCA (jak sendRentalEmailForTransition): zwraca powód niewysłania albo
 * undefined. Rekord zaproszenia powstaje przed wysyłką i poczta go nie cofa.
 */
import {
  DEFAULT_TENANT_LOCALE,
  EmailConfigError,
  emailSenderFromSettings,
  isLocale,
  platformFromAddress,
  type EmailAvailability,
  type EmailTransport,
  type Locale,
  type OutgoingEmail,
  type TenantSettingRow,
} from "@avably/core";
import {
  emailMessages,
  renderOrganizationInvitation,
  type InvitationRole,
} from "@avably/emails";

export interface InvitationEmailInput {
  to: string;
  acceptUrl: string;
  locale: Locale;
  organizationName: string;
  role: InvitationRole;
  replyTo?: string;
  fromEmail?: string;
}

export async function buildInvitationEmail(input: InvitationEmailInput): Promise<OutgoingEmail> {
  const { html, text } = await renderOrganizationInvitation({
    acceptanceUrl: input.acceptUrl,
    locale: input.locale,
    organizationName: input.organizationName,
    role: input.role,
  });
  return {
    from: platformFromAddress(
      input.organizationName,
      input.fromEmail ? { fromEmail: input.fromEmail } : {},
    ),
    to: input.to,
    subject: emailMessages(input.locale).organizationInvitation.heading,
    html,
    text,
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
  };
}

export interface SendInvitationEmailInput {
  to: string;
  acceptUrl: string;
  locale: Locale;
  organizationName: string;
  role: InvitationRole;
  settings: TenantSettingRow[];
  availability: EmailAvailability;
  transport: EmailTransport;
  fromEmail?: string;
}

/** Bezpieczne locale tenanta — nieznana wartość spada na domyślne (jak 8b). */
export function invitationLocale(raw: string | null | undefined): Locale {
  return isLocale(raw ?? "") ? (raw as Locale) : DEFAULT_TENANT_LOCALE;
}

export async function sendInvitationEmail(
  input: SendInvitationEmailInput,
): Promise<string | undefined> {
  if (!input.availability.available) return input.availability.reason;

  // reply_to z email_sender: BRAK klucza jest legalny (fallback D2), OBECNY
  // ale wadliwy → uczciwy powód. Rozróżnienie po obecności wiersza.
  let replyTo: string | undefined;
  if (input.settings.some((r) => r.key === "email_sender")) {
    try {
      replyTo = emailSenderFromSettings(input.settings).replyTo;
    } catch (err) {
      if (err instanceof EmailConfigError) {
        return `${err.message} Zaproszenie nie zostało wysłane e-mailem.`;
      }
      throw err;
    }
  }

  try {
    const email = await buildInvitationEmail({
      to: input.to,
      acceptUrl: input.acceptUrl,
      locale: input.locale,
      organizationName: input.organizationName,
      role: input.role,
      ...(replyTo ? { replyTo } : {}),
      ...(input.fromEmail ? { fromEmail: input.fromEmail } : {}),
    });
    await input.transport.send(email);
    return undefined;
  } catch (err) {
    return `Zaproszenie utworzone, ale e-mail nie wyszedł: ${
      err instanceof Error ? err.message : "nieznany błąd"
    }`;
  }
}
```

- [ ] **Step 4: Zielone.** `pnpm --filter @avably/panel test invitation-email` → PASS.

- [ ] **Step 5: Dowody mutacyjne (spal → cofnij).**
  1. `if (!input.availability.available) return ...` → usuń bramkę: pali „bez dostępności… NIE woła transportu". Kontrola maskowania: nic innego nie sprawdza klucza w tej funkcji → odmowa wyłącznie z tej bramki.
  2. Zamiana `catch → return` przy transporcie na `throw`: pali „błąd transportu → powód, nie wyjątek". Maskowanie: brak innego łapania → wyjątek uciekłby do akcji.
  3. Warunek `settings.some(email_sender)` → stałe `true`: pali „bez email_sender wysyła" (bo `emailSenderFromSettings([])` rzuci EmailConfigError „brak nazwy"). Maskowanie: potwierdza, że fallback D2 zależy właśnie od obecności wiersza, nie od czegoś innego.
  4. `platformFromAddress(input.organizationName)` → wpisz stałą platformy zamiast nazwy: pali „From ma nazwę tenanta". Maskowanie: From to jedyny nośnik marki najemcy w tej wiadomości.

- [ ] **Step 6: Commit.** `git add apps/panel/lib/email.ts apps/panel/test/invitation-email.test.ts && git commit -m "feat(panel): zaproszenia na wspólnym transporcie e-maili (ADR-036)"`

---

### Task 2: Wpięcie wysyłki w akcję zaproszeń + baner niedostępności

**Files:**
- Modify: `apps/panel/app/[locale]/zaproszenia/actions.ts` (blok po INSERT-cie zaproszenia)
- Modify: `apps/panel/app/[locale]/zaproszenia/page.tsx` (policz `emailAvailability()`)
- Modify: `apps/panel/app/[locale]/zaproszenia/form.tsx` (baner)

**Interfaces:**
- Consumes: `sendInvitationEmail`, `invitationLocale` (Task 1); `emailAvailability`, `resendTransport`, `EMAIL_SENDER_KEY`, `TenantSettingRow` z `@avably/core`.
- Produces: `inviteMemberAction` nadal zwraca `InviteMemberState { error?, success? }`; `success` niesie uczciwy komunikat (z linkiem, gdy niewysłano). `InviteMemberForm` przyjmuje prop `emailUnavailableReason?: string`.

- [ ] **Step 1:** W `zaproszenia/actions.ts`, po udanym `insert` do `invitations` (zamiast obecnego `await sendInvitationEmail({to, acceptUrl})`):

```ts
  const acceptUrl = `${siteUrl()}/zaproszenie/${rawToken}`;

  // Dane do wiadomości: nazwa+locale tenanta i nadawca (reply_to). Jedna runda.
  const [tenantResult, settingsResult] = await Promise.all([
    ctx.supabase.from("tenants").select("name, locale").eq("id", ctx.tenantId).maybeSingle(),
    ctx.supabase
      .from("tenant_settings")
      .select("key, value")
      .eq("tenant_id", ctx.tenantId)
      .eq("key", EMAIL_SENDER_KEY),
  ]);
  const tenant = tenantResult.data as { name: string; locale: string | null } | null;

  // Rekord JEST utworzony — brak danych tenanta nie może go cofnąć; wtedy
  // podajemy link do ręcznego przekazania (ADR-036 D1).
  const emailProblem = !tenant
    ? "nie udało się odczytać danych organizacji"
    : await sendInvitationEmail({
        to: parsed.data.email,
        acceptUrl,
        locale: invitationLocale(tenant.locale),
        organizationName: tenant.name,
        role: parsed.data.role,
        settings: (settingsResult.data ?? []) as TenantSettingRow[],
        availability: emailAvailability(),
        transport: resendTransport(),
      });

  if (emailProblem) {
    return {
      success: `Zaproszenie utworzone, ale e-mail nie wyszedł (${emailProblem}). Przekaż link ręcznie: ${acceptUrl}`,
    };
  }
  return { success: `Zaproszenie wysłane na ${parsed.data.email}.` };
```

  Import: dołożyć `emailAvailability, resendTransport, EMAIL_SENDER_KEY, type TenantSettingRow` z `@avably/core`; `sendInvitationEmail, invitationLocale` z `@/lib/email` (już importowany). Usunąć nieaktualny stary import kształtu wysyłki.

- [ ] **Step 2:** W `zaproszenia/page.tsx`: po `requireMember("owner")` policzyć `const emailUnavailable = emailAvailability().reason;` (import `emailAvailability` z `@avably/core`) i przekazać `<InviteMemberForm emailUnavailableReason={emailUnavailable} />`.

- [ ] **Step 3:** W `zaproszenia/form.tsx`: przyjąć prop `emailUnavailableReason?: string`; nad przyciskiem dodać minimalny baner:

```tsx
{emailUnavailableReason ? (
  <p role="status" className="rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-800">
    Wysyłka e-maili jest niedostępna: {emailUnavailableReason} Zaproszenie utworzysz, ale link trzeba przekazać ręcznie.
  </p>
) : null}
```

- [ ] **Step 4: Typecheck + testy panelu.** `pnpm --filter @avably/panel typecheck && pnpm --filter @avably/panel test` → zielone. (Test integracyjny akcji z FormData powstaje w Tasku 4 razem z lekcją 8b.)

- [ ] **Step 5: Commit.** `git commit -am "feat(panel): akcja zaproszeń woła wspólną wysyłkę + baner niedostępności"`

---

### Task 3: Zod nadawcy e-maili (lustro CHECK-a 0014)

**Files:**
- Create: `apps/panel/app/[locale]/ustawienia-emaili/email-settings-validation.ts`
- Test: `apps/panel/test/email-settings-validation.test.ts`

**Interfaces:**
- Produces: `emailSenderSchema` (Zod) → jsonb `{ name: string, reply_to?: string }` (snake_case, gotowe do upsert). Lustro CHECK 0014: `name` 1..120 po btrim (wymagane), `reply_to` opcjonalne 3..320 (długość, bez formatu — jak CHECK; baza jest bramką ostateczną).

- [ ] **Step 1: Testy (failing).** `apps/panel/test/email-settings-validation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { emailSenderSchema } from "@/app/[locale]/ustawienia-emaili/email-settings-validation";

describe("emailSenderSchema", () => {
  it("przycina nazwę i produkuje snake_case bez reply_to", () => {
    const r = emailSenderSchema.safeParse({ name: "  Demo  ", replyTo: "" });
    expect(r.success && r.data).toEqual({ name: "Demo" });
  });
  it("dokłada reply_to gdy podany", () => {
    const r = emailSenderSchema.safeParse({ name: "Demo", replyTo: " biuro@demo.pl " });
    expect(r.success && r.data).toEqual({ name: "Demo", reply_to: "biuro@demo.pl" });
  });
  it("pusta nazwa (same spacje) odrzucona", () => {
    expect(emailSenderSchema.safeParse({ name: "   ", replyTo: "" }).success).toBe(false);
  });
  it("nazwa > 120 po btrim odrzucona", () => {
    expect(emailSenderSchema.safeParse({ name: "x".repeat(121), replyTo: "" }).success).toBe(false);
  });
  it("reply_to krótsze niż 3 odrzucone", () => {
    expect(emailSenderSchema.safeParse({ name: "Demo", replyTo: "ab" }).success).toBe(false);
  });
  it("reply_to > 320 odrzucone", () => {
    expect(emailSenderSchema.safeParse({ name: "Demo", replyTo: "a".repeat(321) }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Czerwone.** `pnpm --filter @avably/panel test email-settings-validation` → FAIL.

- [ ] **Step 3: Implementacja.**

```ts
/**
 * Walidacja nadawcy e-maili — lustro CHECK-a tenant_settings_email_sender_valid
 * (migracja 0014, ADR-033). Schemat PRODUKUJE jsonb w kształcie bazy
 * (snake_case): { name, reply_to? }. Walidacja U ŹRÓDŁA, autorytatywna w bazie.
 *
 * reply_to sprawdzamy DŁUGOŚCIĄ (3..320), nie formatem — dokładnie jak CHECK
 * 0014 i parser emailSenderFromSettings; format skrzynki weryfikuje dostawca.
 */
import { z } from "zod";

export const emailSenderSchema = z
  .object({
    name: z.string().trim().min(1, "Podaj nazwę nadawcy.").max(120, "Nazwa nadawcy jest za długa."),
    replyTo: z
      .string()
      .trim()
      .max(320, "Adres odpowiedzi jest za długi.")
      .optional()
      .transform((v) => (v ? v : undefined))
      .refine((v) => v === undefined || v.length >= 3, "Adres odpowiedzi jest za krótki."),
  })
  .transform((s) => ({
    name: s.name,
    ...(s.replyTo !== undefined ? { reply_to: s.replyTo } : {}),
  }));
```

- [ ] **Step 4: Zielone.** `pnpm --filter @avably/panel test email-settings-validation` → PASS.

- [ ] **Step 5: Dowody mutacyjne.**
  1. `.min(1)` na `name` → `.min(0)`: pali „pusta nazwa odrzucona". Maskowanie: `.trim()` sam nie odrzuca pustego — bramką jest `min(1)`; DB (Task 6) łapie to niezależnie.
  2. `.max(120)` → `.max(200)`: pali „nazwa > 120 odrzucona". Maskowanie: to lustro długości CHECK-a; rozjazd z bazą = błąd 23514 dopiero przy zapisie.
  3. `refine(... >= 3)` usuń: pali „reply_to < 3 odrzucone".
  4. W `transform` zamień `reply_to` na `replyTo` (camelCase): pali test „snake_case" — kształt jsonb rozjechany z bazą.

- [ ] **Step 6: Commit.** `git commit -am "feat(panel): walidacja nadawcy e-maili (lustro CHECK 0014)"`

---

### Task 4: Akcja zapisu nadawcy (upsert) + dowód sklejki FormData

**Files:**
- Create: `apps/panel/app/[locale]/ustawienia-emaili/email-settings-actions.ts`
- Test: rozszerzyć `apps/panel/test/email-settings-validation.test.ts` o pomocnik odczytu FormData (albo osobny `email-settings-formdata.test.ts`).

**Interfaces:**
- Consumes: `emailSenderSchema` (Task 3); `EMAIL_SENDER_KEY` z `@avably/core`; `requireMember`, `zodErrorToState`, `FormState`, `AuthError`.
- Produces: `saveEmailSenderAction(prev: FormState, formData: FormData): Promise<FormState>`; funkcja czysta `emailSenderInputFromFormData(fd): {name,replyTo}` (żeby dowód sklejki był jednostkowy, lekcja 8b).

- [ ] **Step 1: Test sklejki (failing).** Dopisać:

```ts
import { emailSenderInputFromFormData } from "@/app/[locale]/ustawienia-emaili/email-settings-actions";

it("odczyt FormData czyta OBA pola (lekcja 8b: pole w schemacie ≠ pole odczytane)", () => {
  const fd = new FormData();
  fd.set("name", "Demo");
  fd.set("replyTo", "biuro@demo.pl");
  expect(emailSenderInputFromFormData(fd)).toEqual({ name: "Demo", replyTo: "biuro@demo.pl" });
});
```

- [ ] **Step 2: Czerwone.** `pnpm --filter @avably/panel test email-settings` → FAIL (brak eksportu).

- [ ] **Step 3: Implementacja** (wzorem `delivery-settings-actions.ts`):

```ts
"use server";

/**
 * Zapis nadawcy e-maili: upsert klucza email_sender w tenant_settings
 * (PK tenant_id+key), wzorem delivery-settings-actions. Zod u źródła (kształt
 * jsonb bazy), autorytatywnie odmawia CHECK 0014 kodem 23514.
 *
 * Sklejka FormData wyekstrahowana do funkcji czystej i pokryta testem —
 * lekcja 8b: pole w schemacie, którego akcja NIE czyta z FormData, cicho
 * ginie (parsed jest zawsze pusty, walidacja przechodzi, nic nie leci).
 */
import { revalidatePath } from "next/cache";

import { EMAIL_SENDER_KEY } from "@avably/core";

import { AuthError } from "@/lib/auth";
import { zodErrorToState, type FormState } from "@/lib/form-state";
import { requireMember } from "@/lib/supabase-server";

import { emailSenderSchema } from "./email-settings-validation";

const PG_CHECK_VIOLATION = "23514";
const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v : "");

export function emailSenderInputFromFormData(formData: FormData): { name: string; replyTo: string } {
  return { name: str(formData.get("name")), replyTo: str(formData.get("replyTo")) };
}

export async function saveEmailSenderAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = emailSenderSchema.safeParse(emailSenderInputFromFormData(formData));
  if (!parsed.success) return zodErrorToState(parsed.error);

  let ctx;
  try {
    ctx = await requireMember();
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }

  const { data, error } = await ctx.supabase
    .from("tenant_settings")
    .upsert(
      { tenant_id: ctx.tenantId, key: EMAIL_SENDER_KEY, value: parsed.data, updated_at: new Date().toISOString() },
      { onConflict: "tenant_id,key" },
    )
    .select("key");
  if (error) {
    if (error.code === PG_CHECK_VIOLATION) {
      return { formError: "Wartości odrzucone przez walidację bazy — sprawdź nazwę nadawcy i adres odpowiedzi." };
    }
    return { formError: error.message };
  }
  if (!data || data.length === 0) return { formError: "Nie udało się zapisać nadawcy." };

  revalidatePath("/", "layout");
  return { success: EMAIL_SENDER_KEY };
}
```

- [ ] **Step 4: Zielone.** `pnpm --filter @avably/panel test email-settings` → PASS.

- [ ] **Step 5: Dowód mutacyjny sklejki.** W `emailSenderInputFromFormData` usuń odczyt `replyTo` (`replyTo: ""`): pali test „czyta OBA pola". Kontrola maskowania: test schematu (Task 3) zostaje ZIELONY — dokładnie miara, jak cicha byłaby luka (pole `reply_to` nigdy by nie doszło do bazy, a walidacja by przechodziła). To odtworzenie błędu `sendEmail` z 8b.

- [ ] **Step 6: Commit.** `git commit -am "feat(panel): akcja zapisu nadawcy e-maili + dowód sklejki FormData"`

---

### Task 5: Strona i formularz ustawień nadawcy + stan dostępności

**Files:**
- Create: `apps/panel/app/[locale]/ustawienia-emaili/email-settings-form.tsx` (client)
- Create: `apps/panel/app/[locale]/ustawienia-emaili/page.tsx` (server)

**Interfaces:**
- Consumes: `saveEmailSenderAction` (Task 4); `emailAvailability`, `EMAIL_SENDER_KEY` z `@avably/core`; `requireMemberPage`, `FormState`, `getTranslations`, `@avably/ui` (`Button/Input/Label/Badge`).
- Produces: strona pod `/ustawienia-emaili`; komponent `EmailSenderForm({ action, defaults, availabilityReason, senderConfigured })`.

- [ ] **Step 1: Formularz (client)** — `email-settings-form.tsx`, wzorem `SenderForm` z dostaw (pola `name` wymagane + `replyTo` opcjonalne, `FormMessages`, `useActionState`). Nagłówek sekcji + pola z i18n `emailSettings.*` (Task 6). Bez logiki walidacji w kliencie (server action jest źródłem prawdy).

- [ ] **Step 2: Strona (server)** — `page.tsx`:
  - `const ctx = await requireMemberPage("/ustawienia-emaili");`
  - odczyt `tenant_settings` klucz `email_sender` → `defaults { name, replyTo }` albo `null`; `senderConfigured = defaults !== null`.
  - `const availabilityReason = emailAvailability().reason;` (transport dostępny? — jedyne miejsce, gdzie operator widzi KOMPLETNOŚĆ konfiguracji poczty: dostępność transportu + czy nadawca ustawiony).
  - Blok statusu (i18n): „Transport: dostępny/niedostępny (powód)", „Nadawca: ustawiony/nieustawiony".
  - `<EmailSenderForm action={saveEmailSenderAction} defaults={defaults} />`.
  - Nagłówek z linkiem powrotu na `/` (wzorzec strony dostaw).

- [ ] **Step 3: Typecheck + build.** `pnpm --filter @avably/panel typecheck` → zielone.

- [ ] **Step 4: Commit.** `git commit -am "feat(panel): strona ustawień nadawcy e-maili ze stanem dostępności"`

---

### Task 6: Link w nawigacji + klucze i18n (oba locale)

**Files:**
- Modify: `apps/panel/app/[locale]/page.tsx` (nawigacja)
- Modify: `apps/panel/messages/en.json`, `apps/panel/messages/pl.json`

- [ ] **Step 1:** Dołożyć do nawigacji strony głównej (po linku „zaproszenia"):

```tsx
<Link className="underline" href="/ustawienia-emaili">
  {t("emailSettingsLink")}
</Link>
```

- [ ] **Step 2:** W OBU `messages/*.json`: klucz `home.emailSettingsLink` (PL „Ustawienia e-maili" / EN „Email settings") oraz namespace `emailSettings` z kluczami: `title, intro, statusHeading, transportAvailable, transportUnavailable, senderConfigured, senderMissing, nameLabel, replyToLabel, replyToHint, saveCta, savedOk, backLink`. Wartości PL i EN. Zachować identyczny zbiór kluczy w obu plikach (strażnik parzystości).

- [ ] **Step 3:** Jeśli w repo jest skrypt/test parzystości i18n (`grep -rn "messages" apps/panel/*.config.* scripts/`), uruchomić go; inaczej ręcznie zdiffować klucze:
  `node -e "const a=require('./apps/panel/messages/en.json'),b=require('./apps/panel/messages/pl.json');const k=o=>Object.entries(o).flatMap(([x,v])=>typeof v==='object'&&v?k(v).map(s=>x+'.'+s):[x]);const A=new Set(k(a)),B=new Set(k(b));console.log('only en',[...A].filter(x=>!B.has(x)));console.log('only pl',[...B].filter(x=>!A.has(x)))"`
  Oczekiwane: obie listy puste.

- [ ] **Step 4: Testy panelu.** `pnpm --filter @avably/panel test` → zielone.

- [ ] **Step 5: Commit.** `git commit -am "feat(panel): link ustawień e-maili + klucze i18n EN/PL"`

---

### Task 7: Negatywna kontrola bramki bazy (23514 przy pustej nazwie)

**Files:**
- Sprawdzić: `packages/db/test/` — czy test z 8b już pokrywa `email_sender` z pustą/brakującą nazwą → 23514.
- Jeśli NIE: dodać przypadek do istniejącego pliku testu CHECK-ów 0014.

- [ ] **Step 1:** `grep -rn "email_sender\|23514" packages/db/test` — ustalić pokrycie. Karta modułu (dziennik 8b) mówi wprost o teście „email_sender bez name" → prawdopodobnie POKRYTE.
- [ ] **Step 2:** Jeśli pokryte — uruchomić i potwierdzić (env z `supabase status -o env`, bez `db reset`): `SUPABASE_LOCAL_URL=<DB_URL> ... pnpm --filter @avably/db test email-sender` → zielone. Zanotować w raporcie, że bramka bazy jest niezależną kontrolą „pusty name odrzucony" (DoD: „to samo bramką bazy przy ominięciu formularza").
- [ ] **Step 3:** Jeśli NIE pokryte — dopisać test: upsert `email_sender = { }` oraz `{ name: "   " }` przez sesję membera → oczekiwany kod `23514`. Uruchomić → zielone. Commit.

---

### Task 8: Rozstrzygnięcie i dokumentacja (Part 3 + ADR-036 + dziennik + karta + długi)

**Files:**
- Modify: `docs/dokumentacja/index.html`
- Modify: `docs/dokumentacja/hub.html`

- [ ] **Step 1: ADR-036** — nowy `<div class="log">` w sekcji Decyzje (po ADR-035, linia ~520). Treść: Kontekst (wymiana reliktu zaproszeń; formularz nadawcy; rozstrzygnięcie reset/confirmation/new-order). Decyzja 1 (semantyka niedostępności zaproszeń = lustro ADR-033, jawny link w komunikacie). Decyzja 2 (nadawca: From = tenants.name jak 8b, email_sender wnosi reply_to, fallback przy braku = tenants.name, asymetria z 8b uzasadniona). Decyzja 3 (reset/confirmation = dług deployu prod: Send Email Hook / SMTP w Supabase, nie kod repo — z powodem: brak lokalnej weryfikacji czystej). Decyzja 4 (new-order niewpięty — brak punktu wysyłki storefront). Dowody mutacyjne (lista z Task 1/3/4 + pytania o maskowanie).
- [ ] **Step 2: Dziennik** — nowy `<div class="log">` na górze sekcji dziennika (linia ~548, nad PR #53), data 2026-07-17, nagłówek „E-maile kont: zaproszenia na wspólnym transporcie + formularz nadawcy · PR #<n>". Streszczenie zmiany, dowody mutacyjne, świadome granice (Part 3).
- [ ] **Step 3: Karta modułu** — zaktualizować kartę „@avably/emails" (linia 181) i „Wysyłka e-maili cyklu najmu" (linie 200–223): zaproszenie PODPIĘTE do wspólnego transportu (już nie relikt); formularz nadawcy ISTNIEJE (`/ustawienia-emaili`) — usunąć z długów zdanie „dziś klucz wpisuje się ręcznie". Zaktualizować listę niewpiętych szablonów: zostają `email-confirmation` + `password-reset` (dług deployu prod — instrukcja niżej) i `new-order-notification` (brak punktu wysyłki storefront). Dołożyć w kluczowych plikach ścieżki nowych plików.
- [ ] **Step 4: Sekcja operacyjna reset/confirmation** — w karcie modułu (albo osobny akapit „Instrukcja deployu prod"): dokładne kroki podmiany szablonów GoTrue na 8a — opcja A (Auth Send Email Hook: włączyć hook w Supabase, endpoint renderujący `renderPasswordReset`/`renderEmailConfirmation`), opcja B (custom SMTP + szablony w dashboardzie). Co kliknąć/wdrożyć przy deployu prod. Zaznaczyć, że lokalny stack (Mailpit/GoTrue) używa wbudowanych szablonów i tej ścieżki nie da się zweryfikować czysto w kodzie.
- [ ] **Step 5: Tabela długów fazy 2** — linia 535 „Formularz ustawień nadawcy" → ZROBIONE (usunąć albo oznaczyć). Linia 532 „Wiring 4 szablonów kont" → zawęzić: zaproszenie wpięte, zostają confirmation/reset (dług deployu, ADR-036) + new-order (storefront).
- [ ] **Step 6: hub.html** — zaktualizować notę „Ostatnia zmiana" (linia 61) o ten PR (jeśli konwencja hubu to śledzi).
- [ ] **Step 7: Commit.** `git commit -am "docs: ADR-036, dziennik, karta modułu e-maili + instrukcja deployu resetu/potwierdzenia"`

---

### Task 9: Weryfikacja w przeglądarce (oba locale) + PR

- [ ] **Step 1: launch.json** — dodać wpis podglądu panelu na porcie 3022 ze ścieżką worktree (nie ruszać 3000/3021). `preview_start` po nazwie.
- [ ] **Step 2: Bramki lokalne.** `pnpm --filter @avably/panel typecheck && pnpm --filter @avably/panel lint && pnpm --filter @avably/panel test` oraz `pnpm --filter @avably/core test` → wszystko zielone. Build panelu.
- [ ] **Step 3: Formularz nadawcy (oba locale).** `/pl/ustawienia-emaili` i `/en/ustawienia-emaili`: zapis poprawnych danych → sukces; pusty `name` → czytelny komunikat (kontrola negatywna); po zapisie stan „Nadawca: ustawiony". Screenshot.
- [ ] **Step 4: Zaproszenie bez klucza.** Bez `RESEND_API_KEY` w env podglądu: formularz zaproszeń pokazuje baner niedostępności; wysłanie → komunikat „Zaproszenie utworzone… przekaż link ręcznie: <url>" (zero cichego sukcesu). Screenshot.
- [ ] **Step 5: Zaproszenie z atrapą klucza.** `RESEND_API_KEY=re_test_atrapa` → wysłanie kończy się uczciwym błędem dostawcy w komunikacie (nie cichym sukcesem, nie wyjątkiem 500).
- [ ] **Step 6: Kontrola bramki bazy** (jeśli nie w Tasku 7): upsert `email_sender` z pustą nazwą przez SQL/sesję → 23514.
- [ ] **Step 7: Rebase + PR.** `git fetch origin && git rebase origin/main` (konflikt dziennika w `index.html` rozwiązać po swojej stronie — swój wpis na górze). Push gałęzi, `gh pr create` do `main`, opis wg kontraktu raportu (STATUS, PR+commity, dowody mutacyjne + pytania o maskowanie, decyzje ADR-036 + świadomie odłożone, env/setup).

---

## Self-Review

- **Pokrycie briefu:** (1) zaproszenia na wspólny transport → Task 1–2 ✓; ADR semantyki braku konfiguracji → D1/D2 + Task 8 ✓; nadawca jak 8b + fallback → D2 ✓. (2) formularz nadawcy: pola name/reply_to lustrem CHECK 0014 → Task 3; upsert → Task 4; stan dostępności → Task 5; link w nawigacji → Task 6 ✓. (3) reset/confirmation rozstrzygnięcie + instrukcja + new-order niewpięty → D3/D4 + Task 8 ✓. Zasady twarde: gałąź/autor/i18n/TDD/env → Global Constraints + Task 9 ✓. Dowody mutacyjne (cichy sukces, pusta walidacja, sklejka FormData) → Task 1/3/4 ✓. DoD (CI, oba locale, kontrola negatywna formularza i bazy, jawny stan zaproszenia) → Task 9 ✓.
- **Placeholdery:** brak „TBD"/„handle edge cases" — kod mutacyjnie krytyczny podany w całości.
- **Spójność typów:** `sendInvitationEmail`/`buildInvitationEmail`/`invitationLocale`, `emailSenderSchema`, `emailSenderInputFromFormData`, `saveEmailSenderAction` — nazwy jednolite między Task 1/2/3/4/5. `EMAIL_SENDER_KEY` z `@avably/core` (nie literał). Kształt jsonb `{name, reply_to?}` spójny (Task 3 produkuje, CHECK 0014 waliduje, Task 1 czyta reply_to).
- **Ryzyko kontraktu 8a:** potwierdzone przed planem — `renderOrganizationInvitation` i `emailMessages(...).organizationInvitation.heading` eksportowane. Gdyby przy implementacji zabrakło (np. props `role` niekompatybilny) → STOP + zgłoszenie PM (Global Constraints).
