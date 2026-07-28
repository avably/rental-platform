"use client";

import { Button, Input, Label } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useActionState, useId, useRef, useState } from "react";

import type { FormState } from "@/lib/form-state";
import type { PrepareProductImageUploadResult } from "@/lib/product-image-upload";

import {
  runProductImageUpload,
  uploadProductImageToSignedUrl,
} from "./upload-flow";

const initialState: FormState = {};

export interface ImageValues {
  id: string;
  sortOrder: number;
  /** Publiczny URL miniatury (transformacja Supabase — width/quality). */
  thumbnailUrl: string;
  altText: string;
}

type ImageAction = (prevState: FormState, formData: FormData) => Promise<FormState>;

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-destructive text-[13px] leading-[18px] font-medium">
      {message}
    </p>
  );
}

export function UploadImageForm({
  prepare,
  finalize,
}: {
  prepare: (input: { mime: string; size: number }) => Promise<PrepareProductImageUploadResult>;
  finalize: (uploadId: string) => Promise<FormState>;
}) {
  const [state, setState] = useState<FormState>(initialState);
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [fileInputVersion, setFileInputVersion] = useState(0);
  const pendingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const t = useTranslations("catalog.images");
  const idPrefix = useId();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current) return;

    const form = event.currentTarget;
    pendingRef.current = true;
    setPending(true);
    setState({});
    try {
      const result = await runProductImageUpload(file, {
        prepare,
        upload: uploadProductImageToSignedUrl,
        finalize,
        message: (problem) => t(`errors.${problem}`),
      });
      setState(result);
      if (result.success) {
        setFile(null);
        form.reset();
        if (fileInputRef.current) fileInputRef.current.value = "";
        setFileInputVersion((version) => version + 1);
      }
    } catch {
      setState({ formError: t("errors.upload") });
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border-border bg-card flex flex-col gap-4 rounded-lg border p-5"
    >
      <h2 className="text-xl leading-[26px] font-semibold tracking-[-0.01em]">{t("addTitle")}</h2>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-file`}>{t("file")}</Label>
        <Input
          key={fileInputVersion}
          id={`${idPrefix}-file`}
          ref={fileInputRef}
          name="file"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)}
          aria-invalid={state.fieldErrors?.file ? true : undefined}
          aria-describedby={state.fieldErrors?.file ? `${idPrefix}-file-error` : `${idPrefix}-file-hint`}
        />
        <FieldError id={`${idPrefix}-file-error`} message={state.fieldErrors?.file} />
        <p id={`${idPrefix}-file-hint`} className="text-muted-foreground text-[13px] leading-[18px]">
          {t("fileHint")}
        </p>
      </div>
      {state.formError ? (
        <p role="alert" className="text-destructive text-sm">
          {state.formError}
        </p>
      ) : null}
      {state.success ? (
        <p role="status" className="text-status-positive-fg text-sm">
          {t("added")}
        </p>
      ) : null}
      <div>
        <Button type="submit" loading={pending} disabled={pending}>
          {pending ? t("uploading") : t("add")}
        </Button>
      </div>
    </form>
  );
}

export function ImageRowForm({ action, image }: { action: ImageAction; image: ImageValues }) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const t = useTranslations("catalog.images");
  const idPrefix = useId();

  return (
    <form
      action={formAction}
      className="border-border bg-card flex flex-col gap-4 rounded-lg border p-5 sm:flex-row sm:items-start"
    >
      <input type="hidden" name="imageId" value={image.id} />
      {/* eslint-disable-next-line @next/next/no-img-element -- miniatura z publicznego bucketu Storage (transformacja Supabase), nie zasób lokalny next/image */}
      <img
        src={image.thumbnailUrl}
        alt={image.altText || t("thumbnailAlt")}
        width={120}
        height={120}
        className="h-[120px] w-[120px] shrink-0 border-border rounded-md border object-cover"
      />
      <div className="flex flex-1 flex-col gap-3">
        <div className="flex max-w-[10rem] flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-sort`}>{t("sortOrder")}</Label>
          <Input
            id={`${idPrefix}-sort`}
            name="sortOrder"
            type="number"
            min={0}
            max={9999}
            defaultValue={String(image.sortOrder)}
            aria-invalid={state.fieldErrors?.sortOrder ? true : undefined}
            aria-describedby={state.fieldErrors?.sortOrder ? `${idPrefix}-sort-error` : undefined}
          />
          <FieldError id={`${idPrefix}-sort-error`} message={state.fieldErrors?.sortOrder} />
        </div>
        {state.formError ? (
          <p role="alert" className="text-destructive text-sm">
            {state.formError}
          </p>
        ) : null}
        {state.success ? (
          <p role="status" className="text-status-positive-fg text-sm">
            {state.success === "deleted" ? t("deletedInfo") : t("saved")}
          </p>
        ) : null}
        <div className="flex gap-2">
          <Button type="submit" name="intent" value="save" loading={pending} disabled={pending}>
            {t("save")}
          </Button>
          <Button type="submit" name="intent" value="delete" variant="destructive" loading={pending} disabled={pending}>
            {t("delete")}
          </Button>
        </div>
      </div>
    </form>
  );
}
