/**
 * Kontrakt danych narzędzia przeglądu (ADR-071) — wspólny dla nakładki
 * i OBU endpointów zapisu (panel: sesja superadmina przez RLS; storefront:
 * service_role za podwójną bramką REVIEW_MODE + hasło site'u).
 *
 * Walidacja lustrzana wobec CHECK-ów migracji 0033 — endpoint odrzuca to
 * samo, co odrzuciłaby baza, tylko z czytelnym komunikatem i bez rundy.
 */
import { z } from "zod";

export const REVIEW_SURFACES = ["panel", "marketing", "storefront"] as const;
export type ReviewSurface = (typeof REVIEW_SURFACES)[number];

export const MAX_ATTACHMENTS = 4;
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

const normalized = z.number().min(0).max(1);

export const createCommentSchema = z
  .object({
    surface: z.enum(REVIEW_SURFACES),
    screen: z.string().trim().min(1).max(120),
    route: z.string().trim().min(1).max(500),
    kind: z.enum(["point", "area"]),
    pos_x: normalized,
    pos_y: normalized,
    area_w: normalized.nullish(),
    area_h: normalized.nullish(),
    scroll_y: z.number().int().min(0).default(0),
    body: z.string().trim().min(1).max(10000),
    priority: z.number().int().min(1).max(5).default(3),
  })
  .refine(
    (c) =>
      c.kind === "area"
        ? c.area_w != null && c.area_h != null
        : c.area_w == null && c.area_h == null,
    { message: "area wymaga area_w/area_h; punkt ich zabrania" },
  );

export type CreateCommentInput = z.infer<typeof createCommentSchema>;

export const patchCommentSchema = z
  .object({
    status: z.enum(["open", "done"]).optional(),
    priority: z.number().int().min(1).max(5).optional(),
    body: z.string().trim().min(1).max(10000).optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: "pusta zmiana" });

export type PatchCommentInput = z.infer<typeof patchCommentSchema>;

/** Kształt odpowiedzi GET/POST — komentarz z załącznikami i signed URL-ami. */
export interface ReviewCommentDto {
  id: string;
  surface: ReviewSurface;
  screen: string;
  route: string;
  kind: "point" | "area";
  pos_x: number;
  pos_y: number;
  area_w: number | null;
  area_h: number | null;
  scroll_y: number;
  body: string;
  priority: number;
  status: "open" | "done";
  created_at: string;
  attachments: { id: string; url: string }[];
}
