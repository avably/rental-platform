import { randomUUID } from "node:crypto";

import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@avably/ui";
import { getLocale, getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { CONTRACT_DOCUMENT_SETTINGS_KEY } from "@/lib/contract-settings";
import { requireMember } from "@/lib/supabase-server";

import { GenerateContractForm, SendContractForm } from "./contract-forms";

interface DocumentRow {
  id: string;
  sha256: string;
  locale: "pl" | "en";
  terms_version: string;
  recipient: string;
  created_at: string;
}

interface AttemptRow {
  contract_document_id: string;
  status: "sent" | "failed";
  error: string | null;
  created_at: string;
}

export async function ContractSection({ orderId }: { orderId: string }) {
  const context = await requireMember();
  const locale = await getLocale();
  const t = await getTranslations("orders.contract");
  const [settingsResult, documentsResult, attemptsResult] = await Promise.all([
    context.supabase.from("tenant_settings").select("key").eq("tenant_id", context.tenantId).eq("key", CONTRACT_DOCUMENT_SETTINGS_KEY).maybeSingle(),
    context.supabase.from("contract_documents").select("id,sha256,locale,terms_version,recipient,created_at").eq("tenant_id", context.tenantId).eq("order_id", orderId).order("created_at", { ascending: false }),
    context.supabase.from("email_logs").select("contract_document_id,status,error,created_at").eq("tenant_id", context.tenantId).eq("order_id", orderId).eq("kind", "rental_contract").order("created_at", { ascending: false }),
  ]);
  const documents = (documentsResult.data ?? []) as DocumentRow[];
  const attempts = (attemptsResult.data ?? []) as AttemptRow[];
  const latestAttempt = new Map<string, AttemptRow>();
  for (const attempt of attempts) if (!latestAttempt.has(attempt.contract_document_id)) latestAttempt.set(attempt.contract_document_id, attempt);
  const formatDate = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

  return (
    <section className="flex flex-col gap-3" aria-labelledby="contract-heading">
      <h2 id="contract-heading" className="text-base font-semibold">{t("title")}</h2>
      {!settingsResult.data ? (
        <p className="text-sm text-status-attention-fg">{t("missingSettings")} <Link className="underline" href="/ustawienia-umow">{t("settingsLink")}</Link></p>
      ) : (
        <GenerateContractForm orderId={orderId} />
      )}
      {documents.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : (
        <Table>
          <TableHeader><TableRow><TableHead>{t("created")}</TableHead><TableHead>{t("details")}</TableHead><TableHead>{t("delivery")}</TableHead><TableHead>{t("actions")}</TableHead></TableRow></TableHeader>
          <TableBody>{documents.map((document) => {
            const attempt = latestAttempt.get(document.id);
            return (
              <TableRow key={document.id}>
                <TableCell className="whitespace-nowrap">{formatDate(document.created_at)}</TableCell>
                <TableCell className="space-y-1 text-xs">
                  <p>{t("version")}: {document.terms_version} · {document.locale.toUpperCase()}</p>
                  <p className="break-all font-mono">SHA-256: {document.sha256}</p>
                  <p className="break-all">{document.recipient}</p>
                </TableCell>
                <TableCell>{attempt ? <div className="space-y-1"><Badge variant={attempt.status === "sent" ? "default" : "outline"}>{t(attempt.status)}</Badge>{attempt.error ? <p className="text-xs text-destructive">{attempt.error}</p> : null}</div> : <span className="text-sm text-muted-foreground">{t("notSent")}</span>}</TableCell>
                <TableCell className="space-y-2">
                  <Link className="text-sm underline" href={`/zamowienia/${orderId}/contract/${document.id}`}>{t("download")}</Link>
                  <SendContractForm orderId={orderId} documentId={document.id} attemptId={randomUUID()} retry={attempt?.status === "failed"} />
                </TableCell>
              </TableRow>
            );
          })}</TableBody>
        </Table>
      )}
    </section>
  );
}
