"use server";

/**
 * Odczyt treści JEDNEJ wysłanej wiadomości — na żądanie, po kliknięciu
 * „Podgląd treści" (uwaga właściciela D10, 0035/ADR-073).
 *
 * DLACZEGO OSOBNY ODCZYT, A NIE POLE NA LIŚCIE. Treść to najcięższa i
 * najbardziej wrażliwa część wpisu: kilkadziesiąt kilobajtów HTML-a z danymi
 * osobowymi klienta. Dołożona do zapytania sekcji jechałaby do przeglądarki
 * przy KAŻDYM otwarciu zamówienia, razy liczba wysłanych wiadomości — także
 * wtedy (czyli prawie zawsze), gdy operator nie otwiera żadnego podglądu.
 * Lista dostaje więc sam bit `email_log_has_body` (kolumna wyliczana z 0035),
 * a treść schodzi wtedy i tylko wtedy, gdy ktoś o nią poprosił.
 *
 * BRAMKĄ JEST RLS, NIE ARGUMENT. Odczyt idzie sesją członka: polityka
 * `tenant_select` z 0021 nie pokaże wiersza spoza tenanta niezależnie od
 * tego, jaki identyfikator przyjdzie z przeglądarki. `eq("tenant_id", …)`
 * niżej jest drugą warstwą i wygodą diagnostyczną — nie jedyną bramką.
 *
 * ROZRÓŻNIENIE, KTÓREGO TEN ODCZYT NIE MOŻE ZGUBIĆ: „wpis bez treści"
 * (wiersz sprzed 0035 — `body IS NULL`) to CO INNEGO niż „wpisu nie ma".
 * Sklejenie obu w jeden komunikat kazałoby operatorowi zgadywać, czy patrzy
 * na starą wiadomość, czy na błąd — dlatego wracają osobnymi wariantami.
 */
import { z } from "zod";

import { AuthError } from "@/lib/auth";
import { assertClosableOrder } from "@/lib/closing";
import { requireMember } from "@/lib/supabase-server";

const inputSchema = z.object({
  logId: z.string().uuid(),
  orderId: z.string().uuid(),
});

export type EmailBodyResult =
  /** Treść zapisana przy wysyłce — dokładnie ta, którą dostał klient. */
  | { status: "body"; html: string }
  /** Wpis istnieje, ale powstał zanim rejestr trzymał treść (przed 0035). */
  | { status: "missing" }
  /** Nie udało się odczytać — powód do pokazania operatorowi. */
  | { status: "error"; message: string };

export async function loadEmailBodyAction(input: {
  logId: string;
  orderId: string;
}): Promise<EmailBodyResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: "Nieprawidłowy identyfikator wiadomości." };
  }

  // Opt-in okna domykania (ADR-138): podgląd treści maila to ODCZYT dowodu
  // komunikacji z klientem — potrzebny w sporach przy zwrocie.
  let ctx;
  try {
    ctx = await requireMember(undefined, { closing: true });
    await assertClosableOrder(ctx, parsed.data.orderId);
  } catch (err) {
    if (err instanceof AuthError) return { status: "error", message: err.message };
    throw err;
  }
  const tenantId = ctx.tenantId;
  if (!tenantId) {
    return { status: "error", message: "Sesja nie wskazuje najemcy — zaloguj się ponownie." };
  }

  const { data, error } = await ctx.supabase
    .from("email_logs")
    .select("body")
    .eq("tenant_id", tenantId)
    // Wpis MUSI należeć do tego zamówienia: podgląd otwiera się ze szczegółu
    // zamówienia i nie ma prawa być uchwytem do korespondencji z innego.
    .eq("order_id", parsed.data.orderId)
    .eq("id", parsed.data.logId)
    .maybeSingle();

  if (error) return { status: "error", message: error.message };
  if (!data) {
    return {
      status: "error",
      message: "Nie znaleziono tej wiadomości w historii tego zamówienia.",
    };
  }

  const html = typeof data.body === "string" ? data.body : "";
  // Białe znaki to nie treść: pusty podgląd udawałby, że klient dostał pustą
  // wiadomość, zamiast powiedzieć, że treści nie mamy.
  if (html.trim() === "") return { status: "missing" };

  return { status: "body", html };
}
