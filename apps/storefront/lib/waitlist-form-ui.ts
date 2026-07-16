import {
  CURRENT_PROCESSES,
  INVENTORY_RANGES,
  RENTAL_TYPES,
  type WaitlistFieldErrors,
  type WaitlistInput,
  type WaitlistResult,
} from "@/lib/waitlist/contract";

export type WaitlistViewState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success" }
  | { kind: "duplicate" }
  | { kind: "validation"; fields: WaitlistFieldErrors }
  | { kind: "disabled" }
  | { kind: "connection_error" }
  | { kind: "server_error" };

export function isWaitlistResultVisible(kind: WaitlistViewState["kind"]): boolean {
  return kind !== "idle" && kind !== "submitting";
}

export type WaitlistMessageKey =
  | "success"
  | "duplicate"
  | "validation"
  | "disabled"
  | "connection"
  | "server";

export function getWaitlistMessageKey(view: WaitlistViewState): WaitlistMessageKey | null {
  switch (view.kind) {
    case "success":
    case "duplicate":
    case "validation":
    case "disabled":
      return view.kind;
    case "server_error":
      return "server";
    case "connection_error":
      return "connection";
    case "idle":
    case "submitting":
      return null;
  }
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateWaitlistInput(input: WaitlistInput): WaitlistFieldErrors {
  const fields: WaitlistFieldErrors = {};
  const email = input.email.trim();

  if (!email) fields.email = "required";
  else if (email.length > 320) fields.email = "too_long";
  else if (!emailPattern.test(email)) fields.email = "invalid";

  if (!RENTAL_TYPES.includes(input.rentalType)) fields.rentalType = "required";
  if (!INVENTORY_RANGES.includes(input.inventoryRange)) fields.inventoryRange = "required";
  if (!CURRENT_PROCESSES.includes(input.currentProcess)) fields.currentProcess = "required";
  if (input.consent !== true) fields.consent = "required";

  const otherEquipment = input.otherEquipment?.trim();
  if (input.rentalType === "other" && !otherEquipment) fields.otherEquipment = "required";
  if (otherEquipment && input.rentalType !== "other") fields.otherEquipment = "not_allowed";
  if (otherEquipment && otherEquipment.length > 500) fields.otherEquipment = "too_long";

  const phone = input.phone?.trim();
  if (phone && !input.pilotInterest) fields.phone = "not_allowed";
  if (phone && (phone.length < 6 || phone.length > 32)) fields.phone = "invalid";

  if (input.locale !== undefined && input.locale !== "pl" && input.locale !== "en") {
    fields.locale = "invalid";
  }

  return fields;
}

export async function submitWaitlistInput(
  input: WaitlistInput,
  submit: (value: WaitlistInput) => Promise<WaitlistResult>,
): Promise<WaitlistResult> {
  const fields = validateWaitlistInput(input);
  if (Object.keys(fields).length > 0) return { status: "validation_error", fields };
  return submit(input);
}

export function mapWaitlistResult(result: WaitlistResult): WaitlistViewState {
  switch (result.status) {
    case "success":
      return { kind: "success" };
    case "duplicate":
      return { kind: "duplicate" };
    case "validation_error":
      return { kind: "validation", fields: result.fields };
    case "disabled":
      return { kind: "disabled" };
    case "rate_limited":
    case "server_error":
      return { kind: "server_error" };
  }
}
