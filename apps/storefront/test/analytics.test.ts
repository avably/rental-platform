import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ALLOWED_ANALYTICS_PROPERTIES,
  captureLandingEvent,
  LANDING_EVENT_NAMES,
} from "@/lib/analytics";

describe("landing analytics contract", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the approved event names exactly", () => {
    expect(LANDING_EVENT_NAMES).toEqual([
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
    ]);
  });

  it("does not allow PII property names", () => {
    expect(JSON.stringify(ALLOWED_ANALYTICS_PROPERTIES)).not.toMatch(
      /email|phone|other[_-]?equipment/i,
    );
  });

  it("uses an initialized analytics client without requiring an unapproved public env", () => {
    const capture = vi.fn();
    vi.stubGlobal("window", { posthog: { capture } });

    captureLandingEvent("waitlist_page_view", { language: "pl" });

    expect(capture).toHaveBeenCalledWith("waitlist_page_view", { language: "pl" });
  });

  it("is a no-op when the analytics client is not initialized", () => {
    vi.stubGlobal("window", {});

    expect(() =>
      captureLandingEvent("waitlist_page_view", { language: "en" }),
    ).not.toThrow();
  });
});
