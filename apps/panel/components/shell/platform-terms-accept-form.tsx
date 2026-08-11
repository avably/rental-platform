"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import {
  acceptPlatformTermsAction,
  type AcceptPlatformTermsState,
} from "@/lib/actions/platform-terms";

const initialState: AcceptPlatformTermsState = {};

/**
 * Formularz przesłony akceptacji (0070, ADR-141). Wersję wskazuje ukryte
 * pole z bramki layoutu — użytkownik akceptuje DOKŁADNIE to, co zobaczył;
 * ostatnie słowo i tak ma `app.accept_platform_terms` (wersja nie starsza
 * niż obowiązująca, żywy owner, idempotencja).
 */
export function PlatformTermsAcceptForm({
  versionId,
  versionLabel,
}: {
  versionId: string;
  versionLabel: string;
}) {
  const [state, formAction, pending] = useActionState(acceptPlatformTermsAction, initialState);
  const t = useTranslations("platformTerms");

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="versionId" value={versionId} />
      {state.error ? (
        <p className="text-sm text-destructive" data-platform-terms-error>
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        aria-busy={pending || undefined}
        disabled={pending}
        className="self-start rounded bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        data-platform-terms-accept
      >
        {pending ? t("acceptPending") : t("acceptCta", { version: versionLabel })}
      </button>
    </form>
  );
}
