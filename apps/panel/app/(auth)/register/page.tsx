import { safeNextPath } from "@/lib/validation";

import { RegisterForm } from "./form";

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const safeNext = safeNextPath(next) ?? undefined;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-xl font-semibold">Załóż konto</h1>
      <RegisterForm next={safeNext} />
    </main>
  );
}
