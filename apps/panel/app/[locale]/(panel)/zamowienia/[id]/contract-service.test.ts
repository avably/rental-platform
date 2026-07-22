import { describe, expect, it, vi } from "vitest";

import type { EmailLogRecorder, EmailTransport } from "@avably/core";

import { sha256Hex } from "./contract-document";
import {
  downloadContract,
  generateContract,
  sendContract,
  type ContractDocumentRow,
  type ContractServiceDeps,
} from "./contract-service";

const bytes = new Uint8Array([37, 80, 68, 70, 45, 49]);
const row: ContractDocumentRow = {
  id: "doc-1",
  tenant_id: "tenant-1",
  order_id: "order-1",
  storage_path: "tenant-1/order-1/doc-1.pdf",
  sha256: sha256Hex(bytes),
  locale: "pl",
  terms_version: "v1",
  recipient: "anna@example.pl",
  created_by: "user-1",
  created_at: "2026-07-22T00:00:00Z",
};

function deps(overrides: Partial<ContractServiceDeps> = {}): ContractServiceDeps {
  return {
    createId: () => "doc-1",
    render: vi.fn(async () => bytes),
    repository: {
      findByHash: vi.fn(async () => null),
      insert: vi.fn(async (value) => ({ ...value, created_at: row.created_at })),
      findById: vi.fn(async () => row),
      findAttempt: vi.fn(async () => null),
    },
    storage: {
      upload: vi.fn(async () => undefined),
      download: vi.fn(async () => bytes),
      removeOrphan: vi.fn(async () => undefined),
    },
    transport: { send: vi.fn(async () => ({ id: "mail-1" })) },
    recorder: { record: vi.fn(async () => undefined) },
    ...overrides,
  };
}

describe("generateContract", () => {
  const input = {
    tenantId: "tenant-1",
    orderId: "order-1",
    userId: "user-1",
    locale: "pl" as const,
    termsVersion: "v1",
    recipient: "anna@example.pl",
    props: {} as never,
  };

  it("renderuje raz, zapisuje exact bytes bez upsert i metadane", async () => {
    const d = deps();
    await expect(generateContract(d, input)).resolves.toMatchObject(row);
    expect(d.render).toHaveBeenCalledTimes(1);
    expect(d.storage.upload).toHaveBeenCalledWith(row.storage_path, bytes, { upsert: false });
    expect(d.repository.insert).toHaveBeenCalledWith(expect.objectContaining({ sha256: row.sha256 }));
  });

  it("reużywa istniejący dokument o tym samym hashu", async () => {
    const d = deps();
    vi.mocked(d.repository.findByHash).mockResolvedValue(row);
    await expect(generateContract(d, input)).resolves.toEqual(row);
    expect(d.storage.upload).not.toHaveBeenCalled();
    expect(d.repository.insert).not.toHaveBeenCalled();
  });

  it("sprząta własny niezarejestrowany plik po błędzie INSERT", async () => {
    const d = deps();
    vi.mocked(d.repository.insert).mockRejectedValue(new Error("unique"));
    await expect(generateContract(d, input)).rejects.toThrow("unique");
    expect(d.storage.removeOrphan).toHaveBeenCalledWith(row.storage_path);
  });
});

describe("downloadContract", () => {
  it("zwraca identyczne bajty po sprawdzeniu hasha", async () => {
    const d = deps();
    await expect(downloadContract(d, { tenantId: "tenant-1", orderId: "order-1", documentId: "doc-1" })).resolves.toEqual({
      bytes,
      filename: "umowa-order-1-doc-1.pdf",
      document: row,
    });
  });

  it("odrzuca podmieniony plik", async () => {
    const d = deps();
    vi.mocked(d.storage.download).mockResolvedValue(new Uint8Array([1, 2, 3]));
    await expect(downloadContract(d, { tenantId: "tenant-1", orderId: "order-1", documentId: "doc-1" })).rejects.toThrow(/SHA-256/);
  });

  it("nie ujawnia dokumentu niewidocznego przez repozytorium", async () => {
    const d = deps();
    vi.mocked(d.repository.findById).mockResolvedValue(null);
    await expect(downloadContract(d, { tenantId: "tenant-1", orderId: "order-1", documentId: "foreign" })).rejects.toThrow(/nie istnieje/i);
    expect(d.storage.download).not.toHaveBeenCalled();
  });
});

describe("sendContract", () => {
  const input = {
    tenantId: "tenant-1",
    orderId: "order-1",
    documentId: "doc-1",
    attemptId: "attempt-1",
    tenantName: "Najem Demo",
    customerName: "Anna",
    orderNumber: "ZAM-1",
    fromEmail: "send@avably.pl",
  };

  it("wysyła dokładnie zapisane bajty i zapisuje wynik", async () => {
    const d = deps();
    await expect(sendContract(d, input)).resolves.toEqual({ success: "Umowa została wysłana." });
    const message = vi.mocked(d.transport.send).mock.calls[0]?.[0];
    expect(message?.attachments?.[0]?.content).toBe(bytes);
    expect(message?.idempotencyKey).toBe("rental-contract/doc-1/attempt-1");
    expect(d.recorder?.record).toHaveBeenCalledWith(expect.objectContaining({ status: "sent", contractDocumentId: "doc-1" }));
  });

  it("nie powtarza transportu dla istniejącego klucza próby", async () => {
    const d = deps();
    vi.mocked(d.repository.findAttempt).mockResolvedValue({ status: "sent", error: null });
    await expect(sendContract(d, input)).resolves.toEqual({ success: "Umowa została już wysłana." });
    expect(d.transport.send).not.toHaveBeenCalled();
  });

  it("nowy attemptId uruchamia świadomą kolejną próbę", async () => {
    const d = deps();
    await sendContract(d, { ...input, attemptId: "attempt-2" });
    expect(d.transport.send).toHaveBeenCalledTimes(1);
  });

  it("błąd transportu jest logowany jako failed", async () => {
    const transport: EmailTransport = { send: vi.fn(async () => { throw new Error("resend down"); }) };
    const recorder: EmailLogRecorder = { record: vi.fn(async () => undefined) };
    const d = deps({ transport, recorder });
    await expect(sendContract(d, input)).resolves.toEqual({ formError: "Nie udało się wysłać umowy: resend down" });
    expect(recorder.record).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", error: "resend down" }));
  });
});
