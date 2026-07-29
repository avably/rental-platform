"use client";

/**
 * SPIKE C0 — wariant B: własny silnik edycji.
 *
 * Cel: pokazać, że pełną edycję inline + reorder bloków + wariant układu daje
 * się zbudować z rzeczy, które JUŻ mamy (design system @avably/ui) i JEDNEJ
 * lekkiej zależności (@dnd-kit, i tak potrzebnej w etapie A1 na reorder sekcji).
 *
 * Kluczowe cechy pod kryteria spike'u:
 *  - kryt.1: stan `content` jest DOSŁOWNIE obiektem `SpikeHeroContent` (jsonb).
 *    Zero formatu pośredniego — zapisujemy `content` wprost do content_draft.
 *  - kryt.2: cały UI edytora stoi na naszych tokenach i komponencie Button.
 *  - kryt.3: contentEditable ma role=textbox + aria-label + focus-visible wg
 *    naszej konwencji (outline 3px accent); reorder bloków działa KLAWIATURĄ
 *    (dnd-kit KeyboardSensor + sortableKeyboardCoordinates), z komunikatami SR.
 *  - kryt.5: teksty idą do renderu jako węzły tekstowe (React escapuje) —
 *    żadnego dangerouslySetInnerHTML.
 */
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@avably/ui";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { useId, useRef, useState } from "react";

import {
  HERO_ALIGNMENTS,
  defaultHeroContent,
  spikeHeroSchema,
  type HeroAlignment,
  type SpikeHeroContent,
} from "../spike-hero-schema";
import { SpikeHero } from "../spike-hero-view";

/** Konwencja focus-visible edytora = konwencja Buttona (outline 3px accent). */
const INLINE_FOCUS =
  "outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring rounded-sm";

/**
 * Pole edytowalne w miejscu. NIEKONTROLOWANE: tekst startowy wchodzi raz przez
 * ref, potem DOM jest źródłem prawdy dla karetki, a my tylko wypychamy zmiany.
 * Dzięki temu React nie przerysowuje węzła przy każdym znaku i karetka nie
 * skacze — klasyczny warunek poprawnego contentEditable.
 */
