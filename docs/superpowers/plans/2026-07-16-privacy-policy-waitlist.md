# Privacy Policy and Waitlist Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish complete EN/PL waitlist privacy pages, replace every pending policy link with locale-aware navigation, correct the disabled-state copy, and record ADR-023 without enabling production sign-ups.

**Architecture:** A static React Server Component reads the `privacy` namespace from the existing `next-intl` catalogs and renders a typed presentational component. Existing consent, FAQ, and footer links use the repository's `@/i18n/navigation` `Link`, preserving the mandatory locale prefix. Tests pin legal facts and route targets independently from the production kill-switch.

**Tech Stack:** Next.js 16 App Router, React 19 RSC, next-intl 4, TypeScript, Vitest, React server rendering, pnpm/Turborepo.

## Global Constraints

- Author every commit as `Avably <admin@avably.io>` with no AI attribution and no `Co-Authored-By` trailer.
- Keep EN and PL in parallel; no localized string may be hard-coded in a component.
- Keep `WAITLIST_ENABLED`, database migrations, the waitlist schema, PostHog, and analytics dependencies unchanged.
- Preserve `Zakład Graficzny Maciej Godek`, `NIP: 7831780263`, and the supplied address exactly; the company name remains untranslated in EN.
- Preserve `[[EFFECTIVE_DATE]]` literally in both catalogs.
- Do not add competitor references.
- Write each behavior test first, run it, and verify it fails for the intended missing behavior before changing production code.

---

### Task 1: Privacy policy catalog contract and static page

**Files:**
- Create: `apps/storefront/test/privacy-page.test.tsx`
- Create: `apps/storefront/app/[locale]/privacy/page.tsx`
- Modify: `apps/storefront/messages/pl.json`
- Modify: `apps/storefront/messages/en.json`

**Interfaces:**
- Consumes: `routing.locales`, `getTranslations({locale, namespace: "privacy"})`, `setRequestLocale(locale)`, `Link` from `@/i18n/navigation`.
- Produces: `PrivacyCopy`, `PrivacyDocument({copy})`, and localized routes `/pl/privacy` and `/en/privacy`.

- [ ] **Step 1: Add the failing privacy contract test**

Create `apps/storefront/test/privacy-page.test.tsx` with the catalog guards before either catalog has a `privacy` key:

```tsx
import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PrivacyDocument } from "@/app/[locale]/privacy/page";
import en from "@/messages/en.json";
import pl from "@/messages/pl.json";

function renderPrivacy(locale: "en" | "pl", messages: typeof en) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <PrivacyDocument copy={messages.privacy} />
    </NextIntlClientProvider>,
  );
}

describe("privacy page", () => {
  for (const [locale, messages] of [["en", en], ["pl", pl]] as const) {
    it(`renders the complete ${locale} policy`, () => {
      const html = renderPrivacy(locale, messages);
      expect(html).toContain(messages.privacy.title);
      expect(messages.privacy.sections).toHaveLength(10);
      for (const section of messages.privacy.sections) {
        expect(html).toContain(section.heading);
      }
    });
  }

  it("states accurately that IP is not saved with a submission", () => {
    expect(JSON.stringify(pl.privacy)).toContain("Twojego adresu IP nie zapisujemy w zgłoszeniu.");
    expect(JSON.stringify(en.privacy)).toContain("We do not save your IP address with your submission.");
  });

  it("keeps the same section shape in both locales", () => {
    expect(en.privacy.sections).toHaveLength(pl.privacy.sections.length);
    expect(en.privacy.sections.map((section) => Object.keys(section).sort())).toEqual(
      pl.privacy.sections.map((section) => Object.keys(section).sort()),
    );
  });

  it("keeps the effective-date placeholder until the publication PR", () => {
    // In the publication PR, invert this guard: require an ISO date and reject the placeholder,
    // together with WAITLIST_ENABLED=true.
    expect(en.privacy.updatedValue).toBe("[[EFFECTIVE_DATE]]");
    expect(pl.privacy.updatedValue).toBe("[[EFFECTIVE_DATE]]");
  });

  it("pins the legal entity name and tax identifier in both locales", () => {
    for (const messages of [en, pl]) {
      const policy = JSON.stringify(messages.privacy);
      expect(policy).toContain("Zakład Graficzny Maciej Godek");
      expect(policy).toContain("7831780263");
    }
    expect(JSON.stringify(pl.privacy)).toContain("NIP: 7831780263");
    expect(JSON.stringify(en.privacy)).toContain("VAT ID (NIP): 7831780263");
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm --filter storefront test -- privacy-page.test.tsx
```

