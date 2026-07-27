import { describe, expect, it } from "vitest";

import {
  MAX_PRODUCT_IMAGE_BYTES,
  checkProductImageMetadata,
  detectProductImageMime,
} from "@/lib/product-image-file";

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = new TextEncoder().encode("RIFF\u0004\u0000\u0000\u0000WEBPVP8 ");
const AVIF = Uint8Array.from([
  0x00, 0x00, 0x00, 0x18,
  0x66, 0x74, 0x79, 0x70,
  0x61, 0x76, 0x69, 0x66,
  0x00, 0x00, 0x00, 0x00,
  0x61, 0x76, 0x69, 0x66,
  0x6d, 0x69, 0x66, 0x31,
]);

describe("kontrakt pliku zdjęcia produktu", () => {
  it.each([
    [JPEG, "image/jpeg"],
    [PNG, "image/png"],
    [WEBP, "image/webp"],
    [AVIF, "image/avif"],
  ] as const)("rozpoznaje format po prawdziwych bajtach", (bytes, expected) => {
    expect(detectProductImageMime(bytes)).toBe(expected);
  });

  it.each([
    new TextEncoder().encode("<svg><script>alert(1)</script></svg>"),
    Uint8Array.from([]),
    Uint8Array.from([0x89, 0x50]),
  ])("odrzuca podszyte albo ucięte bajty", (bytes) => {
    expect(detectProductImageMime(bytes)).toBeNull();
  });

  it("akceptuje dokładnie 5 MiB i odrzuca jeden bajt więcej", () => {
    expect(
      checkProductImageMetadata({
        size: MAX_PRODUCT_IMAGE_BYTES,
        type: "image/png",
      }),
    ).toBeNull();
    expect(
      checkProductImageMetadata({
        size: MAX_PRODUCT_IMAGE_BYTES + 1,
        type: "image/png",
      }),
    ).toBe("size");
  });

  it.each([
    [null, "missing"],
    [{ size: 0, type: "image/png" }, "empty"],
    [{ size: 10, type: "image/svg+xml" }, "type"],
  ] as const)("zwraca stabilny kod problemu metadanych", (file, expected) => {
    expect(checkProductImageMetadata(file)).toBe(expected);
  });
});
