/**
 * Dokumenty prawne sklepu — warstwa danych i render (B4, ADR-129).
 *
 * Zachowanie samych funkcji bazy (izolacja najemców, niezmienność wersji,
 * przypięcie zamówienia) dowodzi `packages/db/test/legal-documents.test.ts`.
 * Tutaj kontrakt strony sklepu: fail-closed na błędach i złych kształtach,
 * kanoniczne adresy oraz — najważniejsze — że treść pisana przez najemcę
 * NIE JEST wykonywana jako HTML.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { LegalDocumentView } from "@/components/storefront/legal-document-view";
import {
  findLegalDocument,
  getLegalDocumentVersion,
  getPublishedLegalDocument,
  getPublishedLegalDocuments,
  LEGAL_DOCUMENT_PATHS,
  legalVersionPath,
} from "@/lib/legal/published";
import plMessages from "@/messages/pl.json";
import type { StorefrontCopy } from "@/lib/storefront/copy";

const TENANT_ID = "00000000-0000-4000-8000-000000000001";
const SHA = "a".repeat(64);
const copy = plMessages.storefront as unknown as StorefrontCopy;

/** Klient-atrapa (wzorzec test/site-published.test.ts). */
function fakeClient(result: { data: unknown; error: unknown }) {
  const calls: { fn: string; args: unknown }[] = [];
  const client = {
    schema: (name: string) => {
      if (name !== "app") throw new Error(`nieoczekiwany schemat: ${name}`);
      return {
        rpc: (fn: string, args: unknown) => {
          calls.push({ fn, args });
          return Promise.resolve(result);
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const summary = {
  kind: "terms",
  title: "Regulamin",
  version_label: "v2",
  version_no: 2,
  published_at: "2026-08-10T10:00:00+00:00",
  locale: "pl",
};

const document = { ...summary, body: "Treść regulaminu.", sha256: SHA };

describe("warstwa danych dokumentów prawnych", () => {
  it("spis woła app.get_published_legal_documents z id tenanta", async () => {
    const { client, calls } = fakeClient({ data: [summary], error: null });

    const documents = await getPublishedLegalDocuments(TENANT_ID, client);

    expect(calls).toEqual([
      { fn: "get_published_legal_documents", args: { p_tenant_id: TENANT_ID } },
    ]);
    expect(documents).toHaveLength(1);
    expect(documents[0]?.version_label).toBe("v2");
  });

  it("spis jest fail-closed: błąd i nieznany kształt dają pustą listę", async () => {
    const broken = fakeClient({ data: null, error: { message: "boom" } });
    expect(await getPublishedLegalDocuments(TENANT_ID, broken.client)).toEqual([]);

    const wrongShape = fakeClient({ data: [{ kind: "terms" }], error: null });
    expect(await getPublishedLegalDocuments(TENANT_ID, wrongShape.client)).toEqual([]);

    // Rodzaj spoza kontraktu (np. dołożony w bazie bez zmiany kodu) nie
    // przecieka do renderu jako `kind`, którego trasa nie zna.
    const unknownKind = fakeClient({ data: [{ ...summary, kind: "cookies" }], error: null });
    expect(await getPublishedLegalDocuments(TENANT_ID, unknownKind.client)).toEqual([]);
  });

  it("dokument bez treści albo z niepoprawnym sha256 jest odrzucany", async () => {
    const noBody = fakeClient({ data: { ...summary }, error: null });
    expect(await getPublishedLegalDocument(TENANT_ID, "terms", noBody.client)).toBeNull();

    const badHash = fakeClient({ data: { ...document, sha256: "nie-hash" }, error: null });
    expect(await getPublishedLegalDocument(TENANT_ID, "terms", badHash.client)).toBeNull();

    const ok = fakeClient({ data: document, error: null });
    expect((await getPublishedLegalDocument(TENANT_ID, "terms", ok.client))?.body).toBe(
      "Treść regulaminu.",
    );
  });

  it("permalink odrzuca numer wersji spoza liczb naturalnych BEZ pytania bazy", async () => {
    for (const versionNo of [0, -1, 1.5, Number.NaN]) {
      const { client, calls } = fakeClient({ data: null, error: null });
      expect(await getLegalDocumentVersion(TENANT_ID, "terms", versionNo, client)).toBeNull();
      expect(calls, `numer ${versionNo} poszedł do bazy`).toEqual([]);
    }

    const { client, calls } = fakeClient({ data: { ...document, current: false }, error: null });
    const version = await getLegalDocumentVersion(TENANT_ID, "terms", 1, client);
    expect(calls[0]?.args).toEqual({ p_tenant_id: TENANT_ID, p_kind: "terms", p_version_no: 1 });
    expect(version?.current).toBe(false);
  });

  it("adresy kanoniczne są polskie, a permalink niesie numer wersji", () => {
    expect(LEGAL_DOCUMENT_PATHS).toEqual({ terms: "/regulamin", privacy: "/prywatnosc" });
    expect(legalVersionPath("terms", 3)).toBe("/regulamin/w/3");
    expect(findLegalDocument([summary as never], "privacy")).toBeNull();
    expect(findLegalDocument([summary as never], "terms")?.version_no).toBe(2);
  });
});

describe("render dokumentu prawnego", () => {
  function render(overrides: Partial<Parameters<typeof LegalDocumentView>[0]> = {}) {
    return renderToStaticMarkup(
      <LegalDocumentView
        title="Regulamin"
        body={"Akapit pierwszy.\n\nAkapit drugi."}
        versionLabel="v2"
        publishedAt="2026-08-10T10:00:00+00:00"
        sha256={SHA}
        locale="pl"
        copy={copy}
        {...overrides}
      />,
    );
  }

  it("treść najemcy trafia na stronę jako TEKST, nie jako HTML", () => {
    // To jest bramka, nie kosmetyka: `body` pisze najemca w panelu, a strona
    // stoi na jego własnej domenie, obok formularza checkoutu.
    const html = render({ body: '<script>alert(1)</script><img src=x onerror="alert(2)">' });

    // Mierzymy ZNACZNIKI, nie podciągi: `onerror=` występuje w wyniku, ale
    // wyłącznie jako tekst wewnątrz zescapowanego ciągu — pierwsza wersja tej
    // asercji uznała to za wyciek, choć żaden element nie powstał.
    expect(html, "treść najemcy powołała element <script>").not.toContain("<script");
    expect(html, "treść najemcy powołała element <img>").not.toContain("<img");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    // Kontrola, że asercje wyżej nie są puste: treść faktycznie się wyrenderowała.
    expect(html).toContain('<p class="whitespace-pre-line">');
  });

  it("akapity powstają z pustych linii, a numer wersji jest widoczny", () => {
    const html = render();

    expect(html).toContain("Akapit pierwszy.");
    expect(html).toContain("Akapit drugi.");
    expect(html.match(/<p class="whitespace-pre-line">/g) ?? []).toHaveLength(2);
    expect(html).toContain("Wersja v2");
    expect(html).toContain('data-legal-version="v2"');
  });

  it("wersja archiwalna niesie ostrzeżenie i link do obowiązującej", () => {
    const html = render({ currentHref: "/regulamin" });

    expect(html).toContain('data-legal-archived="true"');
    expect(html).toContain('href="/regulamin"');
    expect(html).toContain(copy.legal.currentVersionLink);
  });

  it("wersja żywa NIE udaje archiwalnej", () => {
    expect(render()).not.toContain("data-legal-archived");
  });
});
