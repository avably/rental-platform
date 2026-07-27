# Product Image Signed Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` in a separate execution session and implement this plan task-by-task. Do not use subagents in the PM session. Stop before applying PROD migration or merging.

**Goal:** Move product-image bytes from Next.js Server Actions to a one-time, tenant-bound signed upload while preserving the current one-click operator experience and public storefront images.

**Architecture:** Migration `0038` adds a private, RLS-protected upload-intent table, three narrow RPCs, a unique/path contract on `product_images`, and hard limits on the existing public bucket. The browser uploads directly with a server-issued token; a small authenticated action claims the intent, validates Storage metadata and real image bytes, inserts metadata, and compensates failures. A quarantined service-role job removes abandoned objects.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase JS/Storage/Postgres/RLS, Zod 4, Vitest, Vercel Cron, pnpm/Turborepo.

**Approved design:** `docs/superpowers/specs/2026-07-27-product-image-signed-upload-design.md`. Read it before Task 1; this plan resolves its file and test decomposition.

## Global Constraints

- Scope is product images only. Do not change invoice PDF files, invoice copy, invoice actions, invoice tests, or ADR-076.
- Keep `experimental.serverActions.bodySizeLimit: "12mb"` unchanged in `apps/panel/next.config.ts`.
- Accepted image MIME types are exactly `image/jpeg`, `image/png`, `image/webp`, and `image/avif`.
- The maximum object size is exactly `5 * 1024 * 1024` bytes.
- The bucket remains `product-images` with `public = true`.
- Object paths are exactly `{tenant_id}/{product_id}/{upload_id}.{jpg|png|webp|avif}`.
- The application intent expires after 15 minutes. Abandoned objects become cleanup candidates 24 hours after `created_at`. Completed intent rows are retained for 7 days.
- User-path code must use the authenticated member client and RLS. `service_role` is allowed only in `apps/panel/src/jobs/**`.
- Do not trust local filename, browser MIME, Storage MIME, or extension alone. Finalization must compare Storage metadata and byte signature.
- The browser must pass only `uploadId` to finalization. Tenant, product, path, MIME, and size come from the claimed database row.
- Migration `0038` must be applied to PROD from the exact file and verified before merge. The execution session must not perform that action.
- Author every commit as `Avably <admin@avably.io>`.
- Before every mutation, verify a non-empty `git diff --stat`. Restore the mutation and rerun the green test.

---

## File Structure

**Create**

- `packages/db/supabase/migrations/0038_product_image_signed_upload.sql` — schema, RPCs, bucket settings, Storage policies.
- `packages/db/test/product-image-uploads.test.ts` — live RPC, bucket, one-time and cross-tenant contract.
- `apps/panel/lib/product-image-file.ts` — MIME constants, limits, metadata parsing, byte-signature detection.
- `apps/panel/test/product-image-file.test.ts` — pure validator and signature tests.
- `apps/panel/lib/product-image-upload.ts` — dependency-injected prepare/finalize service.
- `apps/panel/test/product-image-upload.test.ts` — service ordering, compensation, duplicate and partial-failure tests.
- `apps/panel/app/[locale]/(panel)/katalog/[id]/zdjecia/upload-actions.ts` — authenticated adapters for the service.
- `apps/panel/app/[locale]/(panel)/katalog/[id]/zdjecia/upload-flow.ts` — browser orchestration without React.
- `apps/panel/test/product-image-upload-flow.test.ts` — prepare → signed upload → finalize sequencing.
- `apps/panel/test/product-image-upload-form.test.tsx` — pending, double-submit, reset and retry UI behavior.
- `apps/panel/src/jobs/cleanup-product-image-uploads.ts` — service-role cleanup job.
- `apps/panel/app/api/jobs/product-image-uploads/route.ts` — CRON-secret HTTP boundary.
- `apps/panel/vercel.json` — hourly cron schedule.
- `apps/panel/test/product-image-upload-cleanup.test.ts` — cleanup and route authorization.
- `apps/panel/test/product-image-upload-live.test.ts` — full browser-client/Storage/RPC/metadata path on local Supabase.

**Modify**

- `packages/db/test/helpers/seed-tenants.ts` — RLS sample and mutation patch for the new table; extension-bearing product-image paths.
- `packages/db/test/product-images.test.ts` — exact bucket settings, path constraint, unique path and signed upload assertions.
- `apps/panel/lib/catalog-validation.ts` — remove file-byte ownership from the broad catalog module and re-export shared constants only if existing imports require it.
- `apps/panel/test/catalog-validation.test.ts` — remove/move image-file assertions to the focused test.
- `apps/panel/app/[locale]/(panel)/katalog/[id]/zdjecia/actions.ts` — retain update/delete only.
- `apps/panel/app/[locale]/(panel)/katalog/[id]/zdjecia/photo-forms.tsx` — client upload form, progress and localized errors.
- `apps/panel/app/[locale]/(panel)/katalog/[id]/zdjecia/page.tsx` — pass bound prepare/finalize actions.
- `apps/panel/messages/pl.json` and `apps/panel/messages/en.json` — progress and exact failure copy.
- `apps/panel/eslint.config.mjs` and `scripts/audit-service-role.sh` only if the new job path is not already accepted; do not broaden beyond `src/jobs/**`.
- `docs/dokumentacja/index.html` — model row, ADR-078, build log.
- `docs/konwencje-migracji.md` — signed-upload and cleanup-job production gate.
- `docs/superpowers/plans/2026-07-14-saas-rental-platform-roadmap.md` — mark only the image half of the global-body-limit debt complete.

