"use client";

/**
 * Akcje wierszy ekranu „Zespół i zaproszenia" (L4, ADR-105): usunięcie członka,
 * odwołanie i ponowienie zaproszenia.
 *
 * Każdy przycisk ma WŁASNY formularz i własny `useActionState`, więc komunikat
 * ląduje przy wierszu, którego dotyczy — jeden wspólny stan na tabelę kazałby
 * operatorowi zgadywać, czyje zaproszenie właśnie odwołał.
 *
 * Wysyłamy wyłącznie identyfikator wiersza. Tenant bierze się z JWT po stronie
 * serwera i nie ma go w żadnym polu formularza — nie ma czego podmienić.
 */
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { ConfirmSubmit } from "@/components/forms/confirm-submit";

import type { InviteMemberState } from "./actions";
import type { TeamMemberState } from "./team-actions";

const initialInvitationState: InviteMemberState = {};
const initialMemberState: TeamMemberState = {};

type InvitationAction = (
  prevState: InviteMemberState,
  formData: FormData,
) => Promise<InviteMemberState>;

type MemberAction = (prevState: TeamMemberState, formData: FormData) => Promise<TeamMemberState>;

function Messages({ state }: { state: { error?: string; success?: string } }) {
  if (state.error) {
    return (
      <p role="alert" className="text-destructive text-xs">
        {state.error}
      </p>
    );
  }
  if (state.success) {
    return (
      <p role="status" className="text-status-positive-fg text-xs">
        {state.success}
      </p>
    );
  }
  return null;
}

/**
 * Usunięcie osoby z zespołu. Guard ostatniego właściciela siedzi w bazie
 * (trigger 0051), więc przycisk NIE jest ukrywany „dla bezpieczeństwa" — przy
 * ostatnim właścicielu akcja wraca z czytelnym powodem odmowy. Ukrycie
 * przycisku byłoby tu gorsze: sugerowałoby, że operacji nie ma, zamiast
 * powiedzieć, dlaczego jej nie wolno.
 */
export function RemoveMemberButton({
  userId,
  email,
  isSelf,
  action,
}: {
  userId: string;
  email: string | null;
  isSelf: boolean;
  action: MemberAction;
}) {
  const t = useTranslations("invitations.team");
  const [state, formAction, pending] = useActionState(action, initialMemberState);

  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="userId" value={userId} />
      <ConfirmSubmit
        marker={`remove-member-${userId}`}
        pending={pending}
        label={isSelf ? t("leaveCta") : t("removeCta")}
        question={
          isSelf
            ? t("leaveQuestion")
            : t("removeQuestion", { subject: email ?? t("unknownEmail") })
        }
        confirmLabel={isSelf ? t("leaveConfirm") : t("removeConfirm")}
        cancelLabel={t("cancelConfirm")}
      />
      <Messages state={state} />
    </form>
  );
}

/** Odwołanie zaproszenia — link przestaje wpuszczać (0051: RPC akceptu odmawia). */
export function RevokeInvitationButton({
  invitationId,
  email,
  action,
}: {
  invitationId: string;
  email: string;
  action: InvitationAction;
}) {
  const t = useTranslations("invitations.lifecycle");
  const [state, formAction, pending] = useActionState(action, initialInvitationState);

  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="invitationId" value={invitationId} />
      <ConfirmSubmit
        marker={`revoke-invitation-${invitationId}`}
        pending={pending}
        label={t("revokeCta")}
        question={t("revokeQuestion", { subject: email })}
        confirmLabel={t("revokeConfirm")}
        cancelLabel={t("cancelConfirm")}
      />
      <Messages state={state} />
    </form>
  );
}

/**
 * Ponowienie zaproszenia. Bez kroku potwierdzenia — operacja jest odwracalna
 * (można ponowić znowu), a jedynym skutkiem ubocznym jest unieważnienie
 * poprzedniego linku, o czym mówi podpis przycisku.
 */
export function ResendInvitationButton({
  invitationId,
  action,
}: {
  invitationId: string;
  action: InvitationAction;
}) {
  const t = useTranslations("invitations.lifecycle");
  const [state, formAction, pending] = useActionState(action, initialInvitationState);

  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="invitationId" value={invitationId} />
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        data-resend-invitation={invitationId}
        className="text-sm underline underline-offset-2 disabled:opacity-50"
      >
        {pending ? t("resendPending") : t("resendCta")}
      </button>
      <p className="text-muted-foreground text-xs">{t("resendHint")}</p>
      <Messages state={state} />
    </form>
  );
}
