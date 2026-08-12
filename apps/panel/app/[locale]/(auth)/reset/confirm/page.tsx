import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { getAuthContext, hasRecentRecoveryProof } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";

import { ResetConfirmForm } from "./form";

/**
 * Ustawienie nowego hasła — SPRAWDZENIE PRZED RENDEREM (ADR-153, N7).
 *
 * Do tej naprawy ekran był komponentem klienckim i rysował formularz ZAWSZE:
 * także wtedy, gdy sesji recovery nie było wcale albo link był zużyty.
 * Człowiek wymyślał hasło, wpisywał je, klikał — i dopiero wtedy dostawał
 * odmowę. Ślepy zaułek, w dodatku bez odnośnika, którym można by z niego
 * wyjść: `/reset` i `/reset/confirm` nie miały w całym panelu ANI JEDNEGO
 * linku prowadzącego do nich.
 *
 * BRAMKA JEST TA SAMA CO W AKCJI (R14/M-01, ADR-122) — claim `amr` ze
 * ZWERYFIKOWANEGO JWT. Ten render niczego nie ZASTĘPUJE: akcja dalej sprawdza
 * dowód przy każdym wywołaniu (sesja może wygasnąć między renderem a wysyłką,
 * a akcję da się wywołać z pominięciem tej strony). Tu domykamy WYŁĄCZNIE
 * moment, w którym o odmowie się dowiadujesz — przed pracą, nie po niej.
 *
 * ODMOWA JEDNOLITA zostaje: „brak sesji" i „sesja bez dowodu recovery"
 * dostają identyczny ekran, więc bramki nie widać z zewnątrz. Ekran nie
 * ujawnia też, czy w ogóle jesteś zalogowany.
 *
 * `force-dynamic`: layout `[locale]` ma `generateStaticParams`, a treść
 * zależy od cookies sesji — bez pinu Next wciągnąłby trasę w statyczny
 * prerender, a CSP z nonce per żądanie odcięłaby skrypty i formularz nie
 * zhydratowałby się BEZ ŻADNEGO błędu w konsoli (ADR-083).
 */
export const dynamic = "force-dynamic";

export default async function ResetConfirmPage() {
  const supabase = await createSupabaseServerClient();
  const ctx = await getAuthContext(supabase);
  const recoveryProven = Boolean(ctx) && hasRecentRecoveryProof(ctx!.amr);

  const t = await getTranslations("resetConfirm");

  if (!recoveryProven) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
        <h1 className="text-xl font-semibold">{t("expiredTitle")}</h1>
        <p role="alert" data-reset-confirm-blocked className="text-muted-foreground text-sm">
          {t("expiredBody")}
        </p>
        <p className="text-sm">
          <Link href="/reset" className="underline">
            {t("requestNewLink")}
          </Link>
        </p>
        <p className="text-sm">
          <Link href="/login" className="underline">
            {t("backToLogin")}
          </Link>
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      <ResetConfirmForm />
    </main>
  );
}
