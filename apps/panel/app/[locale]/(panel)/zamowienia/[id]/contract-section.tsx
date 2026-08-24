import { randomUUID } from "node:crypto";

import { StatusBadge } from "@avably/ui";
import { getLocale, getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { CONTRACT_DOCUMENT_SETTINGS_KEY } from "@/lib/contract-settings";
import { secondaryStatusProps } from "@/lib/secondary-status";
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
  // Opt-in okna domykania (ADR-138): umowa jest na allowliście — sekcja
  // renderuje się w oknie; zbiór pilnują akcje (assertClosableOrder).
  const context = await requireMember(undefined, { closing: true });
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
    <section
      data-contract-card
      aria-labelledby="contract-heading"
      className="border-border bg-card flex flex-col gap-4 rounded-md border p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id="contract-heading"
          className="text-muted-foreground text-[11px] leading-[14px] font-semibold tracking-[0.08em] uppercase"
        >
          {t("title")}
        </h2>
        {settingsResult.data ? (
          <GenerateContractForm orderId={orderId} regenerate={documents.length > 0} />
        ) : null}
      </div>

      {!settingsResult.data ? (
        <p className="text-status-attention-fg text-sm">
          {t("missingSettings")}{" "}
          <Link className="underline" href="/ustawienia-umow">
            {t("settingsLink")}
          </Link>
        </p>
      ) : documents.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {documents.map((document) => {
            const attempt = latestAttempt.get(document.id);
            const href = `/zamowienia/${orderId}/contract/${document.id}`;
            return (
              <li
                key={document.id}
                data-contract-document
                className="border-border flex flex-col gap-2.5 rounded-md border p-3"
              >
                <div className="flex items-start gap-2.5">
                  <span className="text-muted-foreground mt-0.5 shrink-0" aria-hidden="true">
                    <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none">
                      <path
                        d="M5 2.5h6.5L16 7v10.5a1 1 0 01-1 1H5a1 1 0 01-1-1v-14a1 1 0 011-1z"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        strokeLinejoin="round"
                      />
                      <path d="M11.5 2.5V7H16" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground text-sm font-medium">
                      {t("version")}: {document.terms_version} · {document.locale.toUpperCase()}
                    </p>
                    <p className="text-muted-foreground text-xs tabular-nums">
                      {formatDate(document.created_at)}
                    </p>
                    <p className="text-muted-foreground text-xs break-all">{document.recipient}</p>
                    <p className="text-muted-foreground mt-1 font-mono text-[10px] leading-[14px] break-all">
                      SHA-256: {document.sha256}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <Link
                    className="underline underline-offset-2"
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t("preview")}
                  </Link>
                  <Link className="underline underline-offset-2" href={href}>
                    {t("download")}
                  </Link>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {attempt ? (
                    <StatusBadge {...secondaryStatusProps("email-log", attempt.status)}>
                      {t(attempt.status)}
                    </StatusBadge>
                  ) : (
                    <span className="text-muted-foreground text-xs">{t("notSent")}</span>
                  )}
                  <SendContractForm
                    orderId={orderId}
                    documentId={document.id}
                    attemptId={randomUUID()}
                    retry={attempt?.status === "failed"}
                  />
                </div>
                {attempt?.error ? <p className="text-destructive text-xs">{attempt.error}</p> : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