---

### Task 1: Pure image contract and byte signatures

**Files:**

- Create: `apps/panel/lib/product-image-file.ts`
- Create: `apps/panel/test/product-image-file.test.ts`
- Modify: `apps/panel/lib/catalog-validation.ts`
- Modify: `apps/panel/test/catalog-validation.test.ts`

**Interfaces:**

- Produces:

```ts
export const PRODUCT_IMAGE_BUCKET = "product-images";
export const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;
export const PRODUCT_IMAGE_MIME_EXTENSIONS: Readonly<Record<ProductImageMime, ProductImageExtension>>;
export type ProductImageMime = "image/jpeg" | "image/png" | "image/webp" | "image/avif";
export type ProductImageExtension = "jpg" | "png" | "webp" | "avif";
export type ProductImageFileProblem = "missing" | "empty" | "size" | "type";
export function checkProductImageMetadata(
  file: { size: number; type: string } | null | undefined,
): ProductImageFileProblem | null;
export function detectProductImageMime(bytes: Uint8Array): ProductImageMime | null;
```

- Consumers: Tasks 3, 4, 5 and 7.

- [ ] **Step 1: Write failing pure tests**

Create fixtures with literal independent signatures, not values imported from the implementation:

```ts
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = new TextEncoder().encode("RIFF\u0004\u0000\u0000\u0000WEBPVP8 ");
const AVIF = Uint8Array.from([
  0x00, 0x00, 0x00, 0x18,
  0x66, 0x74, 0x79, 0x70,
  0x61, 0x76, 0x69, 0x66,
  0x00, 0x00, 0x00, 0x00,
  0x61, 0x76, 0x69, 0x66,
  0x6d, 0x69, 0x66, 0x31,
]);

it.each([
  [JPEG, "image/jpeg"],
  [PNG, "image/png"],
  [WEBP, "image/webp"],
  [AVIF, "image/avif"],
] as const)("recognizes real bytes", (bytes, expected) => {
  expect(detectProductImageMime(bytes)).toBe(expected);
});

it.each([
  new TextEncoder().encode("<svg><script>alert(1)</script></svg>"),
  Uint8Array.from([]),
  Uint8Array.from([0x89, 0x50]),
])("rejects spoofed or truncated bytes", (bytes) => {
  expect(detectProductImageMime(bytes)).toBeNull();
});

it("accepts exactly 5 MiB and rejects one byte more", () => {
  expect(checkProductImageMetadata({ size: MAX_PRODUCT_IMAGE_BYTES, type: "image/png" })).toBeNull();
  expect(
    checkProductImageMetadata({ size: MAX_PRODUCT_IMAGE_BYTES + 1, type: "image/png" }),
  ).toBe("size");
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Add the table-existence assertion to the new
`packages/db/test/product-image-uploads.test.ts`, then run:

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH corepack pnpm --filter panel exec vitest run test/product-image-file.test.ts
```

Expected: FAIL because `@/lib/product-image-file` does not exist.

- [ ] **Step 3: Implement the focused module**

Use byte comparisons, not filename checks:

```ts
export const PRODUCT_IMAGE_BUCKET = "product-images";
export const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;

export type ProductImageMime = "image/jpeg" | "image/png" | "image/webp" | "image/avif";
export type ProductImageExtension = "jpg" | "png" | "webp" | "avif";

export const PRODUCT_IMAGE_MIME_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
} as const satisfies Readonly<Record<ProductImageMime, ProductImageExtension>>;

export type ProductImageFileProblem = "missing" | "empty" | "size" | "type";

export function checkProductImageMetadata(
  file: { size: number; type: string } | null | undefined,
): ProductImageFileProblem | null {
  if (!file) return "missing";
  if (file.size <= 0) return "empty";
  if (file.size > MAX_PRODUCT_IMAGE_BYTES) return "size";
  if (!(file.type in PRODUCT_IMAGE_MIME_EXTENSIONS)) return "type";
  return null;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}

export function detectProductImageMime(bytes: Uint8Array): ProductImageMime | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    ascii(bytes, 1, 4) === "PNG" &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) return "image/png";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") {
    return "image/webp";
  }
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp") {
    const brands = [];
    for (let index = 8; index + 4 <= bytes.length; index += 4) {
      brands.push(ascii(bytes, index, index + 4));
    }
    if (brands.includes("avif") || brands.includes("avis")) return "image/avif";
  }
  return null;
}
```

Remove `imageFileSchema`, `IMAGE_MIME_EXTENSIONS` and `MAX_IMAGE_BYTES` from
`catalog-validation.ts`. Do not keep two sources of truth.

- [ ] **Step 4: Run focused and existing catalog tests**

Run:

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH corepack pnpm --filter panel exec vitest run test/product-image-file.test.ts test/catalog-validation.test.ts
```

Expected: both files PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/panel/lib/product-image-file.ts apps/panel/lib/catalog-validation.ts \
  apps/panel/test/product-image-file.test.ts apps/panel/test/catalog-validation.test.ts
git commit --author="Avably <admin@avably.io>" -m "Wyodrębnij kontrakt plików zdjęć"
```

---

### Task 2: Migration 0038, RLS matrix and one-time RPC contract

**Files:**

- Create: `packages/db/supabase/migrations/0038_product_image_signed_upload.sql`
- Create: `packages/db/test/product-image-uploads.test.ts`
- Modify: `packages/db/test/product-images.test.ts`
- Modify: `packages/db/test/helpers/seed-tenants.ts`

