"use client";

import { useState } from "react";

import { TurnstileWidget } from "@/components/turnstile-widget";

/**
 * CAPTCHA FORMULARZA KONTAKTU (E4, ADR-095) — widget plus UKRYTE POLE z tokenem.
 *
 * ==================== PO CO POLE, SKORO JEST ZWROTKA ====================
 *
 * Formularz kontaktu mieszka w pakiecie UI (jeden render dla sklepu i dla
 * płótna kreatora), a widget — tutaj, bo to storefront zna klucz dostawcy.
 * Przez granicę serwer→klient wolno przenieść DANE i gotowe drzewo, ale nie
 * funkcję: zwrotka `onToken` nie miałaby jak dojechać do formularza.
 *
 * Token jedzie więc tak, jak jeździ każda inna wartość formularza — ukrytym
 * polem o znanej nazwie. Formularz czyta je razem z resztą (`FormData`) i nie
 * musi wiedzieć ani kto je wypełnił, ani czym.
 *
 * `value={token ?? ""}`: brak tokenu to pusty napis, nie brak pola. Serwer
 * odróżnia „CAPTCHA nierozwiązana" od „CAPTCHA wyłączona" po SWOJEJ
 * konfiguracji (sekret), a nie po tym, czego nie ma w żądaniu.
 */
export function ContactCaptchaField({
  siteKey,
  locale,
}: {
  siteKey: string;
  locale: "en" | "pl";
}) {
  const [token, setToken] = useState<string | null>(null);

  return (
    /*
      `contents` (S-33): ta owijka niesie POLE z tokenem, nie układ — pudełkiem
      w kolumnie formularza jest wyłącznie kontener widgetu, który sam chowa
      się, dopóki dostawca niczego nie pokazuje. Owijka-pudełko robiła z
      `gap-4` formularza podwójny odstęp i ~72 px dziury przy trybie
      niewidzialnym.
    */
    <div data-contact-captcha className="contents">
      <TurnstileWidget siteKey={siteKey} locale={locale} onToken={setToken} />
      <input type="hidden" name="captchaToken" value={token ?? ""} readOnly />
    </div>
  );
}
