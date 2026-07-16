import { getTranslations } from "next-intl/server";

import { safeNextPath } from "@/lib/validation";

import { LoginForm } from "./form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const safeNext = safeNextPath(next) ?? undefined;
  const t = await getTranslations("login");

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      <LoginForm next={safeNext} />
    </main>
  );
}