**Interfaces:**

- Produces RPCs:

```sql
app.issue_product_image_upload(
  p_product_id uuid,
  p_declared_mime text,
  p_declared_size bigint
) returns table(upload_id uuid, storage_path text)

app.claim_product_image_upload(
  p_upload_id uuid
) returns table(
  upload_id uuid,
  tenant_id uuid,
  product_id uuid,
  storage_path text,
  declared_mime text,
  declared_size bigint
)

app.finish_product_image_upload(
  p_upload_id uuid,
  p_outcome text
) returns void
```

- Consumers: Task 4 server adapters and Task 7 live test.

- [ ] **Step 1: Register the future table in the RLS harness and make it fail**

Add a sample row whose path is derived from the same generated ID:

```ts
product_image_uploads: async (ctx, tenantId) => {
  const id = randomUUID();
  const productId = await createProduct(ctx, tenantId);
  const userId = await createAuxMemberUser(ctx, tenantId);
  return {
    id,
    tenant_id: tenantId,
    product_id: productId,
    requested_by: userId,
    storage_path: `${tenantId}/${productId}/${id}.png`,
    declared_mime: "image/png",
    declared_size: 68,
    status: "pending",
    expires_at: new Date(Date.now() + 900_000).toISOString(),
  };
},
```

Add the mutation patch:

```ts
product_image_uploads: { status: "rejected" },
```

Update the existing `product_images` sample path to end in `.png`.

Run:

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH \
SUPABASE_LOCAL_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
corepack pnpm --filter @avably/db exec vitest run test/rls-isolation.test.ts
```

Expected: FAIL because `product_image_uploads` and the three RPCs do not exist.

- [ ] **Step 2: Write live RPC and bucket tests before SQL**

`product-image-uploads.test.ts` must:

- seed two tenants and one product per tenant;
- call issue as owner A for product A and assert path segments and `.png`;
- call issue as owner A for product B; assert the same `22023` denial used for
  a random product and zero new rows;
- call issue as anon and assert permission denied because anon has no EXECUTE;
- claim as owner A once and assert the authoritative row;
- claim again and as owner B; assert the same denial and no state change;
- finish only `processing → completed|rejected`;
- reject unknown outcome and expired intent;
- prove authenticated users cannot select/insert/update/delete the table
  directly;
- read `storage.buckets` with the admin client and assert exact public flag,
  file size and sorted MIME list;
- use `createSignedUploadUrl` followed by `uploadToSignedUrl` for an exact valid
  path and prove a cross-tenant path cannot receive a signed URL;
- upload exactly 5 MiB with allowed MIME and reject 5 MiB + 1 byte;
- reject `image/svg+xml`.

Run both files and expect RED before adding SQL:

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH corepack pnpm --filter @avably/db exec vitest run \
  test/product-image-uploads.test.ts test/product-images.test.ts
```

- [ ] **Step 3: Add the migration**

The migration must contain these sections in this order:

1. A `DO` preflight that raises if an existing `product_images.storage_path`
   does not match its tenant/product/UUID/extension or if duplicates exist.
2. A unique constraint/index on `product_images.storage_path`.
3. A named CHECK tying path segments to `tenant_id` and `product_id`.
4. The `product_image_uploads` table with exact status, MIME, size, path and
   timestamp CHECKs from the design.
5. RLS, REVOKE and service-role grants.
6. Three functions with one denial message, frozen search path and grants only
   to `authenticated` and `service_role`.
7. Exact bucket settings and rewritten Storage policies.

Use this path expression in both table CHECKs and functions:

```sql
tenant_id::text || '/' || product_id::text || '/' || id::text || '.' ||
case declared_mime
  when 'image/jpeg' then 'jpg'
  when 'image/png' then 'png'
  when 'image/webp' then 'webp'
  when 'image/avif' then 'avif'
end
```

Use one denial constant in issue/claim/finish:

```sql
c_denied constant text := 'Nie można wykonać tego uploadu zdjęcia.';
```

Issue derives identity; it never accepts tenant, user or path:

```sql
v_user_id := auth.uid();
v_tenant_id := app.tenant_id();
if v_user_id is null or v_tenant_id is null then
  raise exception '%', c_denied using errcode = '22023';
end if;

if not exists (
  select 1 from public.products p
  where p.tenant_id = v_tenant_id and p.id = p_product_id
) then
  raise exception '%', c_denied using errcode = '22023';
end if;
```

Claim must be one atomic statement:

```sql
return query
update public.product_image_uploads u
set status = 'processing'
where u.id = p_upload_id
  and u.tenant_id = app.tenant_id()
  and u.requested_by = auth.uid()
  and u.status = 'pending'
  and u.expires_at > clock_timestamp()
returning u.id, u.tenant_id, u.product_id, u.storage_path,
          u.declared_mime, u.declared_size;

if not found then
  raise exception '%', c_denied using errcode = '22023';
end if;
```

Finish must update only the same user's `processing` row and require
`p_outcome in ('completed','rejected')`.

Bucket update:

```sql
do $$
begin
  update storage.buckets
  set public = true,
      file_size_limit = 5242880,
      allowed_mime_types = array[
        'image/jpeg', 'image/png', 'image/webp', 'image/avif'
      ]::text[]
  where id = 'product-images';

  if not found then
    raise exception 'Brak wymaganego bucketu product-images.';
  end if;
end;
$$;
```

Storage INSERT policy must compare path strings without casting hostile input
to UUID:

