"use client";

/**
 * Nakładka komentarzy przeglądu „jak w Figmie" (ADR-071).
 *
 * Dwa tryby, zawsze widoczny pływający przełącznik (kciukowo, dolny róg):
 * - PODGLĄD (start): interfejs działa NORMALNIE — warstwa ma pointer-events:
 *   none i nie renderuje pinezek, więc żaden klik nie zostaje przechwycony.
 * - KOMENTARZ: warstwa nad całym DOKUMENTEM łapie wskaźnik; krótki klik/tap →
 *   pinezka (point), przeciągnięcie > 8 px → obszar (area). Widoczne są
 *   WSZYSTKIE pinezki trasy — stan trzyma komponent, więc przełączanie
 *   trybów niczego nie gubi.
 *
 * Stany wizualne: open = limonka z numerem PRIORYTETU (1–5), done = wyciszona
 * z ✓; chip „Rozwiązane" przełącza ich widoczność (domyślnie przyciemnione,
 * ale obecne). Współrzędne normalizowane do dokumentu (0..1) — niezależne od
 * viewportu i breakpointu.
 *
 * Zapis przez wstrzykiwany `apiBase` (panel i storefront mają własne
 * endpointy /api/review z własnymi bramkami) — nakładka nie zna Supabase.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { screenFor, stripLocale } from "../screens";
import {
  MAX_ATTACHMENTS,
  type ReviewCommentDto,
  type ReviewSurface,
} from "../schema";
import { REVIEW_CSS } from "./styles";

export interface ReviewOverlayProps {
  surface: ReviewSurface;
  /** Baza endpointów, np. "/api/review". */
  apiBase: string;
}

type Mode = "preview" | "comment";

interface Draft {
  kind: "point" | "area";
  x: number;
  y: number;
  w?: number;
  h?: number;
}

interface DragState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  dragging: boolean;
}

const DRAG_THRESHOLD_PX = 8;
const PRIORITIES = [1, 2, 3, 4, 5] as const;

function useDocumentSize(): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const measure = () =>
      setSize({
        width: document.documentElement.clientWidth,
        height: Math.max(
          document.documentElement.scrollHeight,
          document.body.scrollHeight,
        ),
      });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  return size;
}

/** Bieżąca trasa bez prefiksu locale; śledzi nawigację klienta (App Router). */
function useRoute(): string {
  const [route, setRoute] = useState(() =>
    typeof window === "undefined" ? "/" : stripLocale(window.location.pathname),
  );
  useEffect(() => {
    const update = () => setRoute(stripLocale(window.location.pathname));
    window.addEventListener("popstate", update);
    const interval = window.setInterval(update, 600);
    return () => {
      window.removeEventListener("popstate", update);
      window.clearInterval(interval);
    };
  }, []);
  return route;
}

