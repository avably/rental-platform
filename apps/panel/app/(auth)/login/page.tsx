import { safeNextPath } from "@/lib/validation";

import { LoginForm } from "./form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const safeNext = safeNextPath(next) ?? undefined;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-xl font-semibold">Zaloguj się</h1>
      <LoginForm next={safeNext} />
    </main>
  );
}
