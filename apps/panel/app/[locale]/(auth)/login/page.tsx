import { getTranslations } from "next-intl/server";

import { loginNotice } from "@/lib/auth-notice";
import { safeNextPath } from "@/lib/validation";

import { LoginForm } from "./form";

/**
 * Ekran logowania.
 *
 * KOMUNIKAT POWROTU (ADR-153, N2) renderuje się TUTAJ, a nie w formularzu:
 * jego źródłem jest adres strony, nie odpowiedź akcji. Dzięki temu widać go
 * od pierwszego malowania — także zanim formularz się zhydratuje — a stan
 * `useActionState` (błąd logowania) zostaje osobnym, niezależnym kanałem.
 *
 * Na ekran trafia WYŁĄCZNIE tekst z allowlisty `loginNotice` — nigdy wartość
 * parametru. Parametr przychodzi z linku, który może podesłać ktokolwiek.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string | string[]; reset?: string | string[] }>;
}) {
  const { next, error, reset } = await searchParams;
  const safeNext = safeNextPath(next) ?? undefined;
  const t = await getTranslations("login");
  const tRoot = await getTranslations();

  const notice = loginNotice({ error, reset });

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      {notice ? (
        <p
          data-login-notice={notice.tone}
          // `alert` przerywa czytnikowi bieżącą wypowiedź (coś poszło nie
          // tak), `status` czeka na przerwę (potwierdzenie). Rozróżnienie
          // jest tu istotne: oba komunikaty pojawiają się od razu po wejściu.
          role={notice.tone === "error" ? "alert" : "status"}
          className={
            notice.tone === "error"
              ? "text-destructive text-sm"
              : "text-status-positive-fg text-sm"
          }
        >
          {tRoot(notice.messageKey)}
        </p>
      ) : null}
      <LoginForm next={safeNext} />
    </main>
  );
}
