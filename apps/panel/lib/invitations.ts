/**
 * Status zaproszenia LICZONY z faktów, nie przechowywany (ADR-105 D2).
 *
 * Baza trzyma trzy niezależne znaczniki czasu — `accepted_at`, `revoked_at`,
 * `expires_at` — i to z nich wynika stan. Kolumna `status` byłaby czwartym,
 * ręcznie synchronizowanym źródłem prawdy, które rozjeżdża się przy pierwszym
 * zapisie pominiętym w jednym miejscu (a wygaśnięcie i tak nie ma zapisu:
 * zachodzi samo, upływem czasu).
 *
 * Kolejność rozstrzygania jest istotna i jest tu jedynym miejscem, w którym
 * żyje: wykorzystane bije wszystko (członkostwo już powstało), potem decyzja
 * ownera (odwołane), a dopiero na końcu zegar. Odwołane zaproszenie po dacie
 * ważności ma pokazywać „odwołane" — bo tak brzmi powód, dla którego nie
 * zadziała.
 *
 * Przed L4 ekran liczył to jako `accepted_at ? accepted : pending`, czyli
 * WYGASŁE zaproszenie pokazywał jako oczekujące — operator widział „Oczekuje"
 * przy linku, który nikogo już nie wpuści.
 */
export type InvitationStatus = "accepted" | "revoked" | "expired" | "pending";

export interface InvitationLifecycleRow {
  accepted_at: string | null;
  revoked_at: string | null;
  expires_at: string;
}

export function invitationStatus(
  invitation: InvitationLifecycleRow,
  now: Date = new Date(),
): InvitationStatus {
  if (invitation.accepted_at) return "accepted";
  if (invitation.revoked_at) return "revoked";
  if (new Date(invitation.expires_at).getTime() <= now.getTime()) return "expired";
  return "pending";
}

/**
 * Czy zaproszenie da się jeszcze odwołać albo ponowić.
 *
 * Wykorzystanego nie odwołujemy (członkostwo już istnieje — to jest ścieżka
 * „usuń członka", nie „odwołaj zaproszenie"), odwołanego nie odwołujemy drugi
 * raz. WYGASŁE zostaje odwoływalne świadomie: token wygasły jest martwy dla
 * `app.accept_invitation`, ale odwołanie zamyka też ponowienie i zdejmuje
 * wiersz z listy spraw otwartych.
 */
export function invitationIsOpen(status: InvitationStatus): boolean {
  return status === "pending" || status === "expired";
}