Expected: FAIL because `@/app/[locale]/privacy/page` does not exist and both catalogs lack `privacy`.

- [ ] **Step 3: Add the exact PL catalog object**

Add the following top-level object after `app` in `apps/storefront/messages/pl.json`:

```json
"privacy": {
  "title": "Polityka prywatności",
  "updatedLabel": "Ostatnia aktualizacja:",
  "updatedValue": "[[EFFECTIVE_DATE]]",
  "backToHome": "Wróć na stronę główną",
  "sections": [
    {
      "heading": "1. Kto jest administratorem Twoich danych",
      "body": [
        "Administratorem Twoich danych osobowych w rozumieniu RODO jest:\nZakład Graficzny Maciej Godek\nul. Cumownicza 1a/2\n60-480 Poznań\nNIP: 7831780263",
        "Avably jest projektem prowadzonym przez tego administratora.",
        "Kontakt we wszystkich sprawach dotyczących danych: admin@avably.io",
        "Administrator nie powołał Inspektora Ochrony Danych."
      ]
    },
    {
      "heading": "2. Czego dotyczy ta polityka",
      "body": ["Ta polityka opisuje wyłącznie stronę avably.io i zapisy na listę oczekujących. Avably nie jest jeszcze uruchomione jako usługa — gdy to nastąpi, opublikujemy osobną politykę dla produktu."]
    },
    {
      "heading": "3. Jakie dane zbieramy",
      "body": [
        "Gdy zapisujesz się na listę oczekujących, zbieramy:\n- adres e-mail (wymagany),\n- typ wynajmowanego sprzętu, wielkość inwentarza i sposób, w jaki dziś obsługujesz rezerwacje — czyli Twoje odpowiedzi z formularza,\n- doprecyzowanie sprzętu — tylko jeśli wybierzesz „inny\",\n- informację, czy chcesz wziąć udział w pilotażu,\n- numer telefonu — wyłącznie jeśli zgłosisz się do pilotażu. Bez tego zgłoszenia formularz w ogóle nie przyjmie numeru,\n- moment wyrażenia zgody,\n- język, w którym oglądasz stronę,\n- oznaczenie kampanii (parametry utm_source i utm_campaign z adresu), jeśli trafiłeś do nas z linku kampanijnego.",
        "Twojego adresu IP nie zapisujemy w zgłoszeniu. Używamy go wyłącznie przejściowo, żeby ograniczyć liczbę zgłoszeń z jednego adresu i chronić formularz przed nadużyciami. Klucz wygasa automatycznie."
      ]
    },
    {
      "heading": "4. Po co i na jakiej podstawie",
      "body": [
        "- Zapis na listę oczekujących i wysyłanie informacji o budowie i uruchomieniu Avably — na podstawie Twojej zgody (art. 6 ust. 1 lit. a RODO).\n- Kontakt w sprawie pilotażu — na podstawie Twojej zgody, jeśli zgłosisz taką chęć.\n- Ochrona formularza przed nadużyciami — na podstawie naszego prawnie uzasadnionego interesu (art. 6 ust. 1 lit. f RODO).",
        "Odpowiedzi o typie sprzętu i inwentarzu służą nam wyłącznie do zrozumienia, dla kogo budujemy produkt. Nie podejmujemy na ich podstawie żadnych zautomatyzowanych decyzji i nie profilujemy Cię."
      ]
    },
    {
      "heading": "5. Komu powierzamy dane",
      "body": [
        "Korzystamy z dostawców, którzy przetwarzają dane w naszym imieniu:\n- Supabase — baza danych zgłoszeń — Unia Europejska (Frankfurt)\n- Vercel — hosting strony — Unia Europejska (Frankfurt)\n- Upstash — ochrona formularza przed nadużyciami — Unia Europejska (Frankfurt)\n- Cloudflare — DNS i ochrona strony — sieć globalna\n- Resend — wysyłka wiadomości do Ciebie — Unia Europejska",
        "Dane przechowujemy w Unii Europejskiej. Część z tych firm ma siedzibę w Stanach Zjednoczonych, więc przy obsłudze technicznej może dojść do przekazania danych poza Europejski Obszar Gospodarczy. Odbywa się to na podstawie standardowych klauzul umownych zatwierdzonych przez Komisję Europejską.",
        "Nie sprzedajemy Twoich danych i nie udostępniamy ich nikomu w celach marketingowych."
      ]
    },
    {
      "heading": "6. Jak długo przechowujemy",
      "body": ["Do czasu wycofania zgody, nie dłużej niż 24 miesiące od zapisu. Po wycofaniu zgody usuwamy zgłoszenie."]
    },
    {
      "heading": "7. Twoje prawa",
      "body": [
        "Masz prawo do dostępu do swoich danych, ich sprostowania, usunięcia, ograniczenia przetwarzania, przenoszenia, sprzeciwu wobec przetwarzania opartego na naszym prawnie uzasadnionym interesie oraz do wycofania zgody w każdej chwili. Wycofanie zgody nie wpływa na zgodność z prawem przetwarzania, którego dokonaliśmy przed wycofaniem.",
        "Aby skorzystać z tych praw, napisz na admin@avably.io. Odpowiadamy najpóźniej w ciągu miesiąca.",
        "Masz też prawo wnieść skargę do Prezesa Urzędu Ochrony Danych Osobowych, ul. Stawki 2, 00-193 Warszawa."
      ]
    },
    {
      "heading": "8. Ciasteczka",
      "body": [
        "Strona używa jednego ciasteczka funkcjonalnego, które zapamiętuje wybrany przez Ciebie język. Jest niezbędne do działania przełącznika języka i nie służy śledzeniu.",
        "Nie używamy ciasteczek analitycznych ani marketingowych i nie śledzimy Cię na innych stronach. Jeśli to się zmieni, zaktualizujemy tę politykę i poprosimy Cię o zgodę, zanim uruchomimy jakiekolwiek śledzenie."
      ]
    },
    {
      "heading": "9. Czy podanie danych jest obowiązkowe",
      "body": ["Nie. Zapis na listę oczekujących jest w pełni dobrowolny. Bez adresu e-mail nie możemy Cię jednak dopisać do listy."]
    },
    {
      "heading": "10. Zmiany polityki",
      "body": ["Jeśli zmienimy tę politykę, opublikujemy nową wersję na tej stronie i zmienimy datę u góry. O istotnych zmianach poinformujemy Cię e-mailem."]
    }
  ]
}
```

