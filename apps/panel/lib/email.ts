/**
 * Wysyłka e-maili transakcyjnych spoza Supabase Auth (zaproszenia członków —
 * Supabase nie ma dla nich wbudowanego szablonu jak dla confirmation/recovery).
 * Resend, jeśli skonfigurowany `RESEND_API_KEY`; w przeciwnym razie
 * dev-fallback: log do konsoli serwera (link zaproszenia widoczny do
 * ręcznego testu lokalnego, bez zewnętrznej usługi).
 *
 * TODO(Task 3 infra): dodać RESEND_API_KEY + zweryfikowaną domenę nadawcy
 * (RESEND_FROM_EMAIL) po stronie hostingu.
 */
let warnedDevSkip = false;

export async function sendInvitationEmail(opts: { to: string; acceptUrl: string }): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    if (!warnedDevSkip) {
      console.warn(
        "[email] RESEND_API_KEY nie ustawiony — tryb dev-skip, e-mail zaproszenia NIE jest wysyłany " +
          "(patrz TODO w lib/email.ts). Link zaproszenia poniżej, do ręcznego testu:",
      );
      warnedDevSkip = true;
    }
    console.info(`[email:dev] Zaproszenie dla ${opts.to}: ${opts.acceptUrl}`);
    return;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev",
      to: opts.to,
      subject: "Zaproszenie do organizacji",
      html: `<p>Zostałeś(-aś) zaproszony(-a) do organizacji.</p><p><a href="${opts.acceptUrl}">Dołącz do organizacji</a></p>`,
    }),
  });
  if (!response.ok) {
    throw new Error(`Wysyłka e-maila zaproszenia nie powiodła się (Resend HTTP ${response.status}).`);
  }
}