```sql
with check (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = app.tenant_id()::text
  and exists (
    select 1 from public.products p
    where p.tenant_id = app.tenant_id()
      and p.id::text = (storage.foldername(name))[2]
  )
  and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|avif)$'
);
```

Keep public SELECT. Keep tenant-scoped DELETE for the existing image-management
flow. Do not grant table access to `anon` or `authenticated`.

- [ ] **Step 4: Reset local Supabase from the migration files**

Run from `packages/db`:

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH corepack pnpm dlx supabase db reset
```

Expected: migrations `0001` through `0038` apply successfully.

- [ ] **Step 5: Run DB tests**

Export all four local variables from `supabase status -o env`, then run:

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH corepack pnpm --filter @avably/db test
```

Expected: all DB tests PASS with zero silent skips.

- [ ] **Step 6: Perform migration mutations**

Mutation A: remove the product ownership predicate from
`issue_product_image_upload`; confirm the foreign-product test becomes RED.

Mutation B: remove `u.status = 'pending'` from claim; confirm the second-claim
test becomes RED.

Before each run:

```bash
git diff --stat
```

Expected: at least one changed file. Restore SQL, reset the local DB and rerun
the focused tests GREEN.

- [ ] **Step 7: Commit**

```bash
git add packages/db/supabase/migrations/0038_product_image_signed_upload.sql \
  packages/db/test/product-image-uploads.test.ts \
  packages/db/test/product-images.test.ts \
  packages/db/test/helpers/seed-tenants.ts
git commit --author="Avably <admin@avably.io>" -m "Dodaj jednorazowe bilety uploadu zdjęć"
```

---

### Task 3: Dependency-injected prepare and finalize service

**Files:**

- Create: `apps/panel/lib/product-image-upload.ts`
- Create: `apps/panel/test/product-image-upload.test.ts`

**Interfaces:**

```ts
export interface PreparedProductImageUpload {
  uploadId: string;
  path: string;
  token: string;
}

export type PrepareProductImageUploadResult =
  | { ok: true; upload: PreparedProductImageUpload }
  | { ok: false; error: string };

export type FinalizeProductImageUploadResult =
  | { ok: true }
  | { ok: false; error: string };

export interface ClaimedProductImageUpload {
  uploadId: string;
  tenantId: string;
  productId: string;
  storagePath: string;
  declaredMime: ProductImageMime;
  declaredSize: number;
}
```

The module consumes injected adapters, not Next.js globals. Task 4 creates the
real adapters.

- [ ] **Step 1: Write failing prepare/finalize tests**

Test prepare ordering:

```ts
it("issues intent before signed URL and returns no bytes", async () => {
  const calls: string[] = [];
  const result = await prepareProductImageUpload(
    { productId: PRODUCT_ID, mime: "image/png", size: PNG.length },
    {
      issue: async () => {
        calls.push("issue");
        return { uploadId: UPLOAD_ID, storagePath: PATH };
      },
      sign: async (path) => {
        calls.push(`sign:${path}`);
        return { token: "signed-token" };
      },
    },
  );
  expect(calls).toEqual(["issue", `sign:${PATH}`]);
  expect(result).toEqual({
    ok: true,
    upload: { uploadId: UPLOAD_ID, path: PATH, token: "signed-token" },
  });
});
```

Test finalize:

- claim happens before Storage reads;
- size/content type mismatch deletes path and finishes `rejected`;
- spoofed bytes delete path and finish `rejected`;
- valid bytes insert one metadata row and finish `completed`;
- INSERT failure removes only the claimed path and finishes `rejected`;
- existing `product_images.storage_path` after INSERT error is preserved and
  treated as completed;
- finish failure after successful INSERT logs the issue but returns success;
- second claim failure performs no Storage read or INSERT.

- [ ] **Step 2: Run focused test RED**

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH corepack pnpm --filter panel exec vitest run test/product-image-upload.test.ts
```

Expected: FAIL because the service module does not exist.

- [ ] **Step 3: Implement prepare**

Use the pure metadata validator before issuing:

```ts
export async function prepareProductImageUpload(
  input: { productId: string; mime: string; size: number },
  deps: {
    issue: (input: {
      productId: string;
      mime: ProductImageMime;
      size: number;
    }) => Promise<{ uploadId: string; storagePath: string }>;
    sign: (path: string) => Promise<{ token: string }>;
  },
): Promise<PrepareProductImageUploadResult> {
  const problem = checkProductImageMetadata({ size: input.size, type: input.mime });
  if (problem) return { ok: false, error: problem };
  const intent = await deps.issue({
    productId: input.productId,
    mime: input.mime as ProductImageMime,
    size: input.size,
  });
  const signed = await deps.sign(intent.storagePath);
  return {
    ok: true,
    upload: {
      uploadId: intent.uploadId,
      path: intent.storagePath,
      token: signed.token,
    },
  };
}
```

Catch adapter errors at this boundary and map them to stable internal error
codes: `denied`, `sign`, `missing`, `metadata`, `content`, `insert`.
Translations belong to Task 4, not this module.

- [ ] **Step 4: Implement finalize**

Use this exact order:

```ts
const claimed = await deps.claim(uploadId);
const info = await deps.info(claimed.storagePath);
if (
  info.size !== claimed.declaredSize ||
  info.contentType !== claimed.declaredMime ||
  info.size <= 0 ||
  info.size > MAX_PRODUCT_IMAGE_BYTES
) {
  await deps.remove(claimed.storagePath);
  await deps.finish(uploadId, "rejected");
  return { ok: false, error: "metadata" };
}