- [ ] **Step 4: Add the faithful EN catalog object**

Add the same shape after `app` in `apps/storefront/messages/en.json`, with these exact values:

```json
"privacy": {
  "title": "Privacy Policy",
  "updatedLabel": "Last updated:",
  "updatedValue": "[[EFFECTIVE_DATE]]",
  "backToHome": "Back to the home page",
  "sections": [
    {
      "heading": "1. Who is the controller of your data",
      "body": [
        "The controller of your personal data within the meaning of the GDPR is:\nZakład Graficzny Maciej Godek\nul. Cumownicza 1a/2\n60-480 Poznań, Poland\nVAT ID (NIP): 7831780263",
        "Avably is a project run by this controller.",
        "Contact for all data-related matters: admin@avably.io",
        "The controller has not appointed a Data Protection Officer."
      ]
    },
    {
      "heading": "2. What this policy covers",
      "body": ["This policy covers only the avably.io website and waitlist sign-ups. Avably has not yet launched as a service — when it does, we will publish a separate policy for the product."]
    },
    {
      "heading": "3. What data we collect",
      "body": [
        "When you join the waitlist, we collect:\n- your email address (required),\n- the type of equipment you rent, the size of your inventory, and how you currently manage bookings — that is, your answers in the form,\n- details about the equipment — only if you choose “other\",\n- whether you want to take part in the pilot,\n- your phone number — only if you apply for the pilot. Without that application, the form will not accept a phone number at all,\n- the time when you give consent,\n- the language in which you view the website,\n- campaign identifiers (the utm_source and utm_campaign parameters in the address), if you reached us through a campaign link.",
        "We do not save your IP address with your submission. We use it only temporarily to limit the number of submissions from one address and protect the form against abuse. The key expires automatically."
      ]
    },
    {
      "heading": "4. Why we use the data and on what legal basis",
      "body": [
        "- Adding you to the waitlist and sending information about the development and launch of Avably — based on your consent (Article 6(1)(a) GDPR).\n- Contacting you about the pilot — based on your consent, if you express such an interest.\n- Protecting the form against abuse — based on our legitimate interest (Article 6(1)(f) GDPR).",
        "We use answers about equipment type and inventory only to understand who we are building the product for. We do not make any automated decisions based on them and we do not profile you."
      ]
    },
    {
      "heading": "5. Who processes data on our behalf",
      "body": [
        "We use providers that process data on our behalf:\n- Supabase — submission database — European Union (Frankfurt)\n- Vercel — website hosting — European Union (Frankfurt)\n- Upstash — protection of the form against abuse — European Union (Frankfurt)\n- Cloudflare — DNS and website protection — global network\n- Resend — sending messages to you — European Union",
        "We store data in the European Union. Some of these companies are based in the United States, so technical support may involve transferring data outside the European Economic Area. This takes place on the basis of standard contractual clauses approved by the European Commission.",
        "We do not sell your data or share it with anyone for marketing purposes."
      ]
    },
    {
      "heading": "6. How long we keep the data",
      "body": ["Until you withdraw your consent, but no longer than 24 months after you join. After you withdraw consent, we delete your submission."]
    },
    {
      "heading": "7. Your rights",
      "body": [
        "You have the right to access your data, correct it, delete it, restrict its processing, transfer it, object to processing based on our legitimate interest, and withdraw your consent at any time. Withdrawing consent does not affect the lawfulness of processing carried out before the withdrawal.",
        "To exercise these rights, write to admin@avably.io. We will respond within one month at the latest.",
        "You also have the right to lodge a complaint with the President of the Personal Data Protection Office (Prezes Urzędu Ochrony Danych Osobowych), ul. Stawki 2, 00-193 Warsaw, Poland."
      ]
    },
    {
      "heading": "8. Cookies",
      "body": [
        "The website uses one functional cookie that remembers the language you selected. It is necessary for the language switcher to work and is not used for tracking.",
        "We do not use analytics or marketing cookies and we do not track you on other websites. If this changes, we will update this policy and ask for your consent before enabling any tracking."
      ]
    },
    {
      "heading": "9. Is providing data mandatory",
      "body": ["No. Joining the waitlist is entirely voluntary. However, without an email address we cannot add you to the list."]
    },
    {
      "heading": "10. Changes to this policy",
      "body": ["If we change this policy, we will publish a new version on this page and change the date at the top. We will notify you by email about material changes."]
    }
  ]
}
```

