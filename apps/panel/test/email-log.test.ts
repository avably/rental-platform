import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { panelEmailLogRecorder } from "@/lib/email-log";

describe("panelEmailLogRecorder — dokument umowy", () => {
  it("mapuje dokument i idempotency key oraz ignoruje duplikat bez UPDATE", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ upsert });
    const recorder = panelEmailLogRecorder({ from } as unknown as SupabaseClient, "tenant-a");

    await recorder.record({
      kind: "rental_contract",
      orderId: "order-a",
      contractDocumentId: "document-a",
      idempotencyKey: "rental-contract/document-a/attempt-a",
      recipient: "klient@example.com",
      subject: "Umowa najmu",
      status: "sent",
      providerMessageId: "resend-a",
    });

    expect(from).toHaveBeenCalledWith("email_logs");
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: "tenant-a",
        order_id: "order-a",
        contract_document_id: "document-a",
        idempotency_key: "rental-contract/document-a/attempt-a",
      }),
      { onConflict: "tenant_id,idempotency_key", ignoreDuplicates: true },
    );
  });

  it("stary wpis zachowuje null w nowych kolumnach", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const recorder = panelEmailLogRecorder(
      { from: () => ({ upsert }) } as unknown as SupabaseClient,
      "tenant-a",
    );

    await recorder.record({
      kind: "invitation",
      recipient: "operator@example.com",
      subject: "Zaproszenie",
      status: "sent",
      providerMessageId: "resend-b",
    });

    expect(upsert.mock.calls[0]![0]).toMatchObject({
      contract_document_id: null,
      idempotency_key: null,
    });
  });
});
