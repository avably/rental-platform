import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";

import { AuthShell } from "../../auth-shell";
import { AuthHeading } from "../../auth-ui";
import { ResendConfirmationForm } from "./form";

export default function CheckInboxPage() {
  const t = useTranslations("checkInbox");

  return (
    <AuthShell band="signup">
      <AuthHeading>{t("title")}</AuthHeading>
      <p className="text-[0.9375rem] leading-[22px]">{t("body")}</p>
      {/*
        JEDEN fakt, nie dwa (ADR-208): informacja o jednorazowości linku
        zeszła na uwagę właściciela. Fakt o spamie zostaje — jest prawdziwy
        niezależnie od konfiguracji wysyłki, więc może stać na ekranie jako
        pewnik. Adresu nadawcy tu świadomie NIE ma, bo bywa nadpisany zmienną
        środowiskową i ekran mówiłby nieprawdę.
      */}
      <ul className="border-border flex flex-col gap-2.5 rounded-md border p-3.5">
        <li className="flex flex-col gap-0.5 text-[0.8125rem] leading-[18px]">
          <span className="text-muted-foreground">{t("factMissingLabel")}</span>
          <span className="font-medium">{t("factMissingValue")}</span>
        </li>
      </ul>
      <hr className="border-border/55" />
      {/* Wyjście ze ślepego zaułka: bez tego formularza kto zgubił wiadomość,
          ten miał konto, którego nie da się potwierdzić (L4, ADR-105). */}
      <p className="text-muted-foreground text-sm">{t("resendIntro")}</p>
      <ResendConfirmationForm />
      {/* Wyśrodkowane jak inne treści pod formularzem (ADR-208, uwaga B). */}
      <p className="text-center text-sm">
        <Link
          href="/login"
          className="text-foreground font-medium underline underline-offset-[3px]"
        >
          {t("backToLogin")}
        </Link>
      </p>
    </AuthShell>
  );
}
