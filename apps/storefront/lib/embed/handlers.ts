/**
 * Rdzenie tras danych embedu (M3, ADR-120) — na portach, testowalne bez sieci
 * i bez bazy (wzorzec lib/api/handlers.ts z M1).
 *
 * WSPÓLNY PRZEDSIONEK, ta sama kolejność na każdej trasie:
 *   origin (same-origin) → tenant z nagłówka proxy → parametry → dławienie → praca
 *
 * Origin idzie PIERWSZY, bo jest darmowy (porównanie dwóch nagłówków) i dzięki
 * temu żądanie z obcej strony nie kosztuje ani zapytania do bazy, ani wpisu w
 * liczniku limitu. „Zero pracy" jest tu mierzone LICZNIKAMI w testach, nie
 * wnioskowane z kodu odpowiedzi — tak jak przy M1.
 */

import type { CustomFieldDefinition } from "@avably/core";

import { CHECKOUT_RATE_LIMIT, submitCheckoutCore, type CheckoutRpcArgs, type CheckoutRpcResult } from "@/lib/checkout/core";
import type { CheckoutTicket } from "@/lib/checkout/ticket";
import type { OnlinePaymentAvailability } from "@/lib/checkout/payment-options";
import { embedError, embedJson, type EmbedMonthPayload } from "./contract";
import { embedOriginAllowed } from "./origin";
import { coalesce, MONTH_CACHE_TTL_MS, MONTH_DEGRADED_CACHE_TTL_MS, monthCacheKey } from "./cache";
import { isValidMonth, resolveMonthDays, type AvailabilityProbe } from "./month";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Progi dławienia. Za jednym IP stoi POJEDYNCZY odwiedzający, więc miarą jest
 * realne przeglądanie kalendarza: nawigacja po horyzoncie miesięcy i zmiana
 * produktu. Wymiar tenanta stoi obok wymiaru IP i domyka drugą stronę — jeden
 * najemca nie może być zajeżdżany z rozproszonych adresów bez limitu.
 */
export const EMBED_MONTH_LIMIT_PER_IP = { limit: 60, windowSeconds: 300 };
export const EMBED_MONTH_LIMIT_PER_TENANT = { limit: 600, windowSeconds: 300 };
export const EMBED_RESERVATION_LIMIT_PER_IP = { limit: 10, windowSeconds: 3600 };

export type CheckRateLimitFn = (
  key: string,
  opts: { limit: number; windowSeconds: number },
) => Promise<{ success: boolean }>;

export interface EmbedDeps {
  /** Z nagłówka wstrzykniętego przez proxy PO anty-spoofingu. `null` = host nie jest sklepem. */
  tenantId: string | null;
  ip: string;
  checkRateLimit: CheckRateLimitFn;
  now: () => number;
}

export interface EmbedMonthDeps extends EmbedDeps {
  probeAvailability: (productId: string, startDate: string, endDate: string) => Promise<number | null>;
}

export interface EmbedReservationDeps extends EmbedDeps {
  callRpc: (args: CheckoutRpcArgs) => Promise<CheckoutRpcResult>;
  /**
   * Bilet zaufanej granicy (0059, ADR-125) — ten sam port co w sklepie i v1,
   * bo baza nie zna powierzchni, tylko ważność biletu. Embed nie ma captchy
   * (widget w cudzej ramce to wektor UX, nie bezpieczeństwa), więc bramką
   * poprzedzającą bilet jest tu przedsionek: sprawdzenie pochodzenia
   * i dławienie po IP odwiedzającego.
   */
  issueTicket: (tenantId: string) => CheckoutTicket;
  /**
   * Definicje pól własnych zamawiania (C6-A3, 0058). Embed jest TRZECIĄ
   * powierzchnią na tym samym rdzeniu, więc dostaje je tą samą drogą co sklep
   * i API v1 — inaczej najemca z polem WYMAGANYM miałby w ramce formularz,
   * którego serwer nigdy nie przyjmie.
   */
  readCustomFields: (tenantId: string) => Promise<CustomFieldDefinition[]>;
  sendEmails: (tenantId: string, ctx: CheckoutRpcResult) => Promise<string[]>;
  readOnlineAvailability: (tenantId: string) => Promise<OnlinePaymentAvailability>;
}

/** Przedsionek wspólny obu trasom. Zwraca `tenantId` albo gotową odmowę. */
function admitEmbedRequest(request: Request, deps: EmbedDeps): string | Response {
  if (!embedOriginAllowed(request)) return embedError(403, "forbidden_origin");
  if (deps.tenantId === null) return embedError(403, "store_unavailable");
  return deps.tenantId;
}

