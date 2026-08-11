"use client";

/**
 * Cichy zegar ekranu oczekiwania na płatność (F1, ADR-137) — całe wiązanie
 * z Reactem to jeden `useEffect`; reguła (interwał, limit prób, sprzątanie)
 * mieszka w lib/checkout/status-refresh.ts i tam ma test.
 *
 * KIEDY ZNIKA: renderuje go wyłącznie stan `checking` strony statusu, więc
 * pierwsze odświeżenie, które zastanie `paid`/`payment_failed`, wyrenderuje
 * stronę już BEZ tego komponentu — interwał sprząta unmount.
 */
import { useEffect } from "react";

import { useRouter } from "next/navigation";

import { startPaymentStatusRefresh } from "@/lib/checkout/status-refresh";

export function PaymentStatusRefresh() {
  const router = useRouter();

  useEffect(() => startPaymentStatusRefresh(() => router.refresh()), [router]);

  return null;
}
