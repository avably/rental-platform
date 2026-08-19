import { ReviewOverlayGate } from "@avably/review/overlay";

/**
 * Powłoka grupy `(auth)` — istnieje WYŁĄCZNIE dla nakładki przeglądu
 * (ADR-206, wzorzec `(kreator)/layout.tsx`).
 *
 * Ekrany auth (logowanie, rejestracja, sprawdź-skrzynkę, reset) świadomie
 * nie mają wspólnej powłoki wizualnej — każdy składa się z `AuthShell`
 * u siebie — więc ten layout nie dokłada żadnego DOM-u poza `{children}`.
 * Jedyne zadanie: zamontować nakładkę komentowania tam, gdzie z definicji
 * NIKT nie jest zalogowany, a właściciel przechodzi proces rejestracji
 * ekran po ekranie. Bramka serwerowa to sam kill-switch `REVIEW_MODE=1`
 * (sesji superadmina tu nie ma i nie będzie); kliencki `?review=1` domyka
 * resztę wewnątrz bramki — zwykłe wejście nie dokleja ani DOM, ani bundla.
 *
 * `surface="panel"` — lista ekranów przeglądu już klasyfikuje `/login`,
 * `/register` i `/register/sprawdz-skrzynke` jako pozycje 15–17 powierzchni
 * `panel` (packages/review/src/screens.ts).
 */
export default async function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      {children}
      {process.env.REVIEW_MODE === "1" ? <ReviewOverlayGate surface="panel" /> : null}
    </>
  );
}
