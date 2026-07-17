"use client";

import { Button, Input, Label } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useActionState, useId } from "react";

import type { FormState } from "@/lib/form-state";

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
    <p id={id} className="text-sm text-red-600">
      {message}
    </p>
  );
}

export function UploadImageForm({ action }: { action: ImageAction }) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const t = useTranslations("catalog.images");
  const idPrefix = useId();

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-lg border border-gray-200 p-4">
      <h2 className="text-sm font-semibold">{t("addTitle")}</h2>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-file`}>{t("file")}</Label>
        <Input
          id={`${idPrefix}-file`}
          name="file"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          aria-invalid={state.fieldErrors?.file ? true : undefined}
          aria-describedby={state.fieldErrors?.file ? `${idPrefix}-file-error` : `${idPrefix}-file-hint`}
        />
        <FieldError id={`${idPrefix}-file-error`} message={state.fieldErrors?.file} />
        <p id={`${idPrefix}-file-hint`} className="text-xs text-gray-500">
          {t("fileHint")}
        </p>
      </div>
      {state.formError ? (
        <p role="alert" className="text-sm text-red-600">
          {state.formError}
        </p>
      ) : null}
      {state.success ? (
        <p role="status" className="text-sm text-green-700">
          {t("added")}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? t("adding") : t("add")}
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
      className="flex flex-col gap-3 rounded-lg border border-gray-200 p-4 sm:flex-row sm:items-start"
    >
      <input type="hidden" name="imageId" value={image.id} />
      {/* eslint-disable-next-line @next/next/no-img-element -- miniatura z publicznego bucketu Storage (transformacja Supabase), nie zasób lokalny next/image */}
      <img
        src={image.thumbnailUrl}
        alt={image.altText || t("thumbnailAlt")}
        width={120}
        height={120}
        className="h-[120px] w-[120px] shrink-0 rounded-md border border-gray-200 object-cover"
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
          <p role="alert" className="text-sm text-red-600">
            {state.formError}
          </p>
        ) : null}
        {state.success ? (
          <p role="status" className="text-sm text-green-700">
            {state.success === "deleted" ? t("deletedInfo") : t("saved")}
          </p>
        ) : null}
        <div className="flex gap-2">
          <Button type="submit" name="intent" value="save" disabled={pending}>
            {pending ? t("saving") : t("save")}
          </Button>
          <Button type="submit" name="intent" value="delete" variant="destructive" disabled={pending}>
            {t("delete")}
          </Button>
        </div>
      </div>
    </form>
  );
}