export async function handleEmbedMonthRequest(
  request: Request,
  deps: EmbedMonthDeps,
): Promise<Response> {
  const admitted = admitEmbedRequest(request, deps);
  if (typeof admitted !== "string") return admitted;
  const tenantId = admitted;

  const url = new URL(request.url);
  const productId = url.searchParams.get("product") ?? "";
  const month = url.searchParams.get("month") ?? "";
  if (!UUID_PATTERN.test(productId) || !isValidMonth(month)) {
    return embedError(400, "validation_failed");
  }

  const perIp = await deps.checkRateLimit(`embed:month:ip:${deps.ip}`, EMBED_MONTH_LIMIT_PER_IP);
  if (!perIp.success) return embedError(429, "rate_limited");
  const perTenant = await deps.checkRateLimit(
    `embed:month:tenant:${tenantId}`,
    EMBED_MONTH_LIMIT_PER_TENANT,
  );
  if (!perTenant.success) return embedError(429, "rate_limited");

  const probe: AvailabilityProbe = (startDate, endDate) =>
    deps.probeAvailability(productId, startDate, endDate);

  const resolved = await coalesce(
    monthCacheKey(tenantId, productId, month),
    () => resolveMonthDays(month, probe, { now: deps.now }),
    {
      now: deps.now,
      ttlMs: (value) => (value.partial ? MONTH_DEGRADED_CACHE_TTL_MS : MONTH_CACHE_TTL_MS),
    },
  );

  // Produkt nieosiągalny dla TEGO tenanta (nieznany albo cudzy) — RPC zwróciło
  // null przy pierwszej sondzie, więc nie ma ani jednego rozstrzygniętego dnia.
  // JEDNO 404 bez rozróżnienia, lustro kontraktu v1.
  if (Object.keys(resolved.days).length === 0 && resolved.calls > 0) {
    return embedError(404, "not_found");
  }

  const payload: EmbedMonthPayload = {
    month,
    days: resolved.days,
    unresolved: resolved.unresolved,
    partial: resolved.partial,
  };
  return embedJson(200, payload);
}

export async function handleEmbedReservationRequest(
  request: Request,
  deps: EmbedReservationDeps,
): Promise<Response> {
  const admitted = admitEmbedRequest(request, deps);
  if (typeof admitted !== "string") return admitted;
  const tenantId = admitted;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return embedError(400, "validation_failed");
  }

  // Rdzeń dławi już sam (CHECKOUT_RATE_LIMIT po IP), ale trzymamy własny wymiar
  // z prefiksem embedu: fala z cudzej strony nie ma zjadać budżetu formularza
  // storefrontu tego samego najemcy.
  const perIp = await deps.checkRateLimit(
    `embed:reserve:ip:${deps.ip}`,
    EMBED_RESERVATION_LIMIT_PER_IP,
  );
  if (!perIp.success) return embedError(429, "rate_limited");

  const result = await submitCheckoutCore(body, {
    tenantId,
    ip: deps.ip,
    checkRateLimit: (key, opts) => deps.checkRateLimit(key, opts),
    // Server-to-server captchy nie ma; tutaj nie ma jej z innego powodu —
    // widget captchy w cudzej ramce jest wektorem UX, nie bezpieczeństwa, a
    // zaporą jest dławienie po IP odwiedzającego (to samo, co na storefroncie).
    verifyCaptcha: async () => ({ ok: true }),
    issueTicket: () => deps.issueTicket(tenantId),
    callRpc: deps.callRpc,
    sendEmails: (ctx) => deps.sendEmails(tenantId, ctx),
    readOnlineAvailability: () => deps.readOnlineAvailability(tenantId),
    readCustomFields: () => deps.readCustomFields(tenantId),
    // Uchwyt zamówienia jest server-only w kontrakcie storefrontu; w ramce na
    // cudzej stronie tym bardziej nie ma go gdzie zapamiętać.
    rememberCheckout: async () => {},
  });

  switch (result.status) {
    case "success":
      return embedJson(201, {
        status: "success",
        nextStep: result.nextStep,
        order: result.order,
      });
    case "validation_error":
      return embedError(422, "validation_failed", result.fields as Record<string, string>);
    case "unavailable":
      return embedError(409, "conflict");
    case "rejected":
      return embedError(422, "rejected");
    case "rate_limited":
      return embedError(429, "rate_limited");
    case "payment_unavailable":
      return embedError(409, "conflict");
    default:
      return embedError(500, "server_error");
  }
}

export { CHECKOUT_RATE_LIMIT };
