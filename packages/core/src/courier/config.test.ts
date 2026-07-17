import { describe, expect, it } from "vitest";

import { COUNTRY_IDS, PAYMENT_IDS, getApiUrl } from "./config";

describe("getApiUrl", () => {
  it("zwraca URL produkcyjny i testowy per środowisko", () => {
    expect(getApiUrl("production")).toBe("https://api.globkurier.pl/v1");
    expect(getApiUrl("test")).toBe("https://test.api.globkurier.pl/v1");
  });
});

describe("stałe API", () => {
  it("identyfikatory płatności i krajów zgodne z kontraktem GlobKurier", () => {
    expect(PAYMENT_IDS.PREPAID).toBe(9);
    expect(COUNTRY_IDS.POLAND).toBe(1);
  });
});
