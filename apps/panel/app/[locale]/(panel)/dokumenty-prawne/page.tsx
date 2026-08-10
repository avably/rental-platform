/**
 * DOKUMENTY PRAWNE SKLEPU (B4, ADR-129) — regulamin i polityka prywatności.
 *
 * Ekran istnieje, bo sklep najemcy linkuje do `/regulamin` i `/prywatnosc`,
 * a do 0063 pod tymi adresami nie było niczego. Treść regulaminu istniała
 * w `tenant_settings.contract_document.terms_body` — ale WYŁĄCZNIE na potrzeby
 * PDF-a umowy, bez publicznego wyjścia i bez historii.
 *
 * ROZDZIAŁ SZKICU I WERSJI jest sednem, więc ekran go pokazuje: to, co piszesz
 * (`body_draft`), i to, co widzi klient (wiersz `legal_document_versions`), to
 * dwie różne rzeczy, a most między nimi nazywa się „Opublikuj".
 *
 * FORK RÓL JEST SERWEROWY (wzorzec `ustawienia-umow/page.tsx`): właściciel
 * dostaje formularz, personel — listę odczytową. Nie „wyłączony formularz":
 * atrapa zapisu, która oddaje odmowę z RLS, jest gorsza od jej braku.
 * Prawdziwą bramką jest RLS 0063, nie ten warunek.
 *
 * `force-dynamic`: trasa interaktywna (useActionState/useTransition) —
 * statyczny prerender razem z CSP nonce zabiłby hydrację po cichu.
 */
import { getFormatter, getTranslations } from "next-intl/server";

import { FormMeasure } from "@/components/screens/form-measure";
import { requireMemberPage } from "@/lib/member-page";
import {
  LEGAL_DOCUMENT_KINDS,
  shortChecksum,
  type LegalDocumentKind,
  type LegalDocumentLocale,
} from "@/lib/legal-documents";

import { LegalDocumentForm } from "./legal-document-form";
import { LegalDocumentReadOnly } from "./legal-document-read-only";
import { MissingTermsWarning } from "./missing-terms-warning";
import type { LegalDocumentView, LegalVersionView } from "./types";

export const dynamic = "force-dynamic";

interface DocumentRow {
  id: string;
  kind: string;
  title: string;
  body_draft: string;
  locale: string;
  current_version_id: string | null;
}

interface VersionRow {
  id: string;
  kind: string;
  version_no: number;
  version_label: string;
  sha256: string;
  published_at: string;
}

export default async function LegalDocumentsPage() {
  const context = await requireMemberPage("/dokumenty-prawne");
  const t = await getTranslations("legalDocuments");
  const format = await getFormatter();

  // Odczyt zwykłym PostgREST-em: bramką zasięgu jest RLS 0063 (odczyt = żywy
  // członek tenanta), a `.eq("tenant_id")` jest zawężeniem zapytania, nie
  // mechanizmem izolacji.
  const [{ data: documentData }, { data: versionData }] = await Promise.all([
    context.supabase
      .from("legal_documents")
      .select("id,kind,title,body_draft,locale,current_version_id")
      .eq("tenant_id", context.tenantId),
    context.supabase
      .from("legal_document_versions")
      .select("id,kind,version_no,version_label,sha256,published_at")
      .eq("tenant_id", context.tenantId)
      .order("version_no", { ascending: false }),
  ]);

  const documents = (documentData ?? []) as DocumentRow[];
  const versions = (versionData ?? []) as VersionRow[];

  const stamp = (value: string) =>
    format.dateTime(new Date(value), { dateStyle: "short", timeStyle: "short" });

  function viewOf(kind: LegalDocumentKind): LegalDocumentView | null {
    const row = documents.find((candidate) => candidate.kind === kind);
    if (!row) return null;

    const rows: LegalVersionView[] = versions
      .filter((version) => version.kind === kind)
      .map((version) => ({
        id: version.id,
        versionNo: version.version_no,
        versionLabel: version.version_label,
        publishedAtLabel: stamp(version.published_at),
        checksum: shortChecksum(version.sha256),
      }));

    const current = versions.find((version) => version.id === row.current_version_id) ?? null;

    return {
      kind,
      title: row.title,
      bodyDraft: row.body_draft,
      locale: row.locale === "en" ? "en" : ("pl" as LegalDocumentLocale),
      // Etykieta ŻYWEJ wersji bierze się z `current_version_id`, a nie
      // z „najnowszego wiersza": to jedyna kolumna, która mówi, co widzi klient.
      currentVersionLabel: row.current_version_id ? (current?.version_label ?? "—") : null,
      currentPublishedAtLabel: current ? stamp(current.published_at) : null,
      versions: rows,
    };
  }

  const views = new Map<LegalDocumentKind, LegalDocumentView | null>(
    LEGAL_DOCUMENT_KINDS.map((kind) => [kind, viewOf(kind)]),
  );

  // „Sklep sprzedaje bez regulaminu" = nie ma dokumentu `terms` z niepustym
  // `current_version_id`. Sam szkic NIE wystarcza: publiczny odczyt
  // (app.get_published_legal_document) czyta wyłącznie rejestr wersji.
  const termsPublished = views.get("terms")?.currentVersionLabel != null;
  const isOwner = context.role === "owner";

  return (
    <FormMeasure className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">{t("intro")}</p>
      {termsPublished ? null : <MissingTermsWarning />}
      {LEGAL_DOCUMENT_KINDS.map((kind) =>
        isOwner ? (
          <LegalDocumentForm key={kind} kind={kind} document={views.get(kind) ?? null} />
        ) : (
          <LegalDocumentReadOnly key={kind} kind={kind} document={views.get(kind) ?? null} />
        ),
      )}
    </FormMeasure>
  );
}
