# Z7 — umowy per tenant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zbudować trwały, tenantowy przepływ generowania, pobierania i idempotentnej wysyłki umów najmu PDF z audytem prób.

**Architecture:** Panel składa zamrożone `ContractPdfProps`, renderuje raz i zapisuje dokładne bajty w prywatnym Supabase Storage, a append-only tabela trzyma hash i metadane. Istniejący transport e-maili wysyła zapisany plik z idempotency key, a `email_logs` wiąże próbę z dokumentem. Wszystkie operacje przechodzą tenantowe RLS; route handler jest wygodą, nie jedyną bramką.

**Tech Stack:** Node 22, TypeScript 5, Next.js 16 App Router, React 19, Supabase PostgreSQL/Storage/RLS, Vitest 4, `@react-pdf/renderer`, React Email, Resend HTTP API, pnpm przez Corepack.

## Global Constraints

- Publiczna sygnatura `renderContractPdf(props)` i kształt `ContractPdfProps` pozostają bez zmian.
- Brak nowych zewnętrznych zależności; panel dodaje wyłącznie workspace dependency `@avably/pdf`.
- PDF jest zapisywany jako dokładne bajty; hash SHA-256 liczy się z bajtów i jest ponownie sprawdzany przy pobraniu oraz wysyłce.
- `contract_documents` i pliki są append-only dla zwykłej sesji; brak UPDATE/DELETE.
- `sent` oznacza przyjęcie przez Resend; webhooki i `delivered` są poza zakresem.
- Commit author: `Avably <admin@avably.io>`; zero nazw poprzedniego produktu i zero informacji o AI.
- PR zależy kolejno od #90 i #91. Bez rebase'u na P7 w locie; PM rebasuje i ponawia CI. Merge wymaga jawnej zgody właściciela.
- Migracja: 0026. ADR: 061.

---

### Task 1: Schemat 0026, prywatny Storage i dowody RLS

**Files:**
- Create: `packages/db/supabase/migrations/0026_contract_documents.sql`
- Create: `packages/db/test/contract-documents.test.ts`
- Modify: `packages/db/test/helpers/seed-tenants.ts`

**Interfaces:**
- Produces table `public.contract_documents`, bucket `rental-contracts`, `email_logs.kind='rental_contract'`, columns `contract_document_id` and `idempotency_key`.
- Produces an owner-bound Storage DELETE policy that can remove only the caller's own object when no metadata row exists (Supabase blocks direct SQL deletion and requires the Storage API).

- [x] **Step 1: Write failing integration tests**

Add tests that introspect migration 0026 and, on live Supabase, assert: valid own INSERT/SELECT and Storage upload/download; cross-tenant metadata SELECT is empty; cross-tenant INSERT is 42501/23503; cross-tenant object download fails; UPDATE/DELETE fail; foreign order FK fails; invalid settings JSON fails 23514; `rental_contract` requires same-tenant document and idempotency key; duplicate idempotency key cannot create a second log; old kinds accept null new columns. Include the PM vector: tenant A asks directly for tenant B's `document_id` through table and Storage APIs, without route-handler code, and gets no data.

- [x] **Step 2: Verify RED**

Run:

```bash
export PATH=/opt/homebrew/opt/node@22/bin:$PATH
corepack pnpm --filter @avably/db vitest run test/contract-documents.test.ts
```

Expected: FAIL because migration/table/bucket do not exist.

- [x] **Step 3: Implement migration 0026**

Create `contract_documents` with columns from the spec and checks equivalent to:

```sql
sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
locale text not null check (locale in ('en','pl')),
constraint contract_documents_order_fk foreign key (tenant_id, order_id)
  references public.orders (tenant_id, id),
unique (tenant_id, order_id, sha256)
```

Add SELECT/INSERT policies using `app.tenant_id()` and grants without UPDATE/DELETE. Add the private bucket and authenticated SELECT/INSERT policies constrained by `(storage.foldername(name))[1]::uuid = app.tenant_id()`. Extend `tenant_settings` CHECK only for key `contract_document` with exact JSON keys and limits from the spec. Extend `email_logs` and its result-shape check so `kind='rental_contract'` iff `contract_document_id` and `idempotency_key` are non-null; add same-tenant composite FK and a partial unique index on `(tenant_id, idempotency_key)`.

- [x] **Step 4: Reset DB and verify GREEN**

Run:

```bash
corepack pnpm exec supabase db reset
corepack pnpm --filter @avably/db vitest run test/contract-documents.test.ts
corepack pnpm --filter @avably/db vitest run test/email-logs.test.ts test/schema.test.ts
```

Expected: all selected tests pass.

- [x] **Step 5: Commit**

```bash
git add packages/db
git commit -m "feat(db): dodaj prywatne dokumenty umów i RLS"
```