export function ReviewOverlay({ surface, apiBase }: ReviewOverlayProps) {
  const route = useRoute();
  const { width: docWidth, height: docHeight } = useDocumentSize();
  const [mode, setMode] = useState<Mode>("preview");
  const [showDone, setShowDone] = useState(true);
  const [comments, setComments] = useState<ReviewCommentDto[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const jumpedRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(
        `${apiBase}/comments?surface=${surface}&route=${encodeURIComponent(route)}`,
        { cache: "no-store" },
      );
      // 404 to nie awaria, tylko brak dostępu do ODCZYTU (ADR-206): zapis
      // uwag nie wymaga superadmina, ale przegląd zebranych — tak. Bez
      // sesji superadmina nakładka startuje z pustą listą i pokazuje
      // wyłącznie uwagi utworzone w tej sesji przeglądarki.
      if (response.status === 404) {
        setComments([]);
        return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as { comments: ReviewCommentDto[] };
      setComments(payload.comments);
    } catch (cause) {
      setError(`Nie udało się wczytać uwag (${String(cause)})`);
    }
  }, [apiBase, surface, route]);

  useEffect(() => {
    setDraft(null);
    setOpenId(null);
    void load();
  }, [load]);

  // Skok z widoku PM: #rc-<id> otwiera pinezkę i włącza tryb KOMENTARZ.
  useEffect(() => {
    if (jumpedRef.current || comments.length === 0) return;
    const match = window.location.hash.match(/^#rc-(.+)$/);
    if (!match) return;
    const target = comments.find((comment) => comment.id === match[1]);
    if (!target) return;
    jumpedRef.current = true;
    setMode("comment");
    setOpenId(target.id);
    window.scrollTo({ top: Math.max(0, target.pos_y * docHeight - 200) });
  }, [comments, docHeight]);

  const visible = useMemo(
    () => comments.filter((comment) => comment.status === "open" || showDone),
    [comments, showDone],
  );

  const upsert = useCallback((next: ReviewCommentDto) => {
    setComments((current) => {
      const index = current.findIndex((comment) => comment.id === next.id);
      if (index < 0) return [...current, next];
      const copy = [...current];
      copy[index] = next;
      return copy;
    });
  }, []);

  // --- Zbieranie punktu/obszaru w trybie KOMENTARZ ---

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (mode !== "comment" || draft || openId) {
      // Klik poza popoverem zamyka go — warstwa łapie zdarzenie jako tło.
      if (draft || openId) {
        setDraft(null);
        setOpenId(null);
      }
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({
      startX: event.pageX,
      startY: event.pageY,
      currentX: event.pageX,
      currentY: event.pageY,
      dragging: false,
    });
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    setDrag((current) => {
      if (!current) return current;
      const dragging =
        current.dragging ||
        Math.hypot(event.pageX - current.startX, event.pageY - current.startY) > DRAG_THRESHOLD_PX;
      return { ...current, currentX: event.pageX, currentY: event.pageY, dragging };
    });
  };

  const onPointerUp = () => {
    setDrag((current) => {
      if (!current || docWidth === 0 || docHeight === 0) return null;
      if (current.dragging) {
        const left = Math.min(current.startX, current.currentX);
        const top = Math.min(current.startY, current.currentY);
        const w = Math.abs(current.currentX - current.startX);
        const h = Math.abs(current.currentY - current.startY);
        setDraft({
          kind: "area",
          x: left / docWidth,
          y: top / docHeight,
          w: w / docWidth,
          h: h / docHeight,
        });
      } else {
        setDraft({ kind: "point", x: current.startX / docWidth, y: current.startY / docHeight });
      }
      return null;
    });
  };

  if (typeof document === "undefined") return null;

  const capturing = mode === "comment" && !draft && !openId;
  const openComment = openId ? comments.find((comment) => comment.id === openId) : null;

  return createPortal(
    <div className="avb-rev">
      <style dangerouslySetInnerHTML={{ __html: REVIEW_CSS }} />
      <div
        ref={layerRef}
        className={`avb-rev-layer${mode === "comment" ? " avb-rev-capturing" : ""}`}
        style={{ height: docHeight, cursor: capturing ? "crosshair" : "default" }}
        onPointerDown={mode === "comment" ? onPointerDown : undefined}
        onPointerMove={mode === "comment" && drag ? onPointerMove : undefined}
        onPointerUp={mode === "comment" && drag ? onPointerUp : undefined}
      >
        {mode === "comment" ? (
          <>
            {visible.map((comment) =>
              comment.kind === "area" && comment.area_w != null && comment.area_h != null ? (
                <div
                  key={`area-${comment.id}`}
                  className={`avb-rev-area${comment.status === "done" ? " avb-rev-done" : ""}${
                    comment.status === "done" ? " avb-rev-dim" : ""
                  }`}
                  style={{
                    left: comment.pos_x * docWidth,
                    top: comment.pos_y * docHeight,
                    width: comment.area_w * docWidth,
                    height: comment.area_h * docHeight,
                  }}
                />
              ) : null,
            )}
            {visible.map((comment) => (
              <button
                key={comment.id}
                type="button"
                className={`avb-rev-pin${comment.status === "done" ? " avb-rev-done avb-rev-dim" : ""}`}
                style={{
                  left:
                    (comment.kind === "area" && comment.area_w != null
                      ? comment.pos_x + comment.area_w
                      : comment.pos_x) * docWidth,
                  top: comment.pos_y * docHeight,
                }}
                aria-label={`Uwaga: ${comment.body.slice(0, 60)}`}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => {
                  setDraft(null);
                  setOpenId(comment.id);
                }}
              >
                {comment.status === "done" ? "✓" : comment.priority}
              </button>
            ))}
            {drag?.dragging ? (
              <div
                className="avb-rev-draft-rect"
                style={{
                  left: Math.min(drag.startX, drag.currentX),
                  top: Math.min(drag.startY, drag.currentY),
                  width: Math.abs(drag.currentX - drag.startX),
                  height: Math.abs(drag.currentY - drag.startY),
                }}
              />
            ) : null}
            {draft ? (
              <Composer
                surface={surface}
                route={route}
                apiBase={apiBase}
                draft={draft}
                docWidth={docWidth}
                docHeight={docHeight}
                onSaved={(saved) => {
                  upsert(saved);
                  setDraft(null);
                }}
                onCancel={() => setDraft(null)}
              />
            ) : null}
            {openComment ? (
              <Details
                comment={openComment}
                apiBase={apiBase}
                docWidth={docWidth}
                docHeight={docHeight}
                onChanged={upsert}
                onClose={() => setOpenId(null)}
              />
            ) : null}
          </>
        ) : null}
      </div>

      {/* Pasek znika na czas otwartego popovera/arkusza — na wąskich
          ekranach nachodziłby na bottom sheet. */}
      <div className="avb-rev-toolbar" style={draft || openComment ? { display: "none" } : undefined}>
        {mode === "comment" ? (
          <button
            type="button"
            className="avb-rev-chip"
            data-active={showDone}
            onClick={() => setShowDone((value) => !value)}
          >
            ✓ Rozwiązane {comments.filter((comment) => comment.status === "done").length}
          </button>
        ) : null}
        <button
          type="button"
          className="avb-rev-mode"
          data-active={mode === "comment"}
          aria-pressed={mode === "comment"}
          onClick={() => {
            setMode((value) => (value === "comment" ? "preview" : "comment"));
            setDraft(null);
            setOpenId(null);
          }}
        >
          <span className="avb-rev-dot" aria-hidden />
          {mode === "comment" ? "Komentarz" : "Podgląd"}
          {comments.filter((comment) => comment.status === "open").length > 0
            ? ` · ${comments.filter((comment) => comment.status === "open").length}`
            : ""}
        </button>
        {error ? <div className="avb-rev-error">{error}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

/** Pozycja popovera przy współrzędnych dokumentu, z dociśnięciem do krawędzi. */
function popoverPosition(
  x: number,
  y: number,
  docWidth: number,
): React.CSSProperties {
  const width = Math.min(360, docWidth - 24);
  return {
    left: Math.max(12, Math.min(x - width / 2, docWidth - width - 12)),
    top: y + 14,
  };
}

function Composer({
  surface,
  route,
  apiBase,
  draft,
  docWidth,
  docHeight,
  onSaved,
  onCancel,
}: {
  surface: ReviewSurface;
  route: string;
  apiBase: string;
  draft: Draft;
  docWidth: number;
  docHeight: number;
  onSaved: (saved: ReviewCommentDto) => void;
  onCancel: () => void;
}) {
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState(3);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previews = useMemo(() => files.map((file) => URL.createObjectURL(file)), [files]);
  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews]);

  const addFiles = (incoming: File[]) => {
    const images = incoming.filter((file) => file.type.startsWith("image/"));
    setFiles((current) => [...current, ...images].slice(0, MAX_ATTACHMENTS));
  };

  const save = async () => {
    if (!body.trim()) {
      setError("Wpisz treść uwagi.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set(
        "payload",
        JSON.stringify({
          surface,
          screen: screenFor(surface, route),
          route,
          kind: draft.kind,
          pos_x: draft.x,
          pos_y: draft.y,
          area_w: draft.kind === "area" ? draft.w : undefined,
          area_h: draft.kind === "area" ? draft.h : undefined,
          scroll_y: Math.round(window.scrollY),
          body: body.trim(),
          priority,
        }),
      );
      files.forEach((file) => form.append("images", file));
      const response = await fetch(`${apiBase}/comments`, { method: "POST", body: form });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as { comment: ReviewCommentDto };
      onSaved(payload.comment);
    } catch (cause) {
      setError(`Zapis nie wyszedł (${String(cause)})`);
    } finally {
      setBusy(false);
    }
  };

  const anchorX = (draft.kind === "area" ? draft.x + (draft.w ?? 0) / 2 : draft.x) * docWidth;
  const anchorY = (draft.y + (draft.kind === "area" ? draft.h ?? 0 : 0)) * docHeight;

  return (
    <div
      className="avb-rev-pop"
      style={popoverPosition(anchorX, anchorY, docWidth)}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <h3>{draft.kind === "area" ? "Uwaga do obszaru" : "Nowa uwaga"} · {screenFor(surface, route)}</h3>
      <textarea
        autoFocus
        value={body}
        placeholder="Co poprawić? Wklej obrazek (Ctrl/Cmd+V) albo dodaj z dysku."
        onChange={(event) => setBody(event.target.value)}
        onPaste={(event) => {
          const pasted = Array.from(event.clipboardData.files);
          if (pasted.length > 0) {
            event.preventDefault();
            addFiles(pasted);
          }
        }}
      />
      {previews.length > 0 ? (
        <div className="avb-rev-thumbs">
          {previews.map((url, index) => (
            <span key={url} className="avb-rev-thumb">
              <img src={url} alt={`Obrazek ${index + 1}`} />
              <button
                type="button"
                aria-label="Usuń obrazek"
                onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="avb-rev-row">
        <span className="avb-rev-label">Priorytet</span>
        <span className="avb-rev-prio">
          {PRIORITIES.map((value) => (
            <button
              key={value}
              type="button"
              data-active={priority === value}
              aria-label={`Priorytet ${value}`}
              onClick={() => setPriority(value)}
            >
              {value}
            </button>
          ))}
        </span>
      </div>
      <div className="avb-rev-row">
        <label className="avb-rev-btn avb-rev-secondary" style={{ display: "inline-flex", alignItems: "center", cursor: "pointer" }}>
          Dodaj obrazek
          <input
            type="file"
            accept="image/*"
            multiple
            style={{ display: "none" }}
            onChange={(event) => {
              addFiles(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
        </label>
        <button type="button" className="avb-rev-btn" disabled={busy} onClick={() => void save()}>
          {busy ? "Zapisuję…" : "Zapisz uwagę"}
        </button>
        <button type="button" className="avb-rev-btn avb-rev-secondary" onClick={onCancel}>
          Anuluj
        </button>
      </div>
      {files.length >= MAX_ATTACHMENTS ? (
        <div className="avb-rev-hint">Limit {MAX_ATTACHMENTS} obrazków na uwagę.</div>
      ) : null}
      {error ? <div className="avb-rev-error">{error}</div> : null}
    </div>
  );
}

function Details({
  comment,
  apiBase,
  docWidth,
  docHeight,
  onChanged,
  onClose,
}: {
  comment: ReviewCommentDto;
  apiBase: string;
  docWidth: number;
  docHeight: number;
  onChanged: (next: ReviewCommentDto) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = async (change: { status?: "open" | "done"; priority?: number }) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${apiBase}/comments/${comment.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(change),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as { comment: ReviewCommentDto };
      onChanged(payload.comment);
    } catch (cause) {
      setError(`Zmiana nie wyszła (${String(cause)})`);
    } finally {
      setBusy(false);
    }
  };

  const anchorX =
    (comment.kind === "area" && comment.area_w != null
      ? comment.pos_x + comment.area_w / 2
      : comment.pos_x) * docWidth;
  const anchorY =
    (comment.pos_y + (comment.kind === "area" && comment.area_h != null ? comment.area_h : 0)) *
    docHeight;

  return (
    <div
      className="avb-rev-pop"
      style={popoverPosition(anchorX, anchorY, docWidth)}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="avb-rev-row" style={{ marginTop: 0, justifyContent: "space-between" }}>
        <span className={`avb-rev-status-pill${comment.status === "done" ? " avb-rev-done" : ""}`}>
          {comment.status === "done" ? "✓ Rozwiązane" : "Otwarte"}
        </span>
        <button type="button" className="avb-rev-btn avb-rev-secondary" onClick={onClose}>
          Zamknij
        </button>
      </div>
      <p className="avb-rev-body">{comment.body}</p>
      {comment.attachments.length > 0 ? (
        <div className="avb-rev-thumbs">
          {comment.attachments.map((attachment) => (
            <a key={attachment.id} href={attachment.url} target="_blank" rel="noreferrer">
              <img src={attachment.url} alt="Załącznik uwagi" />
            </a>
          ))}
        </div>
      ) : null}
      <div className="avb-rev-row">
        <span className="avb-rev-label">Priorytet</span>
        <span className="avb-rev-prio">
          {PRIORITIES.map((value) => (
            <button
              key={value}
              type="button"
              data-active={comment.priority === value}
              disabled={busy}
              aria-label={`Priorytet ${value}`}
              onClick={() => void patch({ priority: value })}
            >
              {value}
            </button>
          ))}
        </span>
      </div>
      <div className="avb-rev-row">
        <button
          type="button"
          className="avb-rev-btn"
          disabled={busy}
          onClick={() => void patch({ status: comment.status === "done" ? "open" : "done" })}
        >
          {comment.status === "done" ? "Otwórz ponownie" : "Oznacz rozwiązane"}
        </button>
      </div>
      <div className="avb-rev-meta">
        {comment.screen} · {new Date(comment.created_at).toLocaleString("pl-PL")}
      </div>
      {error ? <div className="avb-rev-error">{error}</div> : null}
    </div>
  );
}
