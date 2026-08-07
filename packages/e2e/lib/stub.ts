import type { APIRequestContext } from "@playwright/test";

import { STRIPE_STUB_URL } from "./env";

type StubIntent = {
  amount: number;
  currency: string;
  status: string;
  orderId: string | null;
};

/** Najświeższy intent utworzony w stubie (najwyższy licznik `pi_e2e_N`).
 * Testy biegną sekwencyjnie (workers=1), więc „najświeższy po moim
 * checkoucie" jest jednoznaczny. */
export async function latestStubIntent(
  request: APIRequestContext,
): Promise<{ id: string } & StubIntent> {
  const response = await request.get(`${STRIPE_STUB_URL}/__e2e/intents`);
  if (!response.ok()) throw new Error(`Stub nie odpowiada: ${response.status()}`);
  const intents = (await response.json()) as Record<string, StubIntent>;
  const ids = Object.keys(intents);
  if (ids.length === 0) throw new Error("Stub nie ma żadnych intentów — checkout nie utworzył płatności?");
  const latest = ids.sort((a, b) => Number(a.split("_").at(-1)) - Number(b.split("_").at(-1))).at(-1)!;
  return { id: latest, ...intents[latest]! };
}

/** Ustawia stan płatności u „dostawcy" (stub) — to jedyne źródło, z którego
 * webhook ma prawo wyprowadzić werdykt. */
export async function setStubIntentStatus(
  request: APIRequestContext,
  intentId: string,
  status: string,
): Promise<void> {
  const response = await request.post(`${STRIPE_STUB_URL}/__e2e/intents/${intentId}/status`, {
    data: { status },
  });
  if (!response.ok()) {
    throw new Error(`Stub nie przyjął statusu ${status} dla ${intentId}: ${response.status()}`);
  }
}
