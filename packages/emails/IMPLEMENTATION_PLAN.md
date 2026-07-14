# `@rental/emails` — plan wdrożenia

> **Dla wykonawcy:** wymagany workflow wykonawczy: `executing-plans`. Kroki są
> śledzone checkboxami i realizowane kolejno, z testem czerwonym przed kodem.

**Cel:** zbudować samodzielny pakiet czterech polskich e-maili transakcyjnych,
renderowanych do HTML i plain text oraz oglądanych przez React Email Preview.

**Architektura:** każdy e-mail jest typowanym komponentem React opartym na
wspólnym `EmailLayout`. Funkcje w `render.ts` są publiczną granicą renderowania
i zwracają `{ html, text }`; preview korzysta z tych samych komponentów przez
cienkie wrappery z przykładowymi propsami.

**Stack:** TypeScript strict, React 19, najnowszy stabilny React Email 6,
React Email Preview, Vitest 4, pnpm 8, Turborepo.

## Ograniczenia globalne

- Edytowane źródła: wyłącznie `packages/emails`, własna sekcja modułu i wpis
  dziennika w `docs/dokumentacja/index.html`, generowany `pnpm-lock.yaml` oraz
  ignorowany `.superpowers/gpt/progress.md`.
- Zależności trafiają wyłącznie do `packages/emails/package.json`.
- `pnpm-lock.yaml` jest generowany przez `pnpm install`; nie wolno edytować go
  ręcznie, również podczas rebase.
- Brak importów z `@rental/ui`, brak CSS `oklch`, Tailwinda i zewnętrznych fontów.
- Jasny motyw, style inline, nazwa produktu `<NAZWA>`, język polski.
- Kwoty i daty są gotowymi stringami; propsy zamówienia są placeholderem fazy 1.
- Brak wysyłki, bazy, integracji z aplikacjami i zmian workflow CI.
- Autor commitów: Maciej Godek; bez stopek i wzmianek o AI.

---

### Zadanie 1: Scaffold pakietu i kontrakt pierwszego e-maila

**Pliki:**

- Utwórz: `packages/emails/package.json`
- Utwórz: `packages/emails/tsconfig.json`
- Utwórz: `packages/emails/vitest.config.ts`
- Utwórz: `packages/emails/src/styles.ts`
- Utwórz: `packages/emails/src/components/email-layout.tsx`
- Utwórz: `packages/emails/src/templates/email-confirmation.tsx`
- Utwórz: `packages/emails/src/render.ts`
- Utwórz: `packages/emails/src/index.ts`
- Utwórz: `packages/emails/test/emails.test.tsx`
- Wygeneruj: `pnpm-lock.yaml`

**Interfejsy:**

- Produkuje: `EmailConfirmationProps = { confirmationUrl: string;
  recipientName?: string }`.
- Produkuje: `RenderedEmail = { html: string; text: string }`.
- Produkuje: `renderEmailConfirmation(props): Promise<RenderedEmail>`.
- Produkuje: `EmailLayout({ previewText, heading, cta, children })`.

- [ ] **Krok 1: utwórz konfigurację pakietu i zainstaluj zależności**

`package.json` ma zawierać publiczny entrypoint `./src/index.ts`, skrypty
`typecheck`, `lint`, `test` i `preview`, peer dependencies React 19 oraz
zależność runtime `react-email@latest`. Preview UI, React, typy, TypeScript i
Vitest mają być dev dependencies. `tsconfig.json` dziedziczy z
`../../tsconfig.base.json`, włącza `jsx: react-jsx` i obejmuje `src`, `test`
oraz `preview`.

Uruchom:

```bash
pnpm install
```

Oczekiwane: instalacja kończy się kodem 0 i aktualizuje `pnpm-lock.yaml`.

- [ ] **Krok 2: napisz pierwszy czerwony test renderowania**

W `test/emails.test.tsx` dodaj:

```tsx
import { describe, expect, it } from "vitest";
import { renderEmailConfirmation } from "../src/index";

describe("EmailConfirmation", () => {
  it("renderuje CTA, link, branding i plain text bez oklch", async () => {
    const confirmationUrl = "https://app.example.test/auth/confirm?token=abc";
    const result = await renderEmailConfirmation({
      confirmationUrl,
      recipientName: "Anna",
    });

    expect(result.html).toContain("Potwierdź adres e-mail");
    expect(result.html).toContain(confirmationUrl.replaceAll("&", "&amp;"));
    expect(result.html).toContain("Anna");
    expect(result.html).toContain("&lt;NAZWA&gt;");
    expect(result.html).not.toContain("oklch");
    expect(result.text.trim()).not.toBe("");
    expect(result.text).toContain(confirmationUrl);
  });
});
```