const bytes = await deps.download(claimed.storagePath);
if (detectProductImageMime(bytes) !== claimed.declaredMime) {
  await deps.remove(claimed.storagePath);
  await deps.finish(uploadId, "rejected");
  return { ok: false, error: "content" };
}
```

After validation, insert with `tenantId`, `productId`, `storagePath` and
`max(sort_order) + 1`. On insert failure, query the exact path:

- if a row already references it, do not remove the object; finish completed;
- otherwise remove the object and finish rejected.

After successful INSERT, call finish completed. If only finish fails, call
`deps.report`, keep the object and row, and return success.

- [ ] **Step 5: Run tests and mutations**

Run:

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH corepack pnpm --filter panel exec vitest run \
  test/product-image-file.test.ts test/product-image-upload.test.ts
```

Mutation: replace `detectProductImageMime(bytes)` with
`claimed.declaredMime`. Confirm the spoof test is RED, restore, rerun GREEN.

- [ ] **Step 6: Commit**

```bash
git add apps/panel/lib/product-image-upload.ts apps/panel/test/product-image-upload.test.ts
git commit --author="Avably <admin@avably.io>" -m "Dodaj finalizację uploadu zdjęcia"
```

---

### Task 4: Authenticated server adapters and localized actions

**Files:**

- Create: `apps/panel/app/[locale]/(panel)/katalog/[id]/zdjecia/upload-actions.ts`
- Modify: `apps/panel/app/[locale]/(panel)/katalog/[id]/zdjecia/actions.ts`
- Modify: `apps/panel/messages/pl.json`
- Modify: `apps/panel/messages/en.json`
- Test: `apps/panel/test/product-image-upload.test.ts`

**Interfaces:**

```ts
export async function prepareProductImageUploadAction(
  productId: string,
  input: { mime: string; size: number },
): Promise<PrepareProductImageUploadResult>;

export async function finalizeProductImageUploadAction(
  uploadId: string,
): Promise<FormState>;
```

- [ ] **Step 1: Add failing adapter tests**

Mock `requireMember`, RPC and Storage. Assert:

- issue RPC receives only `p_product_id`, `p_declared_mime`,
  `p_declared_size`;
- `createSignedUploadUrl(path, { upsert: false })` uses the member client;
- prepare never imports or constructs a service client;
- finalize RPC claim result supplies path/product/tenant;
- browser input cannot override those values;
- localized PL/EN messages map each stable service error.

- [ ] **Step 2: Run RED**

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH corepack pnpm --filter panel exec vitest run test/product-image-upload.test.ts
```

- [ ] **Step 3: Implement the real adapters**

Build `issue`, `sign`, `claim`, `info`, `download`, `insert`, `findByPath`,
`remove`, `finish`, and `report` from the authenticated `ctx.supabase`.
Convert PostgREST snake_case rows once at the adapter boundary:

```ts
const claimed = {
  uploadId: row.upload_id,
  tenantId: row.tenant_id,
  productId: row.product_id,
  storagePath: row.storage_path,
  declaredMime: row.declared_mime as ProductImageMime,
  declaredSize: Number(row.declared_size),
};
```

`download` must return:

```ts
new Uint8Array(await blob.arrayBuffer())
```

Do not accept `FormData` or `File` in either action.

Keep `updateImageAction` and image deletion in `actions.ts`; delete only the old
`uploadImageAction`.

- [ ] **Step 4: Add exact copy**

Under `catalog.images`, add matching PL/EN keys:

```json
{
  "uploading": "Wgrywanie…",
  "errors": {
    "missing": "Wybierz plik zdjęcia do wgrania.",
    "empty": "Wybrany plik jest pusty.",
    "size": "Zdjęcie może mieć najwyżej 5 MB.",
    "type": "Dozwolone formaty zdjęć: JPEG, PNG, WebP, AVIF.",
    "denied": "Nie można wgrać zdjęcia do tego produktu.",
    "upload": "Nie udało się przesłać zdjęcia.",
    "content": "Plik nie jest prawidłowym obrazem w wybranym formacie.",
    "finalize": "Nie udało się dodać zdjęcia. Spróbuj ponownie."
  }
}
```

The English catalog must be a faithful translation, not reused Polish text.
Use:

```json
{
  "uploading": "Uploading…",
  "errors": {
    "missing": "Choose an image file to upload.",
    "empty": "The selected file is empty.",
    "size": "The image can be up to 5 MB.",
    "type": "Allowed image formats: JPEG, PNG, WebP, AVIF.",
    "denied": "This photo cannot be uploaded to the selected product.",
    "upload": "The photo could not be uploaded.",
    "content": "The file is not a valid image in the selected format.",
    "finalize": "The photo could not be added. Try again."
  }
}
```

- [ ] **Step 5: Run tests, typecheck and service-role audit**

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH corepack pnpm --filter panel exec vitest run test/product-image-upload.test.ts
PATH=/opt/homebrew/opt/node@22/bin:$PATH corepack pnpm --filter panel typecheck
bash scripts/audit-service-role.sh
```

Expected: PASS and no service-role occurrence in the upload action.

- [ ] **Step 6: Commit**

```bash
git add 'apps/panel/app/[locale]/(panel)/katalog/[id]/zdjecia/upload-actions.ts' \
  'apps/panel/app/[locale]/(panel)/katalog/[id]/zdjecia/actions.ts' \
  apps/panel/messages/pl.json apps/panel/messages/en.json \
  apps/panel/test/product-image-upload.test.ts
git commit --author="Avably <admin@avably.io>" -m "Podepnij bezpieczne akcje uploadu zdjęć"
```

