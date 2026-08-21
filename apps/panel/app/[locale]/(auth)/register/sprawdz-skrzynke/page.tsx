import { ChevronDown } from "lucide-react";
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
          ten miał konto, którego nie da się potwierdzić (L4, ADR-105).
          A7 (ADR-226): schowane pod rozwijaczem i DOMYŚLNIE ZWINIĘTE, żeby pole
          e-mail nie kusiło do wpisania adresu ZAMIAST sprawdzenia skrzynki.
          Natywny <details>: działa bez JS i bez hydracji, <summary> jest
          fokusowalny i ogłaszany czytnikowi jako przełącznik rozwijania. */}
      <details className="group border-border/55 rounded-md border">
        <summary className="text-foreground focus-visible:outline-accent dark:focus-visible:outline-ring flex cursor-pointer list-none items-center justify-between gap-2 rounded-md px-3.5 py-3 text-sm font-medium outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden">
          {t("resendToggle")}
          <ChevronDown
            aria-hidden="true"
            className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-180"
          />
        </summary>
        <div className="flex flex-col gap-4 px-3.5 pt-1 pb-3.5">
          <p className="text-muted-foreground text-sm">{t("resendIntro")}</p>
          <ResendConfirmationForm />
        </div>
      </details>
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