- [ ] **Krok 3: uruchom test i potwierdź czerwień**

```bash
pnpm --filter @rental/emails test -- --run test/emails.test.tsx
```

Oczekiwane: FAIL, ponieważ `../src/index` lub eksportowana funkcja jeszcze nie
istnieje.

- [ ] **Krok 4: zaimplementuj minimalny layout, paletę i e-mail potwierdzający**

`src/styles.ts` ma eksportować dokładnie jawną paletę:

```ts
export const EMAIL_COLORS = {
  background: "#ffffff",
  foreground: "#0a0a0a",
  primary: "#171717",
  primaryForeground: "#fafafa",
  muted: "#f7f7f7",
  mutedForeground: "#555555",
  border: "#e8e8e8",
} as const;

export const EMAIL_FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
```

`EmailLayout` ma używać komponentów React Email `Html`, `Head`, `Preview`,
`Body`, `Container`, `Section`, `Heading`, `Text`, `Button`, `Link` i `Hr`.
Przycisk i tekstowy fallback wskazują ten sam `cta.href`. Nagłówek i stopka
zawierają `<NAZWA>`.

`render.ts` ma użyć `render(element)` oraz `render(element, { plainText: true })`:

```tsx
export interface RenderedEmail {
  html: string;
  text: string;
}

async function renderVariants(element: ReactElement): Promise<RenderedEmail> {
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);
  return { html, text };
}
```

`renderEmailConfirmation` przekazuje propsy do `<EmailConfirmation />`.

- [ ] **Krok 5: uruchom test, typecheck i lint**

```bash
pnpm --filter @rental/emails test -- --run test/emails.test.tsx
pnpm --filter @rental/emails typecheck
pnpm --filter @rental/emails lint
```

Oczekiwane: wszystkie trzy polecenia kończą się kodem 0.

- [ ] **Krok 6: commit**

```bash
git add packages/emails pnpm-lock.yaml
git commit -m "feat(emails): dodać layout i potwierdzenie adresu"
```

---

### Zadanie 2: Pozostałe szablony i publiczne funkcje renderujące

**Pliki:**

- Utwórz: `packages/emails/src/templates/password-reset.tsx`
- Utwórz: `packages/emails/src/templates/organization-invitation.tsx`
- Utwórz: `packages/emails/src/templates/new-order-notification.tsx`
- Modyfikuj: `packages/emails/src/render.ts`
- Modyfikuj: `packages/emails/src/index.ts`
- Modyfikuj: `packages/emails/test/emails.test.tsx`

**Interfejsy:**

- Produkuje: `PasswordResetProps = { resetUrl: string; recipientName?: string }`.
- Produkuje: `InvitationRole = "owner" | "staff"`.
- Produkuje: `OrganizationInvitationProps = { organizationName: string;
  role: InvitationRole; acceptanceUrl: string; recipientName?: string }`.
- Produkuje: `NewOrderNotificationProps = { orderNumber: string;
  customerName: string; totalAmount: string; rentalStartDate: string;
  rentalEndDate: string; orderUrl: string }`.
- Produkuje: trzy odpowiadające funkcje renderujące `Promise<RenderedEmail>`.

- [ ] **Krok 1: dodaj czerwony test resetu hasła**

Test używa `resetUrl = "https://app.example.test/reset?token=reset-123"` i
sprawdza w HTML tekst `Ustaw nowe hasło`, imię, URL, `<NAZWA>` i brak `oklch`,
a w plain text niepustą treść oraz dokładny URL.

- [ ] **Krok 2: uruchom pojedynczy test i potwierdź czerwień**

```bash
pnpm --filter @rental/emails test -- --run test/emails.test.tsx -t "PasswordReset"
```

Oczekiwane: FAIL z powodu brakującego eksportu.

- [ ] **Krok 3: zaimplementuj `PasswordReset` i renderer**

Treść ma mówić wprost, że link służy do ustawienia nowego hasła, oraz że
wiadomość można zignorować, jeśli odbiorca nie prosił o reset. CTA:
`Ustaw nowe hasło`.