- [ ] **Step 5: Add the minimal RSC and presentational component**

Create `apps/storefront/app/[locale]/privacy/page.tsx`:

```tsx
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import enMessages from "@/messages/en.json";

export type PrivacyCopy = typeof enMessages.privacy;

export function PrivacyDocument({ copy }: { copy: PrivacyCopy }) {
  return (
    <div className="min-h-screen bg-landing-paper text-foreground">
      <header className="border-b border-border bg-landing-paper">
        <div className="mx-auto flex h-16 w-full max-w-4xl items-center px-5 sm:px-8">
          <Link className="text-sm font-medium underline underline-offset-4" href="/">
            {copy.backToHome}
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl px-5 py-16 sm:px-8 sm:py-24">
        <header className="border-b border-border pb-10">
          <h1 className="landing-heading text-balance">{copy.title}</h1>
          <p className="mt-4 text-sm text-muted-foreground">
            {copy.updatedLabel} {copy.updatedValue}
          </p>
        </header>
        <div className="mt-12 grid gap-12">
          {copy.sections.map((section) => (
            <section key={section.heading}>
              <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">{section.heading}</h2>
              <div className="mt-5 grid gap-4 leading-7 text-muted-foreground">
                {section.body.map((paragraph) => (
                  <p className="whitespace-pre-line" key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "privacy" });
  const copy: PrivacyCopy = {
    title: t("title"),
    updatedLabel: t("updatedLabel"),
    updatedValue: t("updatedValue"),
    backToHome: t("backToHome"),
    sections: t.raw("sections") as PrivacyCopy["sections"],
  };
  return <PrivacyDocument copy={copy} />;
}
```

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the same focused command. Expected: `privacy-page.test.tsx` passes with 6 tests, both locale renders contain ten headings, and the exact legal guards pass.

