/**
 * Porty produkcyjne tras embedu (M3, ADR-120) — wzorzec lib/api/deps.ts.
 *
 * Wszystko idzie kluczem ANON, zero service-role (bramka
 * scripts/audit-service-role.sh). Tenant czytamy z nagłówka wstrzykniętego
 * przez proxy PO `stripInboundTenantHeaders`, więc wartość przyniesiona przez
 * klienta nie ma jak tu dotrzeć.
 */

import { clientIpFromHeaders } from "@avably/security/client-ip";
import {
  checkRateLimit,
  STOREFRONT_EMBED_RATE_LIMIT_PREFIX,
} from "@avably/security/rate-limit";
import { getPublicAvailability } from "@/lib/checkout/catalog";
import { reservationDeps } from "@/lib/api/deps";
import { TENANT_ID_HEADER } from "@/lib/tenant/headers";
import type { EmbedDeps, EmbedMonthDeps, EmbedReservationDeps } from "./handlers";

function baseDeps(request: Request): EmbedDeps {
  return {
    tenantId: request.headers.get(TENANT_ID_HEADER),
    ip: clientIpFromHeaders(request.headers),
    checkRateLimit: (key, opts) =>
      checkRateLimit(key, { ...opts, prefix: STOREFRONT_EMBED_RATE_LIMIT_PREFIX }),
    now: () => Date.now(),
  };
}

export function embedMonthDeps(request: Request): EmbedMonthDeps {
  return {
    ...baseDeps(request),
    probeAvailability: async (productId, startDate, endDate) => {
      const tenantId = request.headers.get(TENANT_ID_HEADER);
      if (tenantId === null) return null;
      const result = await getPublicAvailability(tenantId, productId, startDate, endDate);
      return result === null ? null : result.available_units;
    },
  };
}

/**
 * Zapis SIĘGA PO TE SAME porty produkcyjne co /api/v1 (RPC checkoutu, poczta,
 * odczyt gotowości płatności online) — celowo, żeby nie powstała druga ścieżka
 * rezerwacji. To lustro decyzji 3 z ADR-108: rdzeń jest jeden, różni się
 * wyłącznie przedsionek (tam klucz API, tu same-origin).
 */
export function embedReservationDeps(request: Request): EmbedReservationDeps {
  // [0059] `issueTicket` jedzie w tym samym pakiecie portów co reszta — embed
  // dziedziczy mint razem z RPC, więc nie może powstać powierzchnia, która
  // woła checkout bez biletu (ADR-125).
  const { callRpc, sendEmails, readOnlineAvailability, readCustomFields, issueTicket } =
    reservationDeps(request);
  return {
    ...baseDeps(request),
    callRpc,
    sendEmails,
    readOnlineAvailability,
    readCustomFields,
    issueTicket,
  };
}