- [ ] **Krok 4: uruchom test resetu i potwierdź zieleń**

```bash
pnpm --filter @rental/emails test -- --run test/emails.test.tsx -t "PasswordReset"
```

Oczekiwane: PASS.

- [ ] **Krok 5: dodaj czerwony test zaproszenia**

Test przekazuje organizację `Wypożyczalnia Północ`, rolę `staff`, odbiorcę
`Jan` i URL `https://app.example.test/invitations/accept?token=invite-123`.
HTML i tekst mają zawierać organizację, polską etykietę roli `pracownik`, URL
i CTA `Dołącz do organizacji`.

- [ ] **Krok 6: uruchom test zaproszenia i potwierdź czerwień**

```bash
pnpm --filter @rental/emails test -- --run test/emails.test.tsx -t "OrganizationInvitation"
```

Oczekiwane: FAIL z powodu brakującego eksportu.

- [ ] **Krok 7: zaimplementuj zaproszenie i mapę ról**

```ts
const ROLE_LABELS: Record<InvitationRole, string> = {
  owner: "właściciel",
  staff: "pracownik",
};
```

CTA: `Dołącz do organizacji`. Nie importuj typu z `@rental/db`.

- [ ] **Krok 8: uruchom test zaproszenia i potwierdź zieleń**

```bash
pnpm --filter @rental/emails test -- --run test/emails.test.tsx -t "OrganizationInvitation"
```

Oczekiwane: PASS.

- [ ] **Krok 9: dodaj czerwony test nowego zamówienia**

Test przekazuje numer `ZAM-2026-001`, klienta `Alicja Nowak`, kwotę
`1 299,00 zł`, daty `20.07.2026` i `23.07.2026` oraz URL zamówienia. HTML i
plain text mają zawierać wszystkie wartości; CTA brzmi `Zobacz zamówienie`.

- [ ] **Krok 10: uruchom test zamówienia i potwierdź czerwień**

```bash
pnpm --filter @rental/emails test -- --run test/emails.test.tsx -t "NewOrderNotification"
```

Oczekiwane: FAIL z powodu brakującego eksportu.

- [ ] **Krok 11: zaimplementuj powiadomienie o zamówieniu i renderer**

Szablon wyświetla cztery wiersze podsumowania: numer, klient, kwota i okres
wynajmu. Komentarz przy typie propsów wskazuje, że jest to kontrakt tymczasowy
fazy 1 i wartości są już sformatowane.

- [ ] **Krok 12: uruchom pełne testy pakietu, typecheck i lint**

```bash
pnpm --filter @rental/emails test
pnpm --filter @rental/emails typecheck
pnpm --filter @rental/emails lint
```

Oczekiwane: wszystkie polecenia kończą się kodem 0.

- [ ] **Krok 13: commit**

```bash
git add packages/emails
git commit -m "feat(emails): dodać szablony transakcyjne"
```

---

### Zadanie 3: Preview i dokumentacja użycia pakietu

**Pliki:**

- Utwórz: `packages/emails/preview/email-confirmation.tsx`
- Utwórz: `packages/emails/preview/password-reset.tsx`
- Utwórz: `packages/emails/preview/organization-invitation.tsx`
- Utwórz: `packages/emails/preview/new-order-notification.tsx`
- Utwórz: `packages/emails/README.md`
- Modyfikuj: `packages/emails/package.json`

**Interfejsy:**

- Konsumuje: cztery publiczne komponenty i ich propsy.
- Produkuje: `pnpm --filter @rental/emails preview` uruchamiające galerię na
  porcie 3002.

- [ ] **Krok 1: dodaj skrypt preview i cztery wrappery**

Skrypt:

```json
"preview": "email dev --dir preview --port 3002"
```

Każdy wrapper domyślnie eksportuje publiczny komponent i ustawia statyczne
`PreviewProps` z nieprodukcyjnymi adresami `example.test`.

- [ ] **Krok 2: udokumentuj instalację, publiczne API i preview**

`README.md` opisuje cel pakietu, eksporty, przykład `await
renderEmailConfirmation(props)`, polecenie preview, port 3002, testy oraz fakt,
że kwoty i daty zamówienia są już sformatowanymi placeholderami fazy 1.

- [ ] **Krok 3: uruchom preview i sprawdź galerię**

```bash
pnpm --filter @rental/emails preview
```