- [ ] **Step 7: Commit Task 1**

```bash
git add apps/storefront/app/'[locale]'/privacy/page.tsx apps/storefront/test/privacy-page.test.tsx apps/storefront/messages/en.json apps/storefront/messages/pl.json
git -c user.name=Avably -c user.email=admin@avably.io commit -m "feat(storefront): add localized privacy policy"
```

### Task 2: Locale-aware consent, FAQ, and footer links

**Files:**
- Modify: `apps/storefront/test/landing-page.test.tsx`
- Modify: `apps/storefront/test/faq-accordion.test.tsx`
- Modify: `apps/storefront/components/waitlist-form.tsx`
- Modify: `apps/storefront/components/landing-page.tsx`
- Modify: `apps/storefront/components/faq-accordion.tsx`
- Modify: `apps/storefront/messages/pl.json`
- Modify: `apps/storefront/messages/en.json`

**Interfaces:**
- Consumes: localized provider context and `Link href="/privacy"`.
- Produces: three locale-aware policy links per landing page and an optional `FaqItem.linkLabel` rendering contract.

- [ ] **Step 1: Add failing link-target tests**

Inside each locale case in `landing-page.test.tsx`, after rendering, add:

```tsx
const privacyHref = `/${locale}/privacy`;
expect(html.match(new RegExp(`href="${privacyHref}"`, "g"))).toHaveLength(3);
expect(html).not.toContain("#privacy-policy-pending");
```

In `faq-accordion.test.tsx`, wrap this new case in `NextIntlClientProvider`:

```tsx
it("renders an optional locale-aware policy link", () => {
  const html = renderToStaticMarkup(
    <NextIntlClientProvider locale="pl" messages={{}}>
      <FaqAccordion items={[{ question: "Dane", answer: "Opis", linkLabel: "Polityka" }]} />
    </NextIntlClientProvider>,
  );
  expect(html).toContain('href="/pl/privacy"');
  expect(html).toContain("Polityka");
});
```

