/**
 * Permalink do KONKRETNEJ wersji polityki prywatności (B4, ADR-129) — okazanie tekstu,
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
  return legalMetadata("privacy", { versionNo: Number(wersja) });
}

export default async function TenantPrivacyVersionPage({
  params,
}: {
  params: Promise<{ wersja: string }>;
}) {
  const { wersja } = await params;
  return LegalDocumentVersionPage({ kind: "privacy", version: wersja });
}
