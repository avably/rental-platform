/**
 * GET /{locale}/ustawienia-umow/podglad — umowa przykładowa jako PDF (U10,
 * ADR-151).
 *
 * Route handler, a nie server action, z tego samego powodu co etykieta
 * przewozowa (ADR-031): akcja nie umie odpowiedzieć strumieniem
 * `application/pdf`. Odpowiedź jest `no-store` i `inline` — dokument
 * przykładowy nie ma prawa zostać w pamięci podręcznej przeglądarki po zmianie
 * warunków, bo wtedy operator „sprawdziłby" poprzednią wersję.
 *
 * BEZ opt-inu okna domykania (ADR-138) — świadomie. Allowlista Zasady 8 wpuszcza
 * czynności potrzebne, żeby DOKOŃCZYĆ trwające najmy (umowa zamówienia, etykieta,
 * zwrot kaucji). Podgląd ustawień nie domyka niczego, więc najemcy w oknie
 * domykania nie należy się nowa powierzchnia — dostaje odmowę z tego samego
 * guardu co reszta ekranu ustawień.
 *
 * Podgląd NICZEGO NIE ZAPISUJE: nie tworzy wiersza w `contract_documents`, nie
 * wgrywa pliku do koszyka i nie zużywa numeracji. Cała ta obietnica mieszka
 * w `../preview.ts` i tam jest przypięta testem.
 */
import { AuthError } from "@/lib/auth";
import { ContractSettingsError } from "@/lib/contract-settings";
import { requireMember } from "@/lib/supabase-server";

import { contractPreviewDeps, renderContractPreview } from "../preview";

export async function GET(): Promise<Response> {
  let context;
  try {
    context = await requireMember();
  } catch (error) {
    // Status z AuthError (401/403) — wzorem trasy umowy i etykiety; gołe 401
    // maskowałoby odmowę roli jako brak sesji.
    if (error instanceof AuthError) return new Response(null, { status: error.status });
    throw error;
  }

  try {
    const preview = await renderContractPreview(contractPreviewDeps(), context.supabase, {
      tenantId: context.tenantId!,
      today: new Date().toISOString().slice(0, 10),
    });
    return new Response(preview.bytes as BodyInit, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${preview.filename}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof ContractSettingsError) {
      return new Response("Uzupełnij i zapisz ustawienia umów, żeby zobaczyć podgląd.", {
        status: 409,
      });
    }
    throw error;
  }
}