---

### Task 5: Browser upload flow and unchanged one-click UI

**Files:**

- Create: `apps/panel/app/[locale]/(panel)/katalog/[id]/zdjecia/upload-flow.ts`
- Create: `apps/panel/test/product-image-upload-flow.test.ts`
- Modify: `apps/panel/app/[locale]/(panel)/katalog/[id]/zdjecia/photo-forms.tsx`
- Modify: `apps/panel/app/[locale]/(panel)/katalog/[id]/zdjecia/page.tsx`

**Interfaces:**

```ts
export async function runProductImageUpload(
  file: File | null,
  deps: {
    prepare: (input: { mime: string; size: number }) => Promise<PrepareProductImageUploadResult>;
    upload: (input: {
      path: string;
      token: string;
      file: File;
      contentType: string;
    }) => Promise<{ error: string | null }>;
    finalize: (uploadId: string) => Promise<FormState>;
    message: (problem: ProductImageFileProblem | "upload") => string;
  },
): Promise<FormState>;
```

- [ ] **Step 1: Write failing flow tests**

Assert:

- local metadata rejection calls neither prepare, upload nor finalize;
- valid file calls exactly prepare → upload → finalize;
- signed upload uses path/token returned by prepare and the original `File`;
- upload error prevents finalize and returns the upload message;
- prepare denial prevents upload;
- finalize error is returned unchanged.

Local rejection returns `{ formError: deps.message(problem) }`. A Storage
upload error returns `{ formError: deps.message("upload") }`. Prepare/finalize
messages are already localized by their server actions.

- [ ] **Step 2: Run RED**

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH corepack pnpm --filter panel exec vitest run test/product-image-upload-flow.test.ts
```

- [ ] **Step 3: Implement the pure browser flow**

The upload adapter used by the component must call:

```ts
const supabase = createBrowserClient();
const { error } = await supabase.storage
  .from(PRODUCT_IMAGE_BUCKET)
  .uploadToSignedUrl(path, token, file, {
    contentType,
    upsert: false,
  });
```

Never put `signedUrl` into the DOM or logs. Keep only token/path in function
scope until the promise settles.

- [ ] **Step 4: Convert `UploadImageForm`**

Replace native `form action={serverAction}` with an `onSubmit` handler:

```tsx
async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
  event.preventDefault();
  if (pending) return;
  setPending(true);
  setState({});
  try {
    const result = await runProductImageUpload(file, {
      prepare,
      upload,
      finalize,
      message: (problem) => t(`errors.${problem}`),
    });
    setState(result);
    if (result.success) {
      setFile(null);
      event.currentTarget.reset();
    }
  } finally {
    setPending(false);
  }
}
```

The button remains one click, is disabled while pending, and displays
`t("uploading")`. Preserve `aria-invalid`, `aria-describedby`, alert/status
roles, hints and all row forms.

`page.tsx` passes:

```tsx
<UploadImageForm
  prepare={prepareProductImageUploadAction.bind(null, product.id)}
  finalize={finalizeProductImageUploadAction}
/>
```

- [ ] **Step 5: Test component behavior**

Use Testing Library to assert a double click while pending results in one
prepare call, success resets the input, and an error keeps the selected file
information available for retry.

Run:

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH corepack pnpm --filter panel exec vitest run \
  test/product-image-upload-flow.test.ts test/product-image-upload-form.test.tsx
```

- [ ] **Step 6: Commit**

```bash
git add 'apps/panel/app/[locale]/(panel)/katalog/[id]/zdjecia/upload-flow.ts' \
  'apps/panel/app/[locale]/(panel)/katalog/[id]/zdjecia/photo-forms.tsx' \
  'apps/panel/app/[locale]/(panel)/katalog/[id]/zdjecia/page.tsx' \
  apps/panel/test/product-image-upload-flow.test.ts \
  apps/panel/test/product-image-upload-form.test.tsx
git commit --author="Avably <admin@avably.io>" -m "Wysyłaj zdjęcia bezpośrednio do Storage"
```

---

### Task 6: Abandoned-upload cleanup job

**Files:**

- Create: `apps/panel/src/jobs/cleanup-product-image-uploads.ts`
- Create: `apps/panel/app/api/jobs/product-image-uploads/route.ts`
- Create: `apps/panel/vercel.json`
- Create: `apps/panel/test/product-image-upload-cleanup.test.ts`
- Modify: `apps/panel/eslint.config.mjs` only if required for route-to-job import
- Modify: `scripts/audit-service-role.sh` only if the existing `src/jobs/**` rule fails

**Interfaces:**

```ts
export interface ProductImageCleanupResult {
  scanned: number;
  removedObjects: number;
  removedIntents: number;
}

export async function cleanupProductImageUploads(input?: {
  now?: Date;
  batchSize?: number;
  db?: SupabaseClient;
}): Promise<ProductImageCleanupResult>;
```

- [ ] **Step 1: Write failing job tests**

Seed these rows/objects:

- old pending without metadata → object and intent removed;
- old processing without metadata → removed;
- old rejected without metadata → removed;
- old processing with `product_images.storage_path` → object preserved, intent removed;
- fresh pending → untouched;
- completed younger than 7 days → untouched;
- completed older than 7 days → intent removed, object preserved.

Also test route behavior:

- missing `CRON_SECRET` → 503;
- missing/wrong `Authorization: Bearer ...` → 401;
- correct secret → 200 and JSON result;
- job throw → 500.

