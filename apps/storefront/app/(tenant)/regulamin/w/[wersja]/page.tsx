/**
 * Permalink do KONKRETNEJ wersji regulaminu (B4, ADR-129) — okazanie tekstu,
 * na który przystał klient, także po późniejszych edycjach najemcy.
 */
import type { Metadata } from "next";

import { LegalDocumentVersionPage, legalMetadata } from "@/components/storefront/legal-page";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ wersja: string }>;
}): Promise<Metadata> {
  const { wersja } = await params;
  return legalMetadata("terms", { versionNo: Number(wersja) });
}

export default async function TenantTermsVersionPage({
  params,
}: {
  params: Promise<{ wersja: string }>;
}) {
  const { wersja } = await params;
  return LegalDocumentVersionPage({ kind: "terms", version: wersja });
}
