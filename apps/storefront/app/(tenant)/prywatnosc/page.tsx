/**
 * Polityka prywatności sklepu najemcy (B4, ADR-129). Adres kanoniczny; ten sam
 * link stoi też pod formularzem kontaktu (`privacyHref` w sekcji kontaktu),
 * czyli pod formularzem zbierającym dane osobowe.
 */
import type { Metadata } from "next";

import { LegalDocumentPage, legalMetadata } from "@/components/storefront/legal-page";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return legalMetadata("privacy");
}

export default async function TenantPrivacyPage() {
  return LegalDocumentPage({ kind: "privacy" });
}