### Task 2: Idempotency key w istniejącym transporcie

**Files:**
- Modify: `packages/core/src/email/types.ts`
- Modify: `packages/core/src/email/transport.ts`
- Modify: `packages/core/src/email/transport.test.ts`
- Modify: `packages/core/src/email/log.ts`
- Modify: `apps/panel/lib/email-log.ts`
- Create: `apps/panel/test/email-log.test.ts`

**Interfaces:**
- `OutgoingEmail.idempotencyKey?: string`.
- `EmailLogEntry.contractDocumentId?: string | null`, `idempotencyKey?: string | null`.
- Existing callers without these fields produce byte-for-byte equivalent HTTP bodies and no `Idempotency-Key` header.

- [x] **Step 1: Write failing transport and recorder tests**

Assert a message with `idempotencyKey: "rental-contract/doc/attempt"` sends header `Idempotency-Key` and the same JSON body; a message without it has no header. Add a recorder test asserting the two new log fields map to snake_case while old entries still map null.

- [x] **Step 2: Verify RED**

```bash
corepack pnpm --filter @avably/core vitest run src/email/transport.test.ts
corepack pnpm --filter panel vitest run test/email-log.test.ts
```

Expected: type/runtime failures for missing fields/header.

- [x] **Step 3: Implement minimal optional fields**

In `resendTransport`, extend headers only when provided:

```ts
...(email.idempotencyKey ? { "Idempotency-Key": email.idempotencyKey } : {})
```

Pass new metadata through `sendAndLog` and `panelEmailLogRecorder`. For a keyed entry, use insert with duplicate-ignore semantics on `(tenant_id,idempotency_key)`; do not update an existing append-only row.

- [x] **Step 4: Verify GREEN and old-call regression**

Run both focused suites and all core tests. Confirm the existing “bez załączników” and body snapshot tests remain green.

- [x] **Step 5: Commit**

```bash
git add packages/core apps/panel/lib/email-log.ts apps/panel/test/email-log.test.ts
git commit -m "feat(email): dodaj idempotencję wysyłki"
```

### Task 3: Szablon wiadomości z umową

**Files:**
- Create: `packages/emails/src/templates/rental-contract.tsx`
- Create: `packages/emails/test/rental-contract.test.tsx`
- Modify: `packages/emails/src/messages.ts`
- Modify: `packages/emails/src/index.ts`

**Interfaces:**
- `renderRentalContractEmail(props: { locale; tenantName; customerName; orderNumber }): Promise<RenderedEmail>`.
- `emailMessages(locale).rentalContract.heading` is the subject source.

- [x] **Step 1: Write failing EN/PL render tests**

Assert tenant name, customer name, order number, attachment wording, no platform branding inside rental layout, plain text, and snapshots for both locales.

- [x] **Step 2: Verify RED**

```bash
corepack pnpm --filter @avably/emails vitest run test/rental-contract.test.tsx
```

Expected: missing export/template.

- [x] **Step 3: Implement minimal 8a template**

Use `RentalEmailLayout`; accept already formatted strings; do not attach bytes in the template.

- [x] **Step 4: Verify GREEN and snapshots deliberately**

Run focused and full e-mail suites; inspect both snapshots.

- [x] **Step 5: Commit**

```bash
git add packages/emails
git commit -m "feat(emails): dodaj wiadomość z umową najmu"
```

### Task 4: Parser i ekran ustawień umów

**Files:**
- Create: `apps/panel/lib/contract-settings.ts`
- Create: `apps/panel/test/contract-settings.test.ts`
- Create: `apps/panel/app/[locale]/(panel)/ustawienia-umow/page.tsx`
- Create: `apps/panel/app/[locale]/(panel)/ustawienia-umow/actions.ts`
- Create: `apps/panel/app/[locale]/(panel)/ustawienia-umow/contract-settings-form.tsx`
- Modify: `apps/panel/messages/en.json`
- Modify: `apps/panel/messages/pl.json`
- Modify: `apps/panel/lib/shell/nav.ts`
- Modify: `apps/panel/components/shell/nav-icons.tsx`
- Modify: `apps/panel/test/panel-nav-contract.test.ts`
- Modify: `apps/panel/test/sidebar-nav.test.tsx`
- Modify: `apps/panel/test/protected-routes.test.ts`
- Modify: `apps/panel/test/messages-parity.test.ts`

**Interfaces:**
- `CONTRACT_DOCUMENT_SETTINGS_KEY = "contract_document"`.
- `contractDocumentSettingsSchema` and `contractDocumentSettingsFromRows(rows)` return the exact spec type or throw `ContractSettingsError`.
- `saveContractSettingsAction(prev, formData)` upserts through the user session; RLS is the owner-only write gate.

