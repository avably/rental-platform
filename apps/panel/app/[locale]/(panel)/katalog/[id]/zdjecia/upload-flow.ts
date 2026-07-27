import { createBrowserClient } from "@avably/db";

import type { FormState } from "@/lib/form-state";
import {
  checkProductImageMetadata,
  PRODUCT_IMAGE_BUCKET,
  type ProductImageFileProblem,
} from "@/lib/product-image-file";
import type { PrepareProductImageUploadResult } from "@/lib/product-image-upload";

interface ProductImageUploadFlowDependencies {
  prepare: (input: { mime: string; size: number }) => Promise<PrepareProductImageUploadResult>;
  upload: (input: {
    path: string;
    token: string;
    file: File;
    contentType: string;
  }) => Promise<{ error: string | null }>;
  finalize: (uploadId: string) => Promise<FormState>;
  message: (problem: ProductImageFileProblem | "upload") => string;
}

export async function uploadProductImageToSignedUrl(input: {
  path: string;
  token: string;
  file: File;
  contentType: string;
}): Promise<{ error: string | null }> {
  const supabase = createBrowserClient();
  const { error } = await supabase.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .uploadToSignedUrl(input.path, input.token, input.file, {
      contentType: input.contentType,
      upsert: false,
    });
  return { error: error ? "upload" : null };
}

export async function runProductImageUpload(
  file: File | null,
  deps: ProductImageUploadFlowDependencies,
): Promise<FormState> {
  if (!file) return { formError: deps.message("missing") };

  const problem = checkProductImageMetadata(file);
  if (problem) return { formError: deps.message(problem) };

  const prepared = await deps.prepare({
    mime: file.type,
    size: file.size,
  });
  if (!prepared.ok) return { formError: prepared.error };

  const uploaded = await deps.upload({
    path: prepared.upload.path,
    token: prepared.upload.token,
    file,
    contentType: file.type,
  });
  if (uploaded.error) return { formError: deps.message("upload") };

  return deps.finalize(prepared.upload.uploadId);
}
