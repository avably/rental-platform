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

  // `bandLegalLinks=false`: rejestracja niesie WŁASNĄ notę informacyjną
  // (art. 13 RODO) w kolumnie formularza — widoczną także na mobile, gdzie
  // stopka pasa (`hidden lg:flex`) znika. Duplikat w stopce zdjęty na uwagę
  // właściciela (ADR-208).
  return (
    <AuthShell band="signup" bandLegalLinks={false}>
      <AuthHeading subtitle={t("subtitle")}>{t("title")}</AuthHeading>
      <RegisterForm next={safeNext} />
      <AuthNarrowSignals />
    </AuthShell>
  );
}
