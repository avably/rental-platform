"use server";

/**
 * Server Action formularza kontaktu (E4, ADR-095) — jedyne publiczne wejście
 * wysyłki wiadomości ze strony najemcy.
 *
 * Plik jest CIENKI z rozmysłu (wzorzec lib/actions/checkout.ts): dostarcza
 * rdzeniowi (lib/contact/core.ts) to, czego ten nie umie zdobyć bez Next.js
 * i bez sieci — tenant_id z nagłówka, IP, odczyt opublikowanej strony,
 * weryfikację biletu i CAPTCHY, limit zgłoszeń oraz tor poczty. Cała
 * kolejność bramek siedzi w rdzeniu, testowalnym bez `next/headers`.
 *
 * SEKRET CAPTCHY ŻYJE WYŁĄCZNIE TUTAJ, po stronie storefrontu. Panel go NIE
 * dostaje i dostać nie może: widget nie renderuje się na jego ekranach, więc
 * fail-closed zamieniłby brak tokenu w zamknięte drzwi do panelu.
 */
import { headers } from "next/headers";

import { emailAvailability, resendTransport } from "@avably/core";
import type { ContactSubmitInput, ContactSubmitResult } from "@avably/core/site";
import {
  STOREFRONT_PUBLIC_RATE_LIMIT_PREFIX,
  checkRateLimit,
} from "@avably/security/rate-limit";
import { verifyTurnstile } from "@avably/security/turnstile";

import { submitContactCore } from "@/lib/contact/core";
import { sendContactMessage } from "@/lib/contact/emails";
import { contactSectionOf } from "@/lib/contact/section";
import { verifyContactTicket } from "@/lib/contact/ticket";
import { getPublishedSite } from "@/lib/site/published";
import { getPublicCatalog } from "@/lib/checkout/catalog";
import { TENANT_ID_HEADER } from "@/lib/tenant/headers";

export async function submitContactMessage(
  input: ContactSubmitInput,
): Promise<ContactSubmitResult> {
  const h = await headers();

  // tenant_id WYŁĄCZNIE z nagłówka ustawionego server-side przez middleware
  // (anty-spoofing, ADR-039) — nigdy z klienta. Brak = żądanie spoza gałęzi
  // tenanckiej; nie ma sklepu, z którego ta wiadomość mogłaby przyjść.
  const tenantId = h.get(TENANT_ID_HEADER);
  if (!tenantId) return { status: "server_error" };

  const ip = h.get("x-forwarded-for") ?? "unknown";

  return submitContactCore(input, {
    ip,
    checkRateLimit: (key, opts) =>
      checkRateLimit(key, { ...opts, prefix: STOREFRONT_PUBLIC_RATE_LIMIT_PREFIX }),
    verifyTicket: (ticket) => verifyContactTicket(ticket),
    verifyCaptcha: (token) => verifyTurnstile(token),
    loadSection: async (sectionId) => contactSectionOf(await getPublishedSite(tenantId), sectionId),
    send: async (message) => {
      // Nazwa i język NAJEMCY z publicznego katalogu — tego samego odczytu,
      // z którego bierze je render sklepu. Brak katalogu (tenant nieaktywny)
      // znaczy, że nie ma komu tej wiadomości przeczytać.
      const catalog = await getPublicCatalog(tenantId);
      if (!catalog) return { delivered: false };
      return sendContactMessage(message, {
        transport: resendTransport(),
        availability: emailAvailability(),
        tenantName: catalog.tenant.name,
        locale: catalog.tenant.locale,
      });
    },
  });
}
