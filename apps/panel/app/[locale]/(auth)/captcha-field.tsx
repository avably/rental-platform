"use client";

/**
 * Pole CAPTCHA formularzy auth (L2, ADR-106): widżet Turnstile + ukryty input
 * `turnstileToken`, który niesie token do akcji serwerowej przez FormData.
 *
 * SEMANTYKA WŁĄCZENIA (anty-lockout, ADR-032/106): bez
 * `NEXT_PUBLIC_TURNSTILE_SITE_KEY` komponent renderuje NIC — a serwerowa
 * weryfikacja bez `TURNSTILE_SECRET_KEY` przepuszcza (dev-skip). Oba klucze
 * ustawia właściciel PO wejściu tego kodu na prod; site key jest stałą
 * BUILD-TIME (odczyt musi być statyczny, patrz
 * scripts/audit-browser-env-inlining.sh — zmiana env bez przebudowy nic nie da).
 *
 * `resetSignal`: token siteverify jest JEDNORAZOWY — każda odpowiedź akcji
 * (nowa tożsamość obiektu stanu z useActionState) unieważnia poprzedni token,
 * więc widżet jest remountowany (key) i wystawia świeże wyzwanie. Wzorzec:
 * waitlist-form storefrontu (captchaEpoch).
 */
import { useLocale } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { TurnstileWidget } from "@/components/turnstile-widget";

export function AuthCaptchaField({ resetSignal }: { resetSignal: unknown }) {
  // Odczyt STATYCZNY — Turbopack wmurowuje wartość w bundel kliencki.
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const locale = useLocale() === "pl" ? "pl" : "en";
  const [token, setToken] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  const mountedRef = useRef(false);

  useEffect(() => {
    // Pierwszy render nie jest odpowiedzią akcji — nie zużywa tokenu.
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    setToken(null);
    setEpoch((current) => current + 1);
  }, [resetSignal]);

  if (!siteKey) return null;

  return (
    <>
      <TurnstileWidget key={epoch} locale={locale} onToken={setToken} siteKey={siteKey} />
      <input type="hidden" name="turnstileToken" value={token ?? ""} />
    </>
  );
}
