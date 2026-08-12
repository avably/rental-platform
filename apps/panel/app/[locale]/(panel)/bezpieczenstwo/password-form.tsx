"use client";

import { Button, Input, Label } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { ScreenSection } from "@/components/screens/screen-header";
import type { FormState } from "@/lib/form-state";

import { changePasswordAction, signOutOtherDevicesAction } from "./password-actions";

const initialState: FormState = {};

/**
 * Jedna linia komunikatu na formularz — kolejność jak w reszcie ekranów
 * drugorzędnych (błąd formularza → błąd pola → komunikat neutralny →
 * sukces). Karta zmiany hasła NIE dostaje chipu stanu: „hasło zmienione" to
 * zdarzenie, a chip opisuje STAN, który trwa.
 */
function FormMessages({ state }: { state: FormState }) {
  const message = state.formError ?? (state.fieldErrors ? Object.values(state.fieldErrors)[0] : undefined);
  if (message) {
    return (
      <p role="alert" data-form-message="error" className="text-destructive text-sm">
        {message}
      </p>
    );
  }
  if (state.notice) {
    return (
      <p role="status" data-form-message="notice" className="text-muted-foreground text-sm">
        {state.notice}
      </p>
    );
  }
  if (state.success) {
    return (
      <p role="status" data-form-message="success" className="text-status-positive-fg text-sm">
        {state.success}
      </p>
    );
  }
  return null;
}

/**
 * Zmiana hasła ze znajomości OBECNEGO hasła (U11a, ADR-144).
 *
 * `autoComplete` jest tu funkcją, nie ozdobą: bez `current-password` /
 * `new-password` menedżer haseł nie rozpozna formularza i albo nie podpowie
 * hasła, albo nie zaproponuje zapisania nowego — czyli operator zmieni hasło
 * i zostanie z nieaktualnym w menedżerze.
 *
 * Szew testowy `initialState` jak w formularzu 2FA: `useActionState` oddaje
 * przy renderze serwerowym WYŁĄCZNIE stan początkowy, więc inaczej nie da się
 * obejrzeć w kontrakcie renderu ani sukcesu, ani błędu. W produkcie pusty.
 */
export function ChangePasswordForm({
  initialState: initial = initialState,
}: {
  initialState?: FormState;
}) {
  const t = useTranslations("security");
  const [state, formAction, pending] = useActionState(changePasswordAction, initial);

  return (
    <ScreenSection
      data-password-change
      title={t("passwordTitle")}
      description={t("passwordBody")}
    >
      <form action={formAction} className="flex flex-col gap-2 text-sm">
        <Label htmlFor="current-password">{t("currentPasswordLabel")}</Label>
        <Input
          id="current-password"
          name="currentPassword"
          type="password"
          required
          autoComplete="current-password"
          disabled={pending}
        />

        <Label htmlFor="new-password">{t("newPasswordLabel")}</Label>
        <Input
          id="new-password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          aria-describedby="new-password-rule"
          disabled={pending}
        />
        {/* Wymaganie CZYTAMY z jednego miejsca (schemat hasła), nie budujemy
            drugiego zestawu reguł obok polityki dostawcy — patrz ADR-144. */}
        <p id="new-password-rule" className="text-muted-foreground">
          {t("passwordRule")}
        </p>

        <Label htmlFor="new-password-confirm">{t("confirmPasswordLabel")}</Label>
        <Input
          id="new-password-confirm"
          name="passwordConfirm"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          disabled={pending}
        />

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button type="submit" loading={pending} disabled={pending}>
            {t("passwordSubmit")}
          </Button>
          <FormMessages state={state} />
        </div>
      </form>
    </ScreenSection>
  );
}

/**
 * „Wyloguj mnie ze wszystkich urządzeń" — zamiast LISTY aktywnych sesji.
 *
 * Listy sesji nie da się dziś zbudować bez migracji: `@supabase/auth-js` nie
 * ma `listSessions` (ani w kliencie, ani w admin API), a schemat `auth` nie
 * jest wystawiony przez PostgREST, więc `auth.sessions` jest nieosiągalna
 * nawet kluczem sekretnym. Jeden przycisk daje operatorowi tę samą wartość
 * („odetnij to, czego nie rozpoznaję") bez ani jednej linii SQL — patrz
 * ADR-144.
 */
export function SignOutOtherDevicesForm({
  initialState: initial = initialState,
}: {
  initialState?: FormState;
}) {
  const t = useTranslations("security");
  const [state, formAction, pending] = useActionState(signOutOtherDevicesAction, initial);

  return (
    <ScreenSection data-session-revoke title={t("revokeTitle")} description={t("revokeBody")}>
      <form action={formAction} className="flex flex-col gap-2 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="outline" loading={pending} disabled={pending}>
            {t("revokeSubmit")}
          </Button>
          <FormMessages state={state} />
        </div>
      </form>
    </ScreenSection>
  );
}
