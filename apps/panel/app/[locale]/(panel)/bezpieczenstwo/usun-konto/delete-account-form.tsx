"use client";

import { Button, Input, Label } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";

import { ScreenSection } from "@/components/screens/screen-header";
import type { FormState } from "@/lib/form-state";

const initialState: FormState = {};

/**
 * Potwierdzenie żądania usunięcia konta.
 *
 * NIEODWRACALNOŚĆ = potwierdzenie nie jest przyciskiem „OK": operator PRZEPISUJE
 * adres swojego konta (wzorzec `customer-erasure`). Serwer i tak porównuje wpis
 * z adresem z sesji — pole niesie intencję, nie prawdę.
 *
 * Akcja przychodzi PROPEM z serwera (jak w `customer-erasure`) — komponent nie
 * importuje modułu "use server", więc nie wciąga go do bundla klienta. Sukces
 * zamienia kartę w potwierdzenie „zgłoszenie przyjęte": to ZDARZENIE, nie stan
 * do edycji, więc formularz znika.
 *
 * `initialState` to szew testowy jak w formularzach 2FA/hasła: `useActionState`
 * oddaje przy renderze serwerowym wyłącznie stan początkowy. W produkcie pusty.
 */
export function DeleteAccountForm({
  email,
  action,
  initialState: initial = initialState,
}: {
  email: string;
  action: (prevState: FormState, formData: FormData) => Promise<FormState>;
  initialState?: FormState;
}) {
  const t = useTranslations("security");
  const [typed, setTyped] = useState("");
  const [state, formAction, pending] = useActionState(action, initial);

  const confirmationError = state.fieldErrors?.confirmation;

  if (state.success) {
    return (
      <ScreenSection
        data-account-delete-done
        title={t("deleteRequestDoneTitle")}
        description={state.success}
      />
    );
  }

  return (
    <ScreenSection
      data-account-delete
      title={t("deleteConfirmTitle")}
      description={t("deleteConfirmBody")}
    >
      <form action={formAction} className="flex flex-col gap-2 text-sm">
        <Label htmlFor="account-delete-confirmation">{t("deleteConfirmLabel", { email })}</Label>
        <Input
          id="account-delete-confirmation"
          name="confirmation"
          data-account-delete-input
          autoComplete="off"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          aria-invalid={confirmationError ? true : undefined}
          aria-describedby={confirmationError ? "account-delete-error" : undefined}
          disabled={pending}
        />
        {confirmationError ? (
          <p id="account-delete-error" role="alert" className="text-destructive text-sm">
            {confirmationError}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button
            type="submit"
            variant="destructive"
            loading={pending}
            disabled={pending || typed.trim().length === 0}
          >
            {t("deleteConfirmCta")}
          </Button>
          {state.formError ? (
            <p role="alert" className="text-destructive text-sm">
              {state.formError}
            </p>
          ) : null}
        </div>
      </form>
    </ScreenSection>
  );
}
