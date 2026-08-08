import { emailAvailability } from "@avably/core";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@avably/ui";
import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { FormMeasure } from "@/components/screens/form-measure";
import { AuthError } from "@/lib/auth";
import { invitationIsOpen, invitationStatus } from "@/lib/invitations";
import { localePath } from "@/lib/navigation";
import { SecondaryStatusChip } from "@/lib/secondary-status";
import { requireMember } from "@/lib/supabase-server";

import { resendInvitationAction, revokeInvitationAction } from "./actions";
import { InviteMemberForm } from "./form";
import {
  RemoveMemberButton,
  ResendInvitationButton,
  RevokeInvitationButton,
} from "./row-forms";
import { removeMemberAction } from "./team-actions";
import { loadTeamMembers } from "./team";

/**
 * Zespół i zaproszenia (mockup P8: `secondary-team`).
 *
 * Układ jest dwuczęściowy i celowo NIE ma jednej szerokości: formularz
 * zaproszenia to dwa pola i idzie w miarę formularza, a historia zaproszeń to
 * dane operacyjne (rola, dwie daty, status) i zostaje na pełnej szerokości
 * kontenera. Lista pisana wcześniej jako `email · rola · status` w jednym
 * wierszu gubiła daty — a wygasające zaproszenie bez daty wygaśnięcia jest
 * informacją bezużyteczną.
 *
 * L4 (ADR-105) dokłada tu sekcję ZESPOŁU zamiast osobnego ekranu: pozycja
 * nawigacji „Zespół" już celowała w tę trasę, a lista członków i lista
 * zaproszeń to dwa etapy jednej sprawy (kto ma dostęp i kto go dopiero
 * dostanie) — rozbite na dwa ekrany kazałyby operatora przełączać, żeby
 * odpowiedzieć na jedno pytanie.
 */
export default async function InvitationsPage() {
  let ctx;
  try {
    ctx = await requireMember("owner");
  } catch (err) {
    if (err instanceof AuthError) redirect(await localePath(err.status === 401 ? "/login" : "/"));
    throw err;
  }

  const [{ data: invitations }, members] = await Promise.all([
    ctx.supabase
      .from("invitations")
      .select("id, email, role, accepted_at, revoked_at, expires_at, created_at")
      .eq("tenant_id", ctx.tenantId)
      .order("created_at", { ascending: false }),
    loadTeamMembers(ctx),
  ]);

  const t = await getTranslations("invitations");
  const locale = await getLocale();
  const formatDate = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Warsaw",
  });

  const rows = invitations ?? [];
  // Jeden znacznik czasu na cały render: gdyby każdy wiersz liczył „teraz"
  // osobno, dwa zaproszenia wygasające w tej samej sekundzie mogłyby pokazać
  // różne statusy w jednej tabeli.
  const now = new Date();

  return (
    <div className="flex flex-col gap-6">
      <FormMeasure className="flex flex-col gap-4">
        <InviteMemberForm emailUnavailableReason={emailAvailability().reason} />
      </FormMeasure>

      <section data-team-list className="flex flex-col gap-3">
        <h2 className="text-xl leading-[26px] font-semibold tracking-[-0.01em]">
          {t("team.heading")}
        </h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columnEmail")}</TableHead>
              <TableHead>{t("columnRole")}</TableHead>
              <TableHead>{t("team.columnJoinedAt")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => (
              <TableRow key={member.userId}>
                <TableCell className="break-all">
                  {member.email ?? t("team.unknownEmail")}
                  {member.userId === ctx.user.id ? (
                    <span className="text-muted-foreground ml-2 text-xs">{t("team.you")}</span>
                  ) : null}
                </TableCell>
                <TableCell>{member.role === "owner" ? t("roleOwner") : t("roleStaff")}</TableCell>
                <TableCell className="tabular-nums whitespace-nowrap">
                  {formatDate.format(new Date(member.createdAt))}
                </TableCell>
                <TableCell>
                  <RemoveMemberButton
                    userId={member.userId}
                    email={member.email}
                    isSelf={member.userId === ctx.user.id}
                    action={removeMemberAction}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <section data-invitations-list className="flex flex-col gap-3">
        <h2 className="text-xl leading-[26px] font-semibold tracking-[-0.01em]">
          {t("sentHeading")}
        </h2>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("empty")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columnEmail")}</TableHead>
                <TableHead>{t("columnRole")}</TableHead>
                <TableHead>{t("columnCreatedAt")}</TableHead>
                <TableHead>{t("columnExpiresAt")}</TableHead>
                <TableHead>{t("columnStatus")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((invitation) => {
                const status = invitationStatus(invitation, now);
                return (
                  <TableRow key={invitation.id}>
                    <TableCell className="break-all">{invitation.email}</TableCell>
                    <TableCell>
                      {invitation.role === "owner" ? t("roleOwner") : t("roleStaff")}
                    </TableCell>
                    <TableCell className="tabular-nums whitespace-nowrap">
                      {formatDate.format(new Date(invitation.created_at))}
                    </TableCell>
                    <TableCell className="tabular-nums whitespace-nowrap">
                      {formatDate.format(new Date(invitation.expires_at))}
                    </TableCell>
                    <TableCell>
                      <SecondaryStatusChip axis="invitation" value={status} />
                    </TableCell>
                    <TableCell>
                      {invitationIsOpen(status) ? (
                        <div className="flex flex-col gap-2">
                          <ResendInvitationButton
                            invitationId={invitation.id}
                            action={resendInvitationAction}
                          />
                          <RevokeInvitationButton
                            invitationId={invitation.id}
                            email={invitation.email}
                            action={revokeInvitationAction}
                          />
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
