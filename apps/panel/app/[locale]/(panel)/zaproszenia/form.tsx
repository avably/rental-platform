"use client";

import { Button, Input, Label } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { PanelSelect } from "@/components/fields/panel-select";
import { ScreenSection } from "@/components/screens/screen-header";

import { inviteMemberAction, type InviteMemberState } from "./actions";

const initialState: InviteMemberState = {};

/**
 * Zaproszenie nowej osoby (mockup P8: krótki formularz NAD historią zespołu).
 *
 * Ostrzeżenie o niedostępnej wysyłce stoi PRZED formularzem, bo zmienia to,
 * czego operator ma się spodziewać po kliknięciu: zaproszenie i tak powstanie
 * (ADR-036 D1), ale link trzeba będzie przekazać ręcznie.
 */
export function InviteMemberForm({
  emailUnavailableReason,
}: {
  emailUnavailableReason?: string;
}) {
  const t = useTranslations("invitations");
  const [state, formAction, pending] = useActionState(inviteMemberAction, initialState);

  // Link ręczny przyjeżdża WEWNĄTRZ komunikatu akcji — to akcja decyduje, czy
  // e-mail wyszedł, i tylko ona zna adres akceptacji. Ekran go nie odtwarza
  // (token jest jednorazowy i nie wraca do widoku innym kanałem), więc rozpoznaje
  // wariant „przekaż ręcznie" po obecności adresu w komunikacie.
  const hasManualLink = Boolean(state.success?.includes("http"));

  return (
    <>
      {emailUnavailableReason ? (
        <ScreenSection
          data-email-warning
          description={`${t("emailUnavailable")} ${emailUnavailableReason} ${t("emailUnavailableConsequence")}`}
        />
      ) : null}

      <ScreenSection data-invitation-form title={t("formTitle")}>
        <form action={formAction} className="flex flex-col gap-2 text-sm">
          <Label htmlFor="invite-email">{t("emailLabel")}</Label>
          <Input id="invite-email" type="email" name="email" required disabled={pending} />

          <Label htmlFor="invite-role">{t("roleLabel")}</Label>
          <PanelSelect
            id="invite-role"
            name="role"
            defaultValue="staff"
            disabled={pending}
            options={[
              { value: "staff", label: t("roleStaff") },
              { value: "owner", label: t("roleOwner") },
            ]}
          />

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Button type="submit" disabled={pending}>
              {pending ? t("submitPending") : t("submit")}
            </Button>
          </div>

          {state.error ? (
            <p role="alert" className="text-destructive">
              {state.error}
            </p>
          ) : null}
          {state.success ? (
            <p
              role="status"
              data-manual-invitation-link={hasManualLink ? "true" : undefined}
              className={
                hasManualLink ? "text-status-attention-fg break-all" : "text-status-positive-fg"
              }
            >
              {state.success}
            </p>
          ) : null}
        </form>
      </ScreenSection>
    </>
  );
}
