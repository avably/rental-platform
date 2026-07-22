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
import { localePath } from "@/lib/navigation";
import { SecondaryStatusChip } from "@/lib/secondary-status";
import { requireMember } from "@/lib/supabase-server";

import { InviteMemberForm } from "./form";

/**
 * Zespół i zaproszenia (mockup P8: `secondary-team`).
 *
 * Układ jest dwuczęściowy i celowo NIE ma jednej szerokości: formularz
 * zaproszenia to dwa pola i idzie w miarę formularza, a historia zaproszeń to
 * dane operacyjne (rola, dwie daty, status) i zostaje na pełnej szerokości
 * kontenera. Lista pisana wcześniej jako `email · rola · status` w jednym
 * wierszu gubiła daty — a wygasające zaproszenie bez daty wygaśnięcia jest
 * informacją bezużyteczną.
 */
export default async function InvitationsPage() {
  let ctx;
  try {
    ctx = await requireMember("owner");
  } catch (err) {
    if (err instanceof AuthError) redirect(await localePath(err.status === 401 ? "/login" : "/"));
    throw err;
  }

  const { data: invitations } = await ctx.supabase
    .from("invitations")
    .select("id, email, role, accepted_at, expires_at, created_at")
    .eq("tenant_id", ctx.tenantId)
    .order("created_at", { ascending: false });

  const t = await getTranslations("invitations");
  const locale = await getLocale();
  const formatDate = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Warsaw",
  });

  const rows = invitations ?? [];

  return (
    <div className="flex flex-col gap-6">
      <FormMeasure className="flex flex-col gap-4">
        <InviteMemberForm emailUnavailableReason={emailAvailability().reason} />
      </FormMeasure>

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
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((invitation) => (
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
                    <SecondaryStatusChip
                      axis="invitation"
                      value={invitation.accepted_at ? "accepted" : "pending"}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
