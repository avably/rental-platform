import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";

export default function Home() {
  const t = useTranslations("home");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <nav className="flex flex-col items-center gap-2 text-sm">
        <Link className="underline" href="/katalog">
          {t("catalogLink")}
        </Link>
        <Link className="underline" href="/katalog/punkty-odbioru">
          {t("locationsLink")}
        </Link>
        <Link className="underline" href="/zaproszenia">
          {t("invitationsLink")}
        </Link>
      </nav>
    </div>
  );
}
