/**
 * Publiczny odczyt dokumentów prawnych najemcy (B4, migracja 0063, ADR-129).
 *
 * Lustro `lib/site/published.ts`: jedyną drogą są funkcje `SECURITY DEFINER`
 * ze schematu `app`, bo anonimowy odwiedzający nie ma i nie może mieć grantów
 * na `legal_documents` ani `legal_document_versions`. Funkcje oddają WYŁĄCZNIE
 * wersje OPUBLIKOWANE i wyłącznie dla najemcy aktywnego — szkic nie występuje
 * w ani jednym z tych zapytań, więc nie ma go jak wyprowadzić.
 *
 * FAIL-CLOSED: błąd transportu, brak wiersza i kształt, którego nie umiemy
 * przeczytać, są dla odwiedzającego tym samym — dokumentu nie ma. Strona
 * odpowiada wtedy 404, a nie połową dokumentu.
 *
 * TRZY ODCZYTY, BO TRZY RÓŻNE KOSZTY:
 *   - `getPublishedLegalDocuments` — spis BEZ treści; woła go każdy render osi
 *     tenanckiej (kontekst), żeby checkout wiedział, czy pokazać link i jaką
 *     etykietę wersji wysłać. Ciągnięcie 50 000 znaków po etykietę byłoby
 *     podatkiem od każdego wejścia do sklepu.
 *   - `getPublishedLegalDocument` — żywa wersja z treścią (strona /regulamin).
 *   - `getLegalDocumentVersion` — konkretna wersja z treścią (permalink),
 *     czyli okazanie tekstu, na który przystał klient, także po edycji.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase-server";

/** Rodzaje dokumentów — lustro CHECK-a `kind` z migracji 0063. */
export const LEGAL_DOCUMENT_KINDS = ["terms", "privacy"] as const;
export type LegalDocumentKind = (typeof LEGAL_DOCUMENT_KINDS)[number];

const summarySchema = z.object({
  kind: z.enum(LEGAL_DOCUMENT_KINDS),
  title: z.string().min(1),
  version_label: z.string().min(1),
  version_no: z.number().int().positive(),
  published_at: z.string().min(1),
  locale: z.enum(["pl", "en"]),
});

const documentSchema = summarySchema.extend({
  body: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

const versionSchema = documentSchema.extend({
  current: z.boolean(),
});

export type PublishedLegalDocumentSummary = z.infer<typeof summarySchema>;
export type PublishedLegalDocument = z.infer<typeof documentSchema>;
export type LegalDocumentVersion = z.infer<typeof versionSchema>;

async function client(injected?: SupabaseClient): Promise<SupabaseClient> {
  return injected ?? (await createSupabaseServerClient());
}

/**
 * Spis opublikowanych dokumentów najemcy — bez treści. Pusta tablica znaczy
 * „najemca nie opublikował niczego", czyli stan każdego najemcy tuż po
 * migracji 0063 (backfill idzie do szkicu, nie do publikacji).
 */
export async function getPublishedLegalDocuments(
  tenantId: string,
  injected?: SupabaseClient,
): Promise<PublishedLegalDocumentSummary[]> {
  const supabase = await client(injected);
  const { data, error } = await supabase
    .schema("app")
    .rpc("get_published_legal_documents", { p_tenant_id: tenantId });

  if (error || data == null) return [];

  const parsed = z.array(summarySchema).safeParse(data);
  return parsed.success ? parsed.data : [];
}

/** Żywa wersja dokumentu danego rodzaju albo null (fail-closed). */
export async function getPublishedLegalDocument(
  tenantId: string,
  kind: LegalDocumentKind,
  injected?: SupabaseClient,
): Promise<PublishedLegalDocument | null> {
  const supabase = await client(injected);
  const { data, error } = await supabase
    .schema("app")
    .rpc("get_published_legal_document", { p_tenant_id: tenantId, p_kind: kind });

  if (error || data == null) return null;

  const parsed = documentSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

/**
 * Konkretna wersja dokumentu (permalink). Numer wersji, a nie uuid — adres ma
 * dać się przepisać z potwierdzenia zamówienia. Numer spoza zakresu, cudzy
 * najemca i nieaktywny sklep dają jednakowo null.
 */
export async function getLegalDocumentVersion(
  tenantId: string,
  kind: LegalDocumentKind,
  versionNo: number,
  injected?: SupabaseClient,
): Promise<LegalDocumentVersion | null> {
  if (!Number.isInteger(versionNo) || versionNo < 1) return null;

  const supabase = await client(injected);
  const { data, error } = await supabase.schema("app").rpc("get_legal_document_version", {
    p_tenant_id: tenantId,
    p_kind: kind,
    p_version_no: versionNo,
  });

  if (error || data == null) return null;

  const parsed = versionSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

/**
 * ADRESY KANONICZNE — polskie, i to jest decyzja właściciela, nie przeoczenie.
 * Szablony sklepu niosą czterdzieści twardych odwołań do /regulamin
 * i /prywatnosc; dopasowaliśmy trasy do tego, co szablony już mówią, zamiast
 * przechodzić po treści zapisanej u najemców. Aliasy /terms i /privacy
 * przekierowują tutaj.
 */
export const LEGAL_DOCUMENT_PATHS: Record<LegalDocumentKind, string> = {
  terms: "/regulamin",
  privacy: "/prywatnosc",
};

/** Permalink do konkretnej wersji: /regulamin/w/2. */
export function legalVersionPath(kind: LegalDocumentKind, versionNo: number): string {
  return `${LEGAL_DOCUMENT_PATHS[kind]}/w/${versionNo}`;
}

/** Skrót spisu do jednego rodzaju — używany przez checkout i sitemapę. */
export function findLegalDocument(
  documents: PublishedLegalDocumentSummary[],
  kind: LegalDocumentKind,
): PublishedLegalDocumentSummary | null {
  return documents.find((document) => document.kind === kind) ?? null;
}