- [x] **Step 1: Write failing parser/validation tests**

Cover valid nullable NIP, trimming, every length boundary, bad JSON shapes, extra keys, invalid email, and FormData mapping.

- [x] **Step 2: Verify RED**

```bash
corepack pnpm --filter panel vitest run test/contract-settings.test.ts
```

- [x] **Step 3: Implement parser and actions**

Use strict Zod object; map DB errors to localized form state. Staff sees read-only values; owner gets the form. Do not duplicate authorization in a client flag: database policy decides the write.

- [x] **Step 4: Add route, navigation, messages and route contracts**

Add `/ustawienia-umow` to protected-route enumeration and message parity. Keep nav structure compatible with P7 by adding a single settings item and icon; document that PM resolves the #91 conflict.

- [x] **Step 5: Verify GREEN**

Run parser, navigation, protected routes, and message parity suites.

- [x] **Step 6: Commit**

```bash
git add apps/panel
git commit -m "feat(panel): dodaj ustawienia dokumentów umów"
```

### Task 5: Czysty składacz propsów, hash i wiadomość

**Files:**
- Create: `apps/panel/app/[locale]/(panel)/zamowienia/[id]/contract-document.ts`
- Create: `apps/panel/app/[locale]/(panel)/zamowienia/[id]/contract-document.test.ts`
- Modify: `apps/panel/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- `buildContractPdfProps(input): ContractPdfProps`.
- `sha256Hex(bytes: Uint8Array): string`.
- `verifySha256(bytes, expected): void` throws `ContractIntegrityError`.
- `buildContractEmail(input): Promise<OutgoingEmail>` attaches the exact supplied bytes and sets the supplied idempotency key.

- [x] **Step 1: Add workspace dependency and write failing tests**

Tests use deliberately different current price tiers from persisted order amounts, assert persisted amounts win, customer locale fallback, inclusive days, formatted dates EN/PL, address composition, delivery amount, settings terms, exact SHA-256 vector, mismatch exception, exact attachment byte identity and key format.

- [x] **Step 2: Verify RED**

```bash
corepack pnpm install --lockfile-only
corepack pnpm --filter panel vitest run 'app/[locale]/(panel)/zamowienia/[id]/contract-document.test.ts'
```

- [x] **Step 3: Implement pure functions**

Use `node:crypto`, `rentalDaysInclusive`, `renderRentalContractEmail`, and the frozen `ContractPdfProps`. Do not import Supabase or Next.js into this file.

- [x] **Step 4: Verify GREEN and PDF contract unchanged**

Run focused panel tests plus `corepack pnpm --filter @avably/pdf vitest run`; verify `git diff -- packages/pdf/src/types.ts packages/pdf/src/render.ts` is empty.

- [x] **Step 5: Commit**

```bash
git add apps/panel/package.json pnpm-lock.yaml apps/panel/app/[locale]/\(panel\)/zamowienia/[id]/contract-document.ts apps/panel/app/[locale]/\(panel\)/zamowienia/[id]/contract-document.test.ts
git commit -m "feat(panel): złóż dane trwałej umowy"
```

### Task 6: Generowanie, trwały zapis, pobieranie i wysyłka

**Files:**
- Create: `apps/panel/app/[locale]/(panel)/zamowienia/[id]/contract-service.ts`
- Create: `apps/panel/app/[locale]/(panel)/zamowienia/[id]/contract-actions.ts`
- Create: `apps/panel/app/[locale]/(panel)/zamowienia/[id]/contract/[documentId]/route.ts`
- Create: `apps/panel/app/[locale]/(panel)/zamowienia/[id]/contract-service.test.ts`
- Create: `apps/panel/test/contracts.test.ts`

**Interfaces:**
- `generateContract(deps, input): Promise<ContractDocumentRow>`.
- `downloadContract(deps, input): Promise<{ bytes; filename }>` verifies hash.
- `sendContract(deps, input): Promise<{ success?: string; formError?: string }>` prechecks attempt key, verifies bytes, and calls `sendAndLog` with `kind: "rental_contract"`.

- [x] **Step 1: Write failing service tests**

With injected repository/storage/transport, cover: render once; reuse same hash; upload `upsert:false`; clean own orphan on insert failure; reject missing config/customer/address/items; download identical bytes; reject mismatched bytes; reject metadata hidden by RLS; send exact stored bytes; failed transport logs failed; duplicate attempt returns prior result without second transport call; conscious retry with new attempt calls transport.

- [x] **Step 2: Verify RED**

```bash
corepack pnpm --filter panel vitest run 'app/[locale]/(panel)/zamowienia/[id]/contract-service.test.ts'
```

- [x] **Step 3: Implement dependency-injected service**

Keep Next/Supabase adapters thin in actions/route. All authoritative order queries include tenant filters and persisted financial fields. Generate UUIDs server-side before render/upload. Route downloads through the session client and verifies SHA again.

- [x] **Step 4: Write and run live integration tests**

Use two seeded tenants. Generate for A, then directly ask A's session for B's metadata and object path; both must fail by RLS. Verify route helper is not involved in this assertion. Parse generated PDF with `unpdf` and assert customer/order/terms text.

- [x] **Step 5: Verify GREEN**

Run focused service tests and live `contracts.test.ts` after DB reset.

- [x] **Step 6: Commit**

```bash
git add apps/panel/app/[locale]/\(panel\)/zamowienia/[id] apps/panel/test/contracts.test.ts
git commit -m "feat(panel): generuj i wysyłaj trwałe umowy"
```

### Task 7: Sekcja umowy, historia i odbiór EN/PL

**Files:**
- Create: `apps/panel/app/[locale]/(panel)/zamowienia/[id]/contract-section.tsx`
- Create: `apps/panel/app/[locale]/(panel)/zamowienia/[id]/contract-forms.tsx`
- Create: `apps/panel/test/contract-section.test.tsx`
- Modify: `apps/panel/app/[locale]/(panel)/zamowienia/[id]/page.tsx`
- Modify: `apps/panel/messages/en.json`
- Modify: `apps/panel/messages/pl.json`

**Interfaces:**
- `ContractSection({ orderId })` loads documents and linked `email_logs` through RLS.
- Form actions carry server-generated `attemptId`; rerender creates a new intentional retry identifier.

- [x] **Step 1: Write failing UI contract tests**

Assert missing-config state/link, generation CTA, document metadata/hash/version, download target, send/retry labels, sent/failed history, accessible form labels, and EN/PL parity.

- [x] **Step 2: Verify RED**

```bash
corepack pnpm --filter panel vitest run test/contract-section.test.tsx test/messages-parity.test.ts
```

- [x] **Step 3: Implement section and integrate one line into detail page**

Place it near the financial/delivery workflow without changing existing section order otherwise. Use existing `Button`, `Badge`, tables and semantic status tones.

- [x] **Step 4: Verify GREEN**

Run focused UI, order detail, protected route, nav and message suites.

- [x] **Step 5: Commit**

```bash
git add apps/panel
git commit -m "feat(panel): pokaż obieg umowy na zamówieniu"
```

### Task 8: ADR-061, dokumentacja, mutacje i pełne bramki

**Files:**
- Modify: `docs/DOKUMENTACJA.md`
- Modify: `docs/dokumentacja/index.html`
- Modify: plan checklist in this file

**Interfaces:**
- ADR-061 records private immutable storage, hash verification, `email_logs` reuse, and two-layer idempotency.
- Journal entry states dependency on #90/#91 and owner approval requirement.

- [x] **Step 1: Add docs and ADR-061**

Update module cards, data model, security/RLS notes, route inventory and build journal. Put the journal entry at the top. Do not claim PR number until created.

- [x] **Step 2: Execute and record six mutations with restore and non-empty diff stat**

For each mutation: apply, run the exact focused test, record failing test/message, restore, verify non-empty `git diff --stat` before restore and clean intended diff afterward:

1. weaken Storage tenant prefix;
2. bypass download SHA check;
3. remove Resend idempotency header;
4. replace persisted amount with another/current value;
5. alter attachment bytes;
6. request another tenant's document id directly through DB/Storage.

- [ ] **Step 3: Run complete fresh verification**

```bash
export PATH=/opt/homebrew/opt/node@22/bin:$PATH
corepack pnpm exec supabase db reset
corepack pnpm typecheck --force
corepack pnpm lint --force
ALLOW_INTEGRATION_SKIP=1 corepack pnpm test --force
corepack pnpm build --force
corepack pnpm audit --audit-level high
```

Then run the real DB suites without skip, equivalent to the repository's `rls` job.

- [x] **Step 4: Verify scope and contract**

```bash
git diff --check
git diff feat/pdf-paleta-avably...HEAD -- packages/pdf/src/types.ts packages/pdf/src/render.ts
git status --short
```

Expected: no PDF public-contract diff; only intended Z7 files; clean whitespace.

- [x] **Step 5: Commit docs and verification record**

```bash
git add docs apps packages pnpm-lock.yaml
git commit -m "docs(z7): opisz trwały obieg umów"
```

- [x] **Step 6: Request independent code review, fix all Critical/Important findings, rerun affected gates**

- [x] **Step 7: Push and create a draft PR**

The PR body must state: depends on #90 then #91; PM rebases and reruns CI; owner approval required before merge; migration 0026 and ADR-061; six mutation results; no `delivered` webhook.
