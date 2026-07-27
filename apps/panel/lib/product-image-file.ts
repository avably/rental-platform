export const PRODUCT_IMAGE_BUCKET = "product-images";
export const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;

export type ProductImageMime = "image/jpeg" | "image/png" | "image/webp" | "image/avif";
export type ProductImageExtension = "jpg" | "png" | "webp" | "avif";

export const PRODUCT_IMAGE_MIME_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
} as const satisfies Readonly<Record<ProductImageMime, ProductImageExtension>>;

export type ProductImageFileProblem = "missing" | "empty" | "size" | "type";

export function checkProductImageMetadata(
  file: { size: number; type: string } | null | undefined,
): ProductImageFileProblem | null {
  if (!file) return "missing";
  if (file.size <= 0) return "empty";
  if (file.size > MAX_PRODUCT_IMAGE_BYTES) return "size";
  if (!(file.type in PRODUCT_IMAGE_MIME_EXTENSIONS)) return "type";
  return null;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}

export function detectProductImageMime(bytes: Uint8Array): ProductImageMime | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    ascii(bytes, 1, 4) === "PNG" &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  if (
    bytes.length >= 12 &&
    ascii(bytes, 0, 4) === "RIFF" &&
    ascii(bytes, 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }

  if (bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp") {
    const brands: string[] = [];
    for (let index = 8; index + 4 <= bytes.length; index += 4) {
      brands.push(ascii(bytes, index, index + 4));
    }
    if (brands.includes("avif") || brands.includes("avis")) {
      return "image/avif";
    }
  }

  return null;
}
