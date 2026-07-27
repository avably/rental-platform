import {
  checkProductImageMetadata,
  detectProductImageMime,
  MAX_PRODUCT_IMAGE_BYTES,
  type ProductImageMime,
} from "@/lib/product-image-file";

export interface PreparedProductImageUpload {
  uploadId: string;
  path: string;
  token: string;
}

export type PrepareProductImageUploadResult =
  | { ok: true; upload: PreparedProductImageUpload }
  | { ok: false; error: string };

export type FinalizeProductImageUploadResult =
  | { ok: true }
  | { ok: false; error: string };

export interface ClaimedProductImageUpload {
  uploadId: string;
  tenantId: string;
  productId: string;
  storagePath: string;
  declaredMime: ProductImageMime;
  declaredSize: number;
}

export interface PrepareProductImageUploadDependencies {
  issue: (input: {
    productId: string;
    mime: ProductImageMime;
    size: number;
  }) => Promise<{ uploadId: string; storagePath: string }>;
  sign: (path: string) => Promise<{ token: string }>;
}

export interface ProductImageStorageInfo {
  size: number;
  contentType: string | null;
}

export interface ProductImageRowInput {
  tenantId: string;
  productId: string;
  storagePath: string;
  sortOrder: number;
}

export interface FinalizeProductImageUploadDependencies {
  claim: (uploadId: string) => Promise<ClaimedProductImageUpload>;
  info: (path: string) => Promise<ProductImageStorageInfo>;
  download: (path: string) => Promise<Uint8Array>;
  nextSortOrder: (tenantId: string, productId: string) => Promise<number>;
  insert: (row: ProductImageRowInput) => Promise<void>;
  exists: (path: string) => Promise<boolean>;
  remove: (path: string) => Promise<void>;
  finish: (uploadId: string, status: "completed" | "rejected") => Promise<void>;
  report: (error: unknown) => void | Promise<void>;
}

export async function prepareProductImageUpload(
  input: { productId: string; mime: string; size: number },
  deps: PrepareProductImageUploadDependencies,
): Promise<PrepareProductImageUploadResult> {
  const problem = checkProductImageMetadata({ size: input.size, type: input.mime });
  if (problem) return { ok: false, error: problem };

  let intent: { uploadId: string; storagePath: string };
  try {
    intent = await deps.issue({
      productId: input.productId,
      mime: input.mime as ProductImageMime,
      size: input.size,
    });
  } catch {
    return { ok: false, error: "denied" };
  }

  try {
    const signed = await deps.sign(intent.storagePath);
    return {
      ok: true,
      upload: {
        uploadId: intent.uploadId,
        path: intent.storagePath,
        token: signed.token,
      },
    };
  } catch {
    return { ok: false, error: "sign" };
  }
}

async function report(
  deps: FinalizeProductImageUploadDependencies,
  error: unknown,
): Promise<void> {
  try {
    await deps.report(error);
  } catch {
    // Raportowanie nie może zmienić wyniku autorytatywnych operacji.
  }
}

async function finishRejected(
  uploadId: string,
  deps: FinalizeProductImageUploadDependencies,
): Promise<void> {
  try {
    await deps.finish(uploadId, "rejected");
  } catch (error) {
    await report(deps, error);
  }
}

async function removeAndReject(
  uploadId: string,
  path: string,
  deps: FinalizeProductImageUploadDependencies,
): Promise<void> {
  try {
    await deps.remove(path);
  } catch (error) {
    await report(deps, error);
  }
  await finishRejected(uploadId, deps);
}

async function finishCompleted(
  uploadId: string,
  deps: FinalizeProductImageUploadDependencies,
): Promise<void> {
  try {
    await deps.finish(uploadId, "completed");
  } catch (error) {
    await report(deps, error);
  }
}

export async function finalizeProductImageUpload(
  uploadId: string,
  deps: FinalizeProductImageUploadDependencies,
): Promise<FinalizeProductImageUploadResult> {
  let claimed: ClaimedProductImageUpload;
  try {
    claimed = await deps.claim(uploadId);
  } catch {
    return { ok: false, error: "denied" };
  }

  let info: ProductImageStorageInfo;
  try {
    info = await deps.info(claimed.storagePath);
  } catch {
    await finishRejected(uploadId, deps);
    return { ok: false, error: "missing" };
  }

  if (
    info.size !== claimed.declaredSize ||
    info.contentType !== claimed.declaredMime ||
    info.size <= 0 ||
    info.size > MAX_PRODUCT_IMAGE_BYTES
  ) {
    await removeAndReject(uploadId, claimed.storagePath, deps);
    return { ok: false, error: "metadata" };
  }

  let bytes: Uint8Array;
  try {
    bytes = await deps.download(claimed.storagePath);
  } catch {
    await removeAndReject(uploadId, claimed.storagePath, deps);
    return { ok: false, error: "missing" };
  }

  if (detectProductImageMime(bytes) !== claimed.declaredMime) {
    await removeAndReject(uploadId, claimed.storagePath, deps);
    return { ok: false, error: "content" };
  }

  try {
    const sortOrder = await deps.nextSortOrder(claimed.tenantId, claimed.productId);
    await deps.insert({
      tenantId: claimed.tenantId,
      productId: claimed.productId,
      storagePath: claimed.storagePath,
      sortOrder,
    });
  } catch {
    let rowExists = false;
    try {
      rowExists = await deps.exists(claimed.storagePath);
    } catch (error) {
      await report(deps, error);
    }

    if (rowExists) {
      await finishCompleted(uploadId, deps);
      return { ok: true };
    }

    await removeAndReject(uploadId, claimed.storagePath, deps);
    return { ok: false, error: "insert" };
  }

  await finishCompleted(uploadId, deps);
  return { ok: true };
}
