import { useTranslations } from "next-intl";

export default function CheckInboxPage() {
  const t = useTranslations("checkInbox");

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-3 p-6 text-center">
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      <p className="text-sm text-gray-600">{t("body")}</p>
    </main>
  );
}
