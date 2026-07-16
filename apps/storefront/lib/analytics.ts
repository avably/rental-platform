import type {
  CurrentProcess,
  InventoryRange,
  RentalType,
  WaitlistField,
  WaitlistFieldError,
} from "@/lib/waitlist/contract";

export const LANDING_EVENT_NAMES = [
  "waitlist_page_view",
  "waitlist_section_view",
  "waitlist_cta_click",
  "waitlist_form_start",
  "pilot_interest_selected",
  "pilot_interest_cleared",
  "waitlist_submit_attempt",
  "waitlist_validation_error",
  "waitlist_submit_error",
  "waitlist_signup_success",
  "pilot_declaration_success",
  "waitlist_duplicate",
  "language_switch",
] as const;

export const ALLOWED_ANALYTICS_PROPERTIES = [
  "language",
  "source",
  "campaign",
  "section",
  "placement",
  "pilot_selected",
  "field",
  "error_type",
  "rental_type",
  "inventory_range",
  "current_process",
  "from",
  "to",
] as const;

type Locale = "en" | "pl";
type EventName = (typeof LANDING_EVENT_NAMES)[number];

interface EventProperties {
  language_switch: { from: Locale; section: string; to: Locale };
  pilot_declaration_success: {
    current_process: CurrentProcess;
    inventory_range: InventoryRange;
    language: Locale;
    rental_type: RentalType;
  };
  pilot_interest_cleared: { language: Locale };
  pilot_interest_selected: { language: Locale };
  waitlist_cta_click: { language: Locale; placement: string };
  waitlist_duplicate: { language: Locale };
  waitlist_form_start: { language: Locale };
  waitlist_page_view: { campaign?: string; language: Locale; source?: string };
  waitlist_section_view: { language: Locale; section: string };
  waitlist_signup_success: {
    current_process: CurrentProcess;
    inventory_range: InventoryRange;
    language: Locale;
    pilot_selected: boolean;
    rental_type: RentalType;
  };
  waitlist_submit_attempt: { language: Locale; pilot_selected: boolean };
  waitlist_submit_error: { error_type: "connection" | "server"; language: Locale };
  waitlist_validation_error: {
    error_type: WaitlistFieldError;
    field: WaitlistField;
    language: Locale;
  };
}

interface PostHogClient {
  capture(name: string, properties?: Record<string, unknown>): void;
}

declare global {
  interface Window {
    posthog?: PostHogClient;
  }
}

export function captureLandingEvent<Name extends EventName>(
  name: Name,
  properties: EventProperties[Name],
): void {
  if (typeof window === "undefined") return;
  window.posthog?.capture(name, properties);
}