function InlineEditable({
  initial,
  ariaLabel,
  multiline = false,
  className,
  onChange,
}: {
  initial: string;
  ariaLabel: string;
  multiline?: boolean;
  className?: string;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  return (
    <div
      ref={ref}
      role="textbox"
      aria-label={ariaLabel}
      aria-multiline={multiline}
      tabIndex={0}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      className={`${INLINE_FOCUS} cursor-text ${className ?? ""}`}
      onInput={(event) => onChange(event.currentTarget.textContent ?? "")}
      onKeyDown={(event) => {
        // Pole jednoliniowe: Enter zatwierdza (blur), nie łamie linii.
        if (!multiline && event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
    >
      {initial}
    </div>
  );
}

/** Wiersz bloku „zaleta" — uchwyt DnD (mysz+klawiatura) + inline edycja + usuń. */
function SortableBullet({
  id,
  text,
  index,
  onText,
  onRemove,
}: {
  id: string;
  text: string;
  index: number;
  onText: (value: string) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`border-border bg-card flex items-center gap-2 rounded-md border p-2 ${
        isDragging ? "opacity-60" : ""
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Przenieś blok ${index + 1}: ${text || "pusty"}`}
        className={`${INLINE_FOCUS} text-muted-foreground hover:text-foreground flex size-7 shrink-0 cursor-grab items-center justify-center rounded`}
      >
        <GripVertical className="size-4" aria-hidden="true" />
      </button>
      <InlineEditable
        initial={text}
        ariaLabel={`Treść bloku ${index + 1}`}
        className="min-w-0 flex-1 text-sm"
        onChange={onText}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`Usuń blok ${index + 1}`}
        className="text-muted-foreground hover:text-destructive size-7"
        onClick={onRemove}
      >
        <Trash2 className="size-4" aria-hidden="true" />
      </Button>
    </li>
  );
}

export function CustomEditor() {
  const [content, setContent] = useState<SpikeHeroContent>(defaultHeroContent);
  const bulletSeq = useRef(content.bullets.length + 1);
  const alignGroupLabel = useId();

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function patch(next: Partial<SpikeHeroContent>) {
    setContent((prev) => ({ ...prev, ...next }));
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setContent((prev) => {
      const oldIndex = prev.bullets.findIndex((b) => b.id === active.id);
      const newIndex = prev.bullets.findIndex((b) => b.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return prev;
      return { ...prev, bullets: arrayMove(prev.bullets, oldIndex, newIndex) };
    });
  }

  function addBullet() {
    const id = `b${bulletSeq.current++}`;
    patch({ bullets: [...content.bullets, { id, text: "Nowa zaleta" }] });
  }

  // kryt.1: to jest dokładnie to, co wpadłoby do content_draft. Walidujemy tym
  // samym schematem, którym waliduje server action — bez tłumaczenia formatów.
  const parsed = spikeHeroSchema.safeParse(content);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* KOLUMNA 1 — kontrolki */}
      <div className="flex flex-col gap-6">
        <section className="border-border flex flex-col gap-4 rounded-lg border p-5">
          <h2 className="text-sm font-semibold">Treść (klik = edycja w miejscu)</h2>

          <label className="flex flex-col gap-1.5">
            <span className="text-muted-foreground text-xs font-medium">Nagłówek</span>
            <InlineEditable
              initial={content.heading}
              ariaLabel="Nagłówek hero"
              className="text-lg font-bold"
              onChange={(v) => patch({ heading: v })}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-muted-foreground text-xs font-medium">Podtytuł</span>
            <InlineEditable
              initial={content.subheading ?? ""}
              ariaLabel="Podtytuł hero"
              multiline
              className="text-sm"
              onChange={(v) => patch({ subheading: v || undefined })}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-muted-foreground text-xs font-medium">Tekst przycisku</span>
            <InlineEditable
              initial={content.ctaText ?? ""}
              ariaLabel="Tekst przycisku CTA"
              className="text-sm font-semibold"
              onChange={(v) => patch({ ctaText: v || undefined })}
            />
          </label>
        </section>

        {/* Wariant układu (C3) */}
        <section
          className="border-border flex flex-col gap-3 rounded-lg border p-5"
          role="group"
          aria-labelledby={alignGroupLabel}
        >
          <h2 id={alignGroupLabel} className="text-sm font-semibold">
            Wariant układu — wyrównanie
          </h2>
          <div className="flex flex-wrap gap-2">
            {HERO_ALIGNMENTS.map((option) => (
              <Button
                key={option}
                type="button"
                size="sm"
                variant={content.align === option ? "default" : "secondary"}
                aria-pressed={content.align === option}
                onClick={() => patch({ align: option as HeroAlignment })}
              >
                {option === "left" ? "Lewo" : option === "center" ? "Środek" : "Prawo"}
              </Button>
            ))}
          </div>
        </section>

        {/* Bloki (C1) — reorder myszą i KLAWIATURĄ */}
        <section className="border-border flex flex-col gap-3 rounded-lg border p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Bloki zalet (przeciągnij uchwyt · Spacja+strzałki)</h2>
            <Button type="button" size="sm" variant="secondary" onClick={addBullet}>
              <Plus className="size-4" aria-hidden="true" /> Dodaj
            </Button>
          </div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={content.bullets.map((b) => b.id)} strategy={verticalListSortingStrategy}>
              <ul className="flex list-none flex-col gap-2 p-0">
                {content.bullets.map((bullet, index) => (
                  <SortableBullet
                    key={bullet.id}
                    id={bullet.id}
                    text={bullet.text}
                    index={index}
                    onText={(text) =>
                      setContent((prev) => ({
                        ...prev,
                        bullets: prev.bullets.map((b) => (b.id === bullet.id ? { ...b, text } : b)),
                      }))
                    }
                    onRemove={() =>
                      setContent((prev) => ({
                        ...prev,
                        bullets: prev.bullets.filter((b) => b.id !== bullet.id),
                      }))
                    }
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        </section>

        {/* kryt.1 — dowód: serializacja do jsonb + status Zod */}
        <section className="border-border flex flex-col gap-2 rounded-lg border p-5">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">content_draft (jsonb)</h2>
            <span
              data-zod-status
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                parsed.success
                  ? "bg-status-positive-bg text-status-positive-fg"
                  : "bg-destructive/15 text-destructive"
              }`}
            >
              {parsed.success ? "Zod: valid" : "Zod: invalid"}
            </span>
          </div>
          <pre className="bg-muted overflow-x-auto rounded-md p-3 text-xs leading-relaxed">
            {JSON.stringify(content, null, 2)}
          </pre>
        </section>
      </div>

      {/* KOLUMNA 2 — podgląd na żywo (ten sam render co storefront) */}
      <aside className="flex min-w-0 flex-col gap-3">
        <p className="text-muted-foreground text-[11px] font-semibold tracking-[0.08em] uppercase">
          Podgląd na żywo
        </p>
        <div className="border-border overflow-hidden rounded-lg border" data-spike-preview="custom">
          <SpikeHero content={content} />
        </div>
      </aside>
    </div>
  );
}