- [ ] **Step 2: Run RED**

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH corepack pnpm --filter panel exec vitest run test/product-image-upload-cleanup.test.ts
```

- [ ] **Step 3: Implement the quarantined job**

Only this file imports:

```ts
import { createServiceClient } from "@avably/db/service";
```

Select at most `batchSize` rows ordered by `created_at`. For non-completed
candidates require `created_at <= now - 24h`. For completed require
`finished_at <= now - 7d`.

Fetch referenced paths:

```ts
const { data: refs, error: refsError } = await db
  .from("product_images")
  .select("storage_path")
  .in("storage_path", paths);
```

Remove only unreferenced paths through:

```ts
await db.storage.from(PRODUCT_IMAGE_BUCKET).remove(unreferencedPaths);
```

Never delete rows from `storage.objects` with SQL. Delete an intent only after
its object was removed successfully or after proving its path is referenced.

- [ ] **Step 4: Implement the cron boundary**

Use constant-time string comparison for the configured secret:

```ts
import { timingSafeEqual } from "node:crypto";

function authorized(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
```

`apps/panel/vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/jobs/product-image-uploads",
      "schedule": "17 * * * *"
    }
  ]
}
```

- [ ] **Step 5: Run job, audit and lint**

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH corepack pnpm --filter panel exec vitest run test/product-image-upload-cleanup.test.ts
bash scripts/audit-service-role.sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH corepack pnpm --filter panel lint
```

Expected: PASS. If the audit requires a change, narrow it to the already
documented `apps/*/src/jobs/**` path; do not allow `app/api/jobs/**` to import
`@avably/db/service` directly.

- [ ] **Step 6: Mutation**

Remove the reference check before Storage deletion. Confirm the test protecting
the referenced image becomes RED. Restore and rerun GREEN.

- [ ] **Step 7: Commit**

```bash
git add apps/panel/src/jobs/cleanup-product-image-uploads.ts \
  apps/panel/app/api/jobs/product-image-uploads/route.ts \
  apps/panel/vercel.json apps/panel/test/product-image-upload-cleanup.test.ts \
  apps/panel/eslint.config.mjs scripts/audit-service-role.sh
git commit --author="Avably <admin@avably.io>" -m "Sprzątaj przerwane uploady zdjęć"
```

Stage only the files actually changed; do not create no-op edits to lint/audit
configuration.

---

### Task 7: Full live path and regression proof

**Files:**

- Create: `apps/panel/test/product-image-upload-live.test.ts`
- Modify: focused files only when the live test exposes a real defect

**Interfaces:**

- Consumes the real browser Supabase client, real prepare/finalize actions
  through injected world adapters, local Storage, RPCs and `product_images`.
- Produces the end-to-end proof required by PM review.

- [ ] **Step 1: Write the live test**

With local Supabase and seeded tenant/product:

1. issue a real intent;
2. create a real signed upload URL;
3. upload a real PNG through `uploadToSignedUrl`;
4. finalize through the real service adapters;
5. assert exactly one `product_images` row;
6. fetch the public URL without auth and compare exact bytes;
7. assert the intent is completed;
8. call finalize again and assert denial with no second row.

Add a spoof case: upload text bytes with `contentType: image/png`, finalize,
assert rejection, zero metadata rows and missing Storage object.

- [ ] **Step 2: Run the test**

Export real local variables from `supabase status -o env`, then:

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH corepack pnpm --filter panel exec vitest run test/product-image-upload-live.test.ts
```

Expected: both valid and spoof cases PASS, no skips.

- [ ] **Step 3: Run the full relevant suites**

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH corepack pnpm --filter @avably/db test
PATH=/opt/homebrew/opt/node@22/bin:$PATH corepack pnpm --filter panel test
PATH=/opt/homebrew/opt/node@22/bin:$PATH corepack pnpm --filter panel typecheck
PATH=/opt/homebrew/opt/node@22/bin:$PATH corepack pnpm --filter panel lint
PATH=/opt/homebrew/opt/node@22/bin:$PATH corepack pnpm --filter panel build
```

Record exact test counts and durations in the PR report.

- [ ] **Step 4: Execute all six required mutations**

Use the six mutation vectors from the design/spec. For each:

1. apply only that mutation;
2. run `git diff --stat` and save the non-empty output;
3. run the single expected-red test;
4. record the failing assertion;
5. restore the mutation;
6. rerun the same test green.

Do not reuse the executor mutation as the PM review mutation.

- [ ] **Step 5: Commit**

```bash
git add apps/panel/test/product-image-upload-live.test.ts
git commit --author="Avably <admin@avably.io>" -m "Przypnij pełną drogę uploadu zdjęcia"
```

---

### Task 8: ADR, model, operations and roadmap

**Files:**

- Modify: `docs/dokumentacja/index.html`
- Modify: `docs/konwencje-migracji.md`
- Modify: `docs/superpowers/plans/2026-07-14-saas-rental-platform-roadmap.md`

- [ ] **Step 1: Add ADR-078**

Document:

- why product images are separate from invoice PDFs;
- signed upload + one-time intent + finalization;
- public read but tenant-bound write;
- 5 MiB/MIME bucket enforcement plus byte-signature verification;
- no service role in user flow;
- cleanup job and exact 24h/7d retention;
- migration-before-code compatibility;
- rejected alternatives.

- [ ] **Step 2: Update the model**

