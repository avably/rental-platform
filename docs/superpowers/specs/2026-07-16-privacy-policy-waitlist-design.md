# Privacy Policy and Waitlist Legal Gate Design

## Goal

Publish complete Polish and English privacy-policy pages for the Avably waitlist, connect every existing policy link to the locale-preserving route, and make the disabled waitlist copy truthful after the policy exists. Keep `WAITLIST_ENABLED` disabled in code and environments; the owner will enable production sign-ups together with the final publication date in a separate change.

## Scope and constraints

- Add `/pl/privacy` and `/en/privacy` in `apps/storefront` as a React Server Component without `"use client"`.
- Store all user-facing policy and waitlist copy in `apps/storefront/messages/pl.json` and `apps/storefront/messages/en.json`.
- Preserve the legal entity data exactly as provided. The English policy keeps `Zakład Graficzny Maciej Godek` untranslated.
- Preserve `[[EFFECTIVE_DATE]]` literally in both locales. The publication PR will replace it and invert the date guard test.
- Do not change `WAITLIST_ENABLED`, database migrations, the waitlist schema, analytics dependencies, or PostHog behavior.
- Do not introduce competitor references, new fonts, or hard-coded localized strings in components.
- Add ADR-023 and the newest build-log entry to `docs/dokumentacja/index.html`.
- Use TDD: each behavior test is run and observed failing for the intended reason before production code is added.

## Chosen approach

Use a dedicated route at `app/[locale]/privacy/page.tsx` and the existing `next-intl` message catalogs. The page reads the `privacy` namespace, including `t.raw("sections")`, and renders a small legal-document layout using the existing storefront typography and visual tokens. This keeps legal copy reviewable next to the other localized copy and avoids a new Markdown/MDX pipeline.

The alternatives are intentionally rejected:

- Extracting a shared marketing shell from `landing-page.tsx` would refactor a large existing component without being necessary to publish the policy.
- Introducing Markdown or MDX would conflict with the required JSON structure and add a second content mechanism for a single page.

## Page architecture

`apps/storefront/app/[locale]/privacy/page.tsx` validates the locale against the existing routing configuration, calls `setRequestLocale(locale)`, and obtains `getTranslations({locale, namespace: "privacy"})`. It renders:

- a locale-aware link back to the landing page,
- the localized `title`,
- the localized update label and the literal effective-date value,
- all ten sections in order, each with one heading and its body paragraphs.

The provided body strings include line breaks and list markers where the legal text requires them. Rendering uses `whitespace-pre-line` so the supplied legal structure remains visible without embedding localized markup in the component. The route inherits `app/[locale]/layout.tsx`, so it uses the existing font variables from `app/fonts.ts` and needs no new font or client-side code.

## Navigation changes

Both policy links become `Link` components imported from `@/i18n/navigation` with `href="/privacy"`:

- the consent link in `components/waitlist-form.tsx`,
- the footer link in `components/landing-page.tsx`.

The routing configuration has `localePrefix: "always"`; the `Link` component therefore emits `/pl/privacy` or `/en/privacy` from the current provider context. The placeholder click prevention and `aria-disabled` attributes are removed because the destination is now real.

## Copy changes

Each message catalog gains a `privacy` object with `title`, `updatedLabel`,
`updatedValue`, `backToHome`, and `sections`. Every section has exactly two
keys: `heading` and `body`; `body` is an ordered string array. The
`updatedValue` in both catalogs is exactly `[[EFFECTIVE_DATE]]`.

The ten Polish sections are copied exactly from the brief. The ten English sections are faithful translations, with the legal entity name and address preserved as required and the Polish supervisory authority retained.

The disabled form copy continues to explain that sign-ups are not open, but no longer claims the missing privacy policy is the reason. The final FAQ item becomes a data-collection answer that summarizes the collected fields and points readers to the policy. Because the current FAQ renderer accepts plain strings, the policy reference is textual; the actual navigable policy links remain in the consent and footer positions required by the brief.

## Test design

`apps/storefront/test/privacy-page.test.tsx` covers:

1. successful static rendering for `pl` and `en`, including each localized title and all ten sections;
2. the exact Polish statement that IP is not saved with a submission and its English equivalent;
3. equal section counts and identical object keys between locale catalogs;
4. the presence of `[[EFFECTIVE_DATE]]` in both locales, with a comment explaining that the publication PR must invert this guard to require an ISO date;
5. the literal `Zakład Graficzny Maciej Godek` and `NIP: 7831780263` in both locales.

`apps/storefront/test/landing-page.test.tsx` renders each locale under `NextIntlClientProvider` and asserts the `href` belonging to the localized policy link. It checks `/pl/privacy` and `/en/privacy`, so restoring `#privacy-policy-pending` makes the test fail.

The TDD sequence is split into two red-green cycles: first the missing policy route/catalog contract, then locale-aware landing-page links and revised disabled copy. Documentation follows after behavior is green.

## Documentation decision

ADR-023 records:

- the server-side kill-switch remains the final operational gate because disabling only the UI would leave the server action callable;
- publishing the policy is a prerequisite for accepting consent-based waitlist data;
- IP addresses are used only transiently as expiring rate-limit keys and are not written to `waitlist_signups`;
- no cookie banner is needed for the current landing page because PostHog is inactive and the only cookie is functional locale state;
- enabling PostHog or any equivalent tracking requires revisiting ADR-023 and obtaining user consent before tracking starts.

The newest build-log entry summarizes the page, locale-safe links, copy correction, tests, and the unchanged production kill-switch. It is inserted above existing log entries; if the parallel panel branch adds another entry, both entries must be retained during merge with newest first.

## Verification and delivery

Run the focused red/green tests during implementation, then the full required gate with Node 22:

```bash
pnpm turbo lint typecheck test build --force
```

Test output must explicitly account for any integration-suite skips; the final implementation does not need a database migration or a live database to exercise its behavior. Review the final diff for exact legal data, the sole intentional `[[EFFECTIVE_DATE]]` placeholder, absence of competitor references, and no change to `WAITLIST_ENABLED`.

Commit as `Avably <admin@avably.io>` with no co-author metadata. Push `codex/privacy-waitlist` and open a draft PR describing what changed, why the legal gate is now ready for the owner's later flip, and how the work was verified.