- [ ] **Step 2: Run both tests and verify RED**

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm --filter storefront test -- landing-page.test.tsx faq-accordion.test.tsx
```

Expected: landing page finds zero `/pl/privacy` or `/en/privacy` targets, and `FaqItem` rejects `linkLabel`.

- [ ] **Step 3: Replace placeholder anchors**

Import `Link` from `@/i18n/navigation` in `waitlist-form.tsx` and `landing-page.tsx`. Replace the consent placeholder anchor with:

```tsx
<Link className="font-medium underline underline-offset-4" href="/privacy">
  {copy.privacyLabel}
</Link>
```

Replace the footer placeholder with:

```tsx
<Link className="underline underline-offset-4" href="/privacy">
  {copy.footer.privacy}
</Link>
```

Remove both `aria-disabled`, the pending hash, and the consent link's `preventDefault` handler.

- [ ] **Step 4: Add the FAQ link contract**

In `faq-accordion.tsx`, import `Link`, add `linkLabel?: string` to `FaqItem`, and render after `item.answer`:

```tsx
{item.linkLabel ? (
  <>
    {" "}
    <Link className="font-medium underline underline-offset-4" href="/privacy">
      {item.linkLabel}
    </Link>
  </>
) : null}
```

- [ ] **Step 5: Correct disabled and FAQ copy in both catalogs**

Use these exact PL values:

```json
"disabled": {
  "title": "Zapisy jeszcze nie ruszyły",
  "body": "Formularz jest gotowy, ale zapisy nie są jeszcze uruchomione. Wróć tu wkrótce."
}
```

Replace the final PL FAQ object with:

```json
{
  "question": "Jakie dane zbieracie?",
  "answer": "Przy zapisie zbieramy adres e-mail i odpowiedzi z formularza, a numer telefonu tylko od osób zgłaszających się do pilotażu. Informacje o celu, czasie przechowywania i Twoich prawach znajdziesz w",
  "linkLabel": "Polityce prywatności."
}
```

Use these exact EN values:

```json
"disabled": {
  "title": "The waitlist isn’t open yet",
  "body": "The form is ready, but sign-ups are not open yet. Please check back soon."
}
```

Replace the final EN FAQ object with:

```json
{
  "question": "What data do you collect?",
  "answer": "When you join, we collect your email address and answers from the form, and a phone number only from people who apply for the pilot. Details about the purpose, retention period, and your rights are available in the",
  "linkLabel": "Privacy Policy."
}
```

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the focused command from Step 2. Expected: both files pass; each LP render has exactly three localized privacy targets and no pending hash.

- [ ] **Step 7: Commit Task 2**

```bash
git add apps/storefront/components apps/storefront/messages apps/storefront/test
git -c user.name=Avably -c user.email=admin@avably.io commit -m "feat(storefront): link waitlist to privacy policy"
```

### Task 3: ADR-023 and newest build-log entry

**Files:**
- Modify: `docs/dokumentacja/index.html`

**Interfaces:**
- Produces: assigned decision record `ADR-023` and a top-of-log record of this change.

- [ ] **Step 1: Add ADR-023 after ADR-022**

Add a decision block that states, without changing prior ADRs:

```html
<div class="log"><p class="h"><b>ADR-023</b> · Bramka prawna waitlisty: polityka przed zapisem, IP tylko w rate-limicie</p><p><b>Kontekst:</b> waitlista przyjmuje dane osobowe na podstawie zgody. Samo wyłączenie pól w przeglądarce nie zamyka server action, dlatego stan produkcyjny kontroluje serwerowy <code>WAITLIST_ENABLED</code>.</p><p><b>Decyzja:</b> publikacja Polityki prywatności jest warunkiem przyjmowania zgłoszeń, ale nie włącza zapisów automatycznie — właściciel osobno ustawia datę obowiązywania i flagę po deployu. Adres IP nie trafia do <code>waitlist_signups</code>; jest używany wyłącznie przejściowo jako klucz rate-limitu Upstash z TTL i wygasa automatycznie.</p><p><b>Ciasteczka:</b> obecna LP używa jedynie funkcjonalnego ciasteczka locale. PostHog nie jest aktywny, więc nie ma ciasteczek analitycznych ani marketingowych i banner zgody nie jest dziś potrzebny. Włączenie PostHoga lub równoważnego śledzenia wymaga powrotu do tej decyzji, aktualizacji polityki i uzyskania zgody użytkownika przed uruchomieniem śledzenia.</p></div>
```

- [ ] **Step 2: Add the newest log entry first under `#dziennik`**

