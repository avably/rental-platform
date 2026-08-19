import { getTranslations } from "next-intl/server";

import { loginNotice } from "@/lib/auth-notice";
import { safeNextPath } from "@/lib/validation";

import { AuthShell } from "../auth-shell";
import { AuthHeading, AuthNotice } from "../auth-ui";
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
 *
 * Restyling (ADR-156) nie rusza ani jednego z tych rozstrzygnięć: zmienia się
 * pudełko, w którym komunikat stoi, i nic poza nim.
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
    <AuthShell band="signin">
      {/* Bez podtytułu — dopisek pod „Zaloguj się" zdjęty na uwagę
          właściciela (ADR-208). */}
      <AuthHeading>{t("title")}</AuthHeading>
      {notice ? (
        <AuthNotice
          data-login-notice={notice.tone}
          tone={notice.tone === "error" ? "attention" : "positive"}
          // `alert` przerywa czytnikowi bieżącą wypowiedź (coś poszło nie
          // tak), `status` czeka na przerwę (potwierdzenie). Rozróżnienie
          // jest tu istotne: oba komunikaty pojawiają się od razu po wejściu.
          role={notice.tone === "error" ? "alert" : "status"}
        >
          {tRoot(notice.messageKey)}
        </AuthNotice>
      ) : null}
      <LoginForm next={safeNext} />
    </AuthShell>
  );
}
