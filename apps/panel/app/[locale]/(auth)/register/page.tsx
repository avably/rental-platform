import { getTranslations } from "next-intl/server";

import { safeNextPath } from "@/lib/validation";

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
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      <RegisterForm next={safeNext} />
    </main>
  );
}
