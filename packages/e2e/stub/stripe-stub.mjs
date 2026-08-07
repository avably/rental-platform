/**
 * Stub API płatności dla toru hermetycznego e2e — czysty Node, zero zależności.
 *
 * Udaje DOKŁADNIE te trzy wywołania, które ścieżka krytyczna wykonuje
 * u dostawcy, w kształcie, który czyta `StripeConnectClient`
 * (packages/core/src/stripe/api.ts):
 *   GET  /v1/accounts/{id}            → charges_enabled itd. (gotowość konta)
 *   POST /v1/payment_intents          → id + client_secret (+ stan w pamięci)
 *   GET  /v1/payment_intents/{id}     → status + amount_received (werdykt webhooka)
 *
 * Stan intentów żyje TUTAJ (jeden proces), bo tworzy je serwer storefrontu,
 * a odczytuje serwer panelu — pamięć procesu Next nie może być nośnikiem.
 *
 * Endpointy kontrolne (prefiks /__e2e/) sterują scenariuszami z testu:
 *   POST /__e2e/intents/{id}/status   {"status":"succeeded"|"requires_payment_method"|...}
 *   GET  /__e2e/intents               podgląd stanu (diagnostyka)
 *
 * GRANICA ZAUFANIA: ten stub dowodzi zachowania NASZEGO kodu (routing,
 * podpis webhooka, werdykt z odczytu, idempotencja, RLS, panel) na
 * produkcyjnym buildzie. NIE dowodzi zgodności z realnym API dostawcy —
 * kształt odpowiedzi jest tu zamrożony. Dryf API Stripe wykryje dopiero
 * tor żywy (test mode) za sekretami.
 */
import { createServer } from "node:http";

const port = Number(process.env.E2E_STRIPE_STUB_PORT ?? 4302);

/** @type {Map<string, { amount: number, currency: string, status: string, orderId: string | null }>} */
const intents = new Map();
let intentCounter = 0;

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
  });
}

function intentPayload(id, intent) {
  return {
    id,
    object: "payment_intent",
    status: intent.status,
    amount: intent.amount,
    amount_received: intent.status === "succeeded" ? intent.amount : 0,
    currency: intent.currency,
    client_secret: `${id}_secret_e2e`,
    metadata: intent.orderId ? { order_id: intent.orderId } : {},
  };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  const path = url.pathname;
  console.log(`[stripe-stub] ${req.method} ${path}`);

  // --- kontrola z testu ---------------------------------------------------
  if (path === "/__e2e/health") return json(res, 200, { ok: true });
  if (path === "/__e2e/intents" && req.method === "GET") {
    return json(res, 200, Object.fromEntries(intents));
  }
  const control = path.match(/^\/__e2e\/intents\/([^/]+)\/status$/);
  if (control && req.method === "POST") {
    const intent = intents.get(control[1]);
    if (!intent) return json(res, 404, { error: "nieznany intent" });
    const body = JSON.parse((await readBody(req)) || "{}");
    if (typeof body.status !== "string") return json(res, 400, { error: "brak statusu" });
    intent.status = body.status;
    return json(res, 200, intentPayload(control[1], intent));
  }

  // --- kształt API dostawcy ----------------------------------------------
  const account = path.match(/^\/v1\/accounts\/([^/]+)$/);
  if (account && req.method === "GET") {
    return json(res, 200, {
      id: decodeURIComponent(account[1]),
      object: "account",
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      requirements: { currently_due: [], disabled_reason: null },
    });
  }

  if (path === "/v1/payment_intents" && req.method === "POST") {
    const form = new URLSearchParams(await readBody(req));
    const amount = Number(form.get("amount"));
    if (!Number.isFinite(amount) || amount <= 0) {
      return json(res, 400, { error: { message: "amount nieprawidłowy" } });
    }
    // Idempotencja jak u dostawcy: ten sam klucz → ten sam intent.
    const idempotencyKey = req.headers["idempotency-key"];
    if (typeof idempotencyKey === "string") {
      for (const [id, intent] of intents) {
        if (intent.idempotencyKey === idempotencyKey) {
          return json(res, 200, intentPayload(id, intent));
        }
      }
    }
    intentCounter += 1;
    const id = `pi_e2e_${intentCounter}`;
    const intent = {
      amount,
      currency: form.get("currency") ?? "pln",
      status: "requires_payment_method",
      orderId: form.get("metadata[order_id]"),
      idempotencyKey: typeof idempotencyKey === "string" ? idempotencyKey : null,
    };
    intents.set(id, intent);
    return json(res, 200, intentPayload(id, intent));
  }

  const read = path.match(/^\/v1\/payment_intents\/([^/]+)$/);
  if (read && req.method === "GET") {
    const id = decodeURIComponent(read[1]);
    const intent = intents.get(id);
    if (!intent) {
      return json(res, 404, { error: { message: `Nieznany intent: ${id}` } });
    }
    return json(res, 200, intentPayload(id, intent));
  }

  return json(res, 404, { error: { message: `Stub nie obsługuje: ${req.method} ${path}` } });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[stripe-stub] nasłuchuje na 127.0.0.1:${port}`);
});
