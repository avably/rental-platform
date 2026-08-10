/**
 * Regulamin sklepu najemcy (B4, ADR-129). Adres kanoniczny — czterdzieści
 * odwołań w szablonach prowadziło dotąd w nieobrandowaną stronę 404 platformy
 * renderowaną na domenie najemcy.
 */
import type { Metadata } from "next";

import { LegalDocumentPage, legalMetadata } from "@/components/storefront/legal-page";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return legalMetadata("terms");
}

export default async function TenantTermsPage() {
  return LegalDocumentPage({ kind: "terms" });
}