```html
<div class="log"><p class="h">2026-07-16 · Polityka prywatności EN+PL i zdjęcie bramki kodowej waitlisty</p><p>Storefront dostał pełne strony <code>/pl/privacy</code> i <code>/en/privacy</code>, treść zgodną z rzeczywistym kontraktem <code>waitlist_signups</code>, locale-aware linki w zgodzie, FAQ i stopce oraz copy stanu wyłączonego, które nie wiąże już startu z brakiem polityki. Testy przypinają oba rendery, parytet języków, dane administratora, brak zapisu IP, placeholder daty i dokładne cele linków. <code>WAITLIST_ENABLED</code> pozostaje bez zmian — właściciel włączy go osobno po deployu i ustawieniu daty obowiązywania.</p></div>
```

- [ ] **Step 3: Verify documentation structure and commit**

```bash
rg -n "ADR-023|Polityka prywatności EN\+PL" docs/dokumentacja/index.html
git diff --check
git add docs/dokumentacja/index.html
git -c user.name=Avably -c user.email=admin@avably.io commit -m "docs: record waitlist privacy gate decision"
```

Expected: exactly one ADR-023; the new dated entry is the first child of `section#dziennik`; no whitespace errors.

### Task 4: Full verification, review, and draft PR

**Files:**
- Inspect only: every file changed since `main`.

- [ ] **Step 1: Run focused storefront tests without cache**

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH ALLOW_INTEGRATION_SKIP=1 pnpm --filter storefront test
```

Expected: all non-integration storefront tests pass; integration skip is explicit.

- [ ] **Step 2: Run the required monorepo gate**

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH ALLOW_INTEGRATION_SKIP=1 pnpm turbo lint typecheck test build --force
```

Expected: lint/typecheck/test/build succeed for every in-scope package; report the exact number of skipped integration tests rather than hiding it.

- [ ] **Step 3: Audit scope and legal invariants**

```bash
git diff main...HEAD --check
git diff main...HEAD -- apps/storefront/lib/waitlist/core.ts packages/db/supabase/migrations
rg -n "#privacy-policy-pending|publikacji Polityki prywatności|Privacy Policy is published" apps/storefront
rg -n "\[\[EFFECTIVE_DATE\]\]" apps/storefront/messages
rg -n "Zakład Graficzny Maciej Godek|7831780263|Twojego adresu IP nie zapisujemy|We do not save your IP" apps/storefront/messages
```

Expected: no diff for kill-switch or migrations; no stale pending-policy copy; exactly two date placeholders; exact legal facts present in both locales.

- [ ] **Step 4: Request code review and fix every Critical or Important finding**

Provide the reviewer with `main` as the base, current `HEAD`, the approved design, and this plan. After any fix, rerun the focused tests and the full gate.

- [ ] **Step 5: Push and open a draft PR**

Push `codex/privacy-waitlist`, then create a draft PR whose body states:

- what: localized privacy pages, three locale-safe link positions, truthful disabled copy, ADR-023;
- why: prepare the code-side legal gate without enabling production sign-ups;
- verification: exact fresh lint/typecheck/test/build results and explicit integration skips;
- owner follow-up: replace `[[EFFECTIVE_DATE]]`, invert its test, and set `WAITLIST_ENABLED=true` in the publication change.