Oczekiwane: serwer działa na `http://localhost:3002` i pokazuje cztery pozycje.
Sprawdź wizualnie widok desktopowy i mobilny: nagłówek, CTA, link tekstowy,
podsumowanie zamówienia oraz brak przepełnienia.

- [ ] **Krok 4: ponownie uruchom kontrolę pakietu**

```bash
pnpm --filter @rental/emails typecheck
pnpm --filter @rental/emails lint
pnpm --filter @rental/emails test
```

Oczekiwane: wszystkie polecenia kończą się kodem 0.

- [ ] **Krok 5: commit**

```bash
git add packages/emails
git commit -m "feat(emails): dodać podgląd szablonów"
```

---

### Zadanie 4: Dokumentacja kanoniczna, pełne DoD i PR

**Pliki:**

- Modyfikuj: `docs/dokumentacja/index.html`
- Modyfikuj: `.superpowers/gpt/progress.md` (plik ignorowany przez git)
- W razie rebase wygeneruj ponownie: `pnpm-lock.yaml`

**Interfejsy:**

- Dokumentuje: cel, publiczne komponenty, funkcje renderujące, preview,
  zależności i kluczowe pliki `@rental/emails`.
- Produkuje: PR `feat/emails` → `main` z zielonymi jobami `ci` i `rls`.

- [ ] **Krok 1: dodaj wyłącznie własną sekcję modułu**

W sekcji `#moduly`, obok `@rental/ui`, dodaj kartę `@rental/emails` z celem,
stanem, eksportami i ich sygnaturami, paletą inline, zależnościami, preview oraz
kluczowymi plikami. Zmień tylko istniejący wiersz architektury
`@rental/emails` z „do budowy” na opis gotowego pakietu. Nie modyfikuj sekcji
auth, superadmina ani `@rental/ui`.

- [ ] **Krok 2: uruchom pełną lokalną weryfikację**

```bash
pnpm typecheck
pnpm lint
pnpm test
```

Oczekiwane: trzy polecenia kończą się kodem 0.

- [ ] **Krok 3: zrób rebase na aktualny `origin/main`**

```bash
git fetch origin main
git rebase origin/main
```

Jeśli `pnpm-lock.yaml` jest w konflikcie, wybierz dowolną stronę konfliktu i
uruchom `pnpm install`; nie scalaj lockfile ręcznie. Jeśli konflikt dotyczy
`docs/dokumentacja/index.html`, zachowaj wszystkie cudze sekcje i dodaj ponownie
wyłącznie kartę oraz log `@rental/emails`.

- [ ] **Krok 4: powtórz pełną weryfikację po rebase**

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
git diff --check
```

Oczekiwane: wszystkie polecenia kończą się kodem 0; status zawiera wyłącznie
pliki z dozwolonego zakresu oraz generowany lockfile.

- [ ] **Krok 5: commit dokumentacji kodu bez numeru PR i push gałęzi**

```bash
git add docs/dokumentacja/index.html pnpm-lock.yaml
git commit -m "docs(emails): opisać pakiet transakcyjny"
git push -u origin feat/emails
```

- [ ] **Krok 6: otwórz PR i uzupełnij numer w dzienniku budowy**

Otwórz PR do `main`, odczytaj jego numer i użyj tej dokładnej wartości w nowym
wpisie na górze dziennika: data, nazwa „System e-maili transakcyjnych”, numer
PR oraz jedno zdanie opisujące, co powstało i co to odblokowuje. Następnie:

```bash
git add docs/dokumentacja/index.html
git commit -m "docs(emails): uzupełnić dziennik budowy"
git push
```

- [ ] **Krok 7: zaktualizuj postęp i zaczekaj na oba joby CI**

W `.superpowers/gpt/progress.md` zapisz status zadania, commity, lokalną
weryfikację, numer i URL PR, wynik jobów `ci` i `rls` oraz rzeczy odłożone.
Poczekaj, aż oba joby zakończą się sukcesem. Jeśli którykolwiek zawiedzie,
zdiagnozuj przyczynę, popraw tylko własny zakres, ponów lokalne testy i push.

- [ ] **Krok 8: końcowy audyt zakresu**

```bash
git diff --name-only origin/main...HEAD
git log --oneline origin/main..HEAD
git status --short --branch
```

Oczekiwane: brak zmian w aplikacjach, `packages/ui`, `packages/db` i
`.github/workflows`; worktree czysty; lista commitów jest gotowa do raportu.
