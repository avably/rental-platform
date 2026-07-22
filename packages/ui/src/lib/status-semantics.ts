// Jedno źródło prawdy semantyki statusów domenowych (ADR-055): kopia
// powierzchni `data-code-surface="status-map"` artefaktu Fazy 2. Zgodność 1:1
// egzekwuje status-contract.test.ts — zmiana rodzaju bez zmiany artefaktu
// wywraca suitę. Ekrany (P4+) mapują status rekordu na rodzaj semantyczny
// StatusBadge przez tę stałą, nigdy przez własne warunki.

export const statusTones = [
  "neutral",
  "attention",
  "positive",
  "problem",
] as const;

export type StatusTone = (typeof statusTones)[number];

export const statusSemantics = {
  order: {
    pending: "attention",
    reserved: "neutral",
    ready_for_pickup: "attention",
    picked_up: "neutral",
    returned: "positive",
    cancelled: "problem",
  },
  payment: {
    unpaid: "attention",
    pending: "neutral",
    // 0027 / ADR-064: odrzucona albo wygasła próba płatności online. Ton
    // `problem` — wymaga reakcji (ponowienie), a nie samego oczekiwania.
    payment_failed: "problem",
    paid: "positive",
    manual: "attention",
    completed: "positive",
    deposit_refunded: "positive",
    refunded: "neutral",
    cancelled: "problem",
  },
  shipment: {
    created: "neutral",
    in_progress: "neutral",
    in_transit: "neutral",
    delivered: "positive",
    cancelled: "problem",
    returned_to_sender: "problem",
  },
} as const satisfies Record<string, Record<string, StatusTone>>;

export type StatusAxis = keyof typeof statusSemantics;
