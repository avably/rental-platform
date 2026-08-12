import { getTranslations } from "next-intl/server";

import { safeNextPath } from "@/lib/validation";

import { AuthNarrowSignals, AuthShell } from "../auth-shell";
import { AuthHeading } from "../auth-ui";
import { RegisterForm } from "./form";

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const safeNext = safeNextPath(next) ?? undefined;
  const t = await getTranslations("register");

  return (
    <AuthShell band="signup">
      <AuthHeading subtitle={t("subtitle")}>{t("title")}</AuthHeading>
      <RegisterForm next={safeNext} />
      <AuthNarrowSignals />
    </AuthShell>
  );
}
