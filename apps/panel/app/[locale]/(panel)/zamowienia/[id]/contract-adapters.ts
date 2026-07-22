import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { resendTransport, type EmailLogRecorder, type EmailTransport } from "@avably/core";
import { renderContractPdf } from "@avably/pdf";

import {
  ContractRepositoryError,
  type ContractDocumentRow,
  type ContractRepository,
  type ContractServiceDeps,
  type ContractStorage,
} from "./contract-service";

export function supabaseContractRepository(supabase: SupabaseClient): ContractRepository {
  const columns = "id,tenant_id,order_id,storage_path,sha256,locale,terms_version,recipient,created_by,created_at";
  return {
    async findByHash(tenantId, orderId, sha256) {
      const { data, error } = await supabase.from("contract_documents").select(columns)
        .eq("tenant_id", tenantId).eq("order_id", orderId).eq("sha256", sha256).maybeSingle();
      if (error) throw new ContractRepositoryError(error.message, error.code);
      return data as ContractDocumentRow | null;
    },
    async insert(document) {
      const { data, error } = await supabase.from("contract_documents").insert(document).select(columns).single();
      if (error) throw new ContractRepositoryError(error.message, error.code);
      return data as ContractDocumentRow;
    },
    async findById(tenantId, orderId, documentId) {
      const { data, error } = await supabase.from("contract_documents").select(columns)
        .eq("tenant_id", tenantId).eq("order_id", orderId).eq("id", documentId).maybeSingle();
      if (error) throw new ContractRepositoryError(error.message, error.code);
      return data as ContractDocumentRow | null;
    },
    async findAttempt(tenantId, idempotencyKey) {
      const { data, error } = await supabase.from("email_logs").select("status,error")
        .eq("tenant_id", tenantId).eq("idempotency_key", idempotencyKey).maybeSingle();
      if (error) throw new ContractRepositoryError(error.message, error.code);
      return data as { status: "sent" | "failed"; error: string | null } | null;
    },
  };
}

export function supabaseContractStorage(supabase: SupabaseClient): ContractStorage {
  const bucket = supabase.storage.from("rental-contracts");
  return {
    async upload(path, bytes, options) {
      const { error } = await bucket.upload(path, bytes, { contentType: "application/pdf", ...options });
      if (error) throw new Error(error.message);
    },
    async download(path) {
      const { data, error } = await bucket.download(path);
      if (error || !data) throw new Error(error?.message ?? "Nie udało się pobrać umowy.");
      return new Uint8Array(await data.arrayBuffer());
    },
    async removeOrphan(path) {
      const { data, error } = await bucket.remove([path]);
      if (error) throw new Error(error.message);
      if (!data?.some((object) => object.name === path)) {
        throw new Error("Nie udało się posprzątać osieroconego pliku umowy.");
      }
    },
  };
}

export function contractServiceDeps(
  supabase: SupabaseClient,
  options: { transport?: EmailTransport; recorder?: EmailLogRecorder } = {},
): ContractServiceDeps {
  return {
    createId: randomUUID,
    render: renderContractPdf,
    repository: supabaseContractRepository(supabase),
    storage: supabaseContractStorage(supabase),
    transport: options.transport ?? resendTransport(),
    ...(options.recorder ? { recorder: options.recorder } : {}),
  };
}
