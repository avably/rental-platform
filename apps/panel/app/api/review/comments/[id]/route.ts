/**
 * Zmiana uwagi przeglądu (status/priorytet/treść) — droga panelowa.
 *
 * PATCH to ZAPIS, więc od ADR-206 jedzie bramką zapisu (REVIEW_MODE +
 * rate limit, bez superadmina) i service_rolem — jak POST obok: nakładka
 * pozwala autorowi uwagi poprawić treść/priorytet także tam, gdzie nie ma
 * sesji superadmina. Zasięg praktyczny ogranicza wiedza o UUID uwagi
 * (nakładka bez superadmina nie ma odczytu listy — zna wyłącznie
 * identyfikatory uwag utworzonych w tej sesji przeglądarki); to świadomie
 * zaakceptowane w ADR-206 razem z całym modelem „publiczny zapis na czas
 * przeglądu".
 */
import { handlePatchRequest } from "@avably/review";

import { reviewServiceClient } from "@/app/api/review/client";
import { reviewWriteGuard } from "@/lib/review-write-guard";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const gate = await reviewWriteGuard(request);
  if (gate instanceof Response) return gate;
  const { id } = await params;
  return handlePatchRequest(reviewServiceClient(), request, id);
}