Add `product_image_uploads` to the data model, include exact fields/statuses and
state that direct table grants are absent. The build-log entry is added in Task
9 after GitHub returns the actual PR number.

- [ ] **Step 3: Update migration convention**

Add the operational rule:

- signed-upload migrations verify bucket `public`, `file_size_limit`,
  `allowed_mime_types`, policies and every SECURITY DEFINER function MD5;
- Storage objects are removed through Storage API, never SQL;
- cron secret and successful protected job invocation are pre-merge gates.

- [ ] **Step 4: Update roadmap precisely**

Change the debt from “images and invoices use 12 MB” to:

```text
Product images: direct signed upload completed.
Remaining: invoice PDF direct upload and only then lowering the global 12 MB limit.
```

Do not mark the entire debt complete.

- [ ] **Step 5: Verify docs and commit**

```bash
rg -n 'ADR-078|0038|product_image_uploads|12 MB|faktur' \
  docs/dokumentacja/index.html docs/konwencje-migracji.md \
  docs/superpowers/plans/2026-07-14-saas-rental-platform-roadmap.md
git diff --check
git add docs/dokumentacja/index.html docs/konwencje-migracji.md \
  docs/superpowers/plans/2026-07-14-saas-rental-platform-roadmap.md
git commit --author="Avably <admin@avably.io>" -m "Udokumentuj podpisany upload zdjęć"
```

---

### Task 9: Full gate, draft PR and PM handoff

**Files:**

- Modify only defects found by the full gate.

- [ ] **Step 1: Rebase before the final gate**

```bash
git fetch origin main
git rebase origin/main
```

If conflicts overlap user changes, stop and ask; do not overwrite.

- [ ] **Step 2: Fresh install and supply-chain gate**

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH corepack pnpm install --frozen-lockfile
PATH=/opt/homebrew/opt/node@22/bin:$PATH corepack pnpm audit --audit-level high
bash scripts/audit-public-env.sh
bash scripts/audit-service-role.sh
git diff --check origin/main...HEAD
```

Expected: zero vulnerabilities, both audits green, clean diff-check.

- [ ] **Step 3: Full monorepo verification**

With the local Supabase variables exported:

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH corepack pnpm test
PATH=/opt/homebrew/opt/node@22/bin:$PATH corepack pnpm typecheck
PATH=/opt/homebrew/opt/node@22/bin:$PATH corepack pnpm lint
PATH=/opt/homebrew/opt/node@22/bin:$PATH corepack pnpm build
```

Expected: all packages green and integration guards report no skipped suites.

- [ ] **Step 4: Verify commit authors and forbidden references**

```bash
git log origin/main..HEAD --format='%h %an <%ae> %s'
rg -n -i 'chatgpt|claude|openai|anthropic|gemini|copilot' \
  $(git diff --name-only origin/main...HEAD) || true
```

Every commit author must be `Avably <admin@avably.io>`. Product/docs changes
must contain no AI or competitor references.

- [ ] **Step 5: Open a draft PR**

Push the feature branch and create a draft PR. The body must include:

- product-images-only scope and explicit invoice exclusion;
- migration `0038` and migration-before-code order;
- exact test counts;
- all six mutation results with non-empty diff evidence;
- bucket configuration;
- CRON secret prerequisite;
- PROD checklist with MD5 slots filled from the local database;
- rollback: old panel remains compatible, do not reverse the migration after
  new code deploys.

- [ ] **Step 6: Add the build-log entry with the actual PR number**

Read the number from GitHub:

```bash
PR_NUMBER=$(gh pr view --json number --jq .number)
test -n "$PR_NUMBER"
```

Use `apply_patch` to add the build-log entry at the top of the build-log
section with `PR #${PR_NUMBER}` rendered as the actual integer. Include scope,
security boundaries, test counts and mutation results. Then:

```bash
git add docs/dokumentacja/index.html
git commit --author="Avably <admin@avably.io>" -m "Uzupełnij numer PR w dokumentacji"
git push
```

Verify the committed file contains no `PR bieżący`, angle-bracket marker or
empty PR label.

- [ ] **Step 7: Stop before production actions**

Return to PM with:

- PR URL and exact head SHA;
- commit list/authors;
- changed-file list;
- CI/preview state;
- exact local MD5 for each `app.*` function;
- exact PROD SQL block boundaries copied from migration `0038`;
- exact read-only verification queries for bucket settings, policies and
  `schema_migrations`;
- required Vercel secret name, without secret value;
- test/mutation evidence;
- known limitations.

Do not apply `0038` to PROD, set production secrets, mark Ready, merge, or
deploy from the execution session. Those actions require PM/owner review.

---

## PM Review Checklist

The PM review is independent of execution:

1. Read every changed file and PR discussion.
2. Confirm migration `0038` is the latest number and ADR-078 is not reused.
3. Recompute function MD5s on a local database reset from the migration file.
4. Verify exact bucket settings and policy definitions.
5. Run one mutation on a vector not used by the executor and confirm a
   non-empty `git diff --stat`.
6. Confirm `origin/main` is an ancestor of the PR head immediately before
   merge.
7. Obtain/confirm owner approval for Storage/RLS/migration and cron secret.
8. Apply the exact migration block to PROD before merge and verify
   `schema_migrations`, MD5s, bucket settings and policies.
9. Mark Ready and squash-merge only with all checks green.
10. After deploy, upload a controlled demo PNG, confirm the exact public bytes
    on storefront, delete it, and invoke/observe the cleanup route.
11. Do not run or alter invoice PDF behavior; keep 12 MB until its separate
    project is complete.
