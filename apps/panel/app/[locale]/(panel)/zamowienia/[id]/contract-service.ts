import type { EmailLogRecorder, EmailTransport, Locale } from "@avably/core";
import { sendAndLog } from "@avably/core";
import type { ContractPdfProps } from "@avably/pdf";

import { buildContractEmail, sha256Hex, verifySha256 } from "./contract-document";

export interface ContractDocumentRow {
  id: string;
  tenant_id: string;
  order_id: string;
  storage_path: string;
  sha256: string;
  locale: Locale;
  terms_version: string;
  recipient: string;
  created_by: string;
  created_at: string;
}

type NewDocument = Omit<ContractDocumentRow, "created_at">;

export interface ContractRepository {
  findByHash(tenantId: string, orderId: string, sha256: string): Promise<ContractDocumentRow | null>;
  insert(document: NewDocument): Promise<ContractDocumentRow>;
  findById(tenantId: string, orderId: string, documentId: string): Promise<ContractDocumentRow | null>;
  findAttempt(tenantId: string, idempotencyKey: string): Promise<{ status: "sent" | "failed"; error: string | null } | null>;
}

export class ContractRepositoryError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = "ContractRepositoryError";
  }
}

export interface ContractStorage {
  upload(path: string, bytes: Uint8Array, options: { upsert: false }): Promise<void>;
  download(path: string): Promise<Uint8Array>;
  removeOrphan(path: string): Promise<void>;
}

export interface ContractServiceDeps {
  createId(): string;
  render(props: ContractPdfProps): Promise<Uint8Array>;
  repository: ContractRepository;
  storage: ContractStorage;
  transport: EmailTransport;
  recorder?: EmailLogRecorder;
}

export interface GenerateContractInput {
  tenantId: string;
  orderId: string;
  userId: string;
  locale: Locale;
  termsVersion: string;
  recipient: string;
  props: ContractPdfProps;
}

export async function generateContract(
  deps: ContractServiceDeps,
  input: GenerateContractInput,
): Promise<ContractDocumentRow> {
  const bytes = await deps.render(input.props);
  const sha256 = sha256Hex(bytes);
  const existing = await deps.repository.findByHash(input.tenantId, input.orderId, sha256);
  if (existing) return existing;

  const id = deps.createId();
  const storagePath = `${input.tenantId}/${input.orderId}/${id}.pdf`;
  const document: NewDocument = {
    id,
    tenant_id: input.tenantId,
    order_id: input.orderId,
    storage_path: storagePath,
    sha256,
    locale: input.locale,
    terms_version: input.termsVersion,
    recipient: input.recipient,
    created_by: input.userId,
  };

  await deps.storage.upload(storagePath, bytes, { upsert: false });
  try {
    return await deps.repository.insert(document);
  } catch (error) {
    await deps.storage.removeOrphan(storagePath);
    if (error instanceof ContractRepositoryError && error.code === "23505") {
      const winner = await deps.repository.findByHash(input.tenantId, input.orderId, sha256);
      if (winner) return winner;
    }
    throw error;
  }
}

export interface ContractIdentity {
  tenantId: string;
  orderId: string;
  documentId: string;
}

export async function downloadContract(deps: ContractServiceDeps, identity: ContractIdentity) {
  const document = await deps.repository.findById(
    identity.tenantId,
    identity.orderId,
    identity.documentId,
  );
  if (!document) throw new Error("Dokument umowy nie istnieje.");
  const bytes = await deps.storage.download(document.storage_path);
  verifySha256(bytes, document.sha256);
  return {
    bytes,
    filename: `umowa-${identity.orderId}-${identity.documentId}.pdf`,
    document,
  };
}

export interface SendContractInput extends ContractIdentity {
  attemptId: string;
  tenantName: string;
  customerName: string;
  orderNumber: string;
  replyTo?: string;
  fromEmail?: string;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "nieznany błąd";

export async function sendContract(
  deps: ContractServiceDeps,
  input: SendContractInput,
): Promise<{ success?: string; formError?: string }> {
  const idempotencyKey = `rental-contract/${input.documentId}/${input.attemptId}`;
  const previous = await deps.repository.findAttempt(input.tenantId, idempotencyKey);
  if (previous) {
    return previous.status === "sent"
      ? { success: "Umowa została już wysłana." }
      : { formError: `Ta próba wysyłki już się nie udała: ${previous.error ?? "nieznany błąd"}` };
  }

  const downloaded = await downloadContract(deps, input);
  const email = await buildContractEmail({
    locale: downloaded.document.locale,
    tenantName: input.tenantName,
    customerName: input.customerName,
    customerEmail: downloaded.document.recipient,
    orderNumber: input.orderNumber,
    bytes: downloaded.bytes,
    filename: `umowa-${input.orderNumber}.pdf`,
    idempotencyKey,
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    ...(input.fromEmail ? { fromEmail: input.fromEmail } : {}),
  });

  const result = await sendAndLog({
    transport: deps.transport,
    recorder: deps.recorder,
    email,
    kind: "rental_contract",
    orderId: input.orderId,
    contractDocumentId: input.documentId,
  });
  if (result.sendError) {
    return { formError: `Nie udało się wysłać umowy: ${errorMessage(result.sendError)}` };
  }
  if (result.logIssue) {
    return { success: `Umowa została wysłana. ${result.logIssue}` };
  }
  return { success: "Umowa została wysłana." };
}
