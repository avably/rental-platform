"use client";

/**
 * PALETA ELEMENTÓW (K3, ADR-086) — kafle przeciągane NA sekcję.
 *
 * Kafel ma DWIE drogi, bo operatorzy mają dwa nawyki i obie są poprawne:
 *   • PRZECIĄGNIĘCIE na płótno — element ląduje tam, gdzie go upuszczono
 *     (z tym samym przyciąganiem, co ruch istniejącego elementu, K2);
 *   • KLIKNIĘCIE — element ląduje pod dotychczasową treścią wybranej sekcji.
 * Druga droga nie jest wygodą: bez niej paleta byłaby niedostępna dla kogoś,
 * kto nie może przeciągać myszą, a przeciąganie nie ma sensownego odpowiednika
 * klawiaturowego przy geometrii absolutnej.
 *
 * Kafel prowadzi WŁASNY gest na surowych zdarzeniach wskaźnika — tak samo jak
 * elementy na płótnie od K2c (ADR-087). Nie idzie przez `DndContext` płótna
 * z prostego powodu: paleta jest jego RODZEŃSTWEM w drzewie, a nie dzieckiem,
 * więc kontekst by jej nie objął. Pierwsza wersja K3 wieszała tu `useDraggable`
 * i kafel po prostu nie dawał się przeciągnąć — klik działał, więc luka
 * przeszła aż do weryfikacji przeglądarkowej recenzji PM.
 */
import { PALETTE_ELEMENT_KINDS, type PaletteElementKind } from "@avably/core/site";
import {
  Heading2,
  Image as ImageIcon,
  MapPin,
  MousePointerClick,
  Sparkles,
  Square,
  Type,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";

/**
 * Próg, po którym wciśnięcie kafla staje się PRZECIĄGNIĘCIEM. Ta sama liczba,
 * co próg gestu płótna — operator ma jedno wyczucie „to już ruch", niezależnie
 * od tego, co akurat chwyta.
 */
const DRAG_THRESHOLD_PX = 4;

const TILE_ICONS: Record<PaletteElementKind, LucideIcon> = {
  heading: Heading2,
  text: Type,
  button: MousePointerClick,
  image: ImageIcon,
  icon: Sparkles,
  shape: Square,
  mapLink: MapPin,
};

export function ElementPalette({
  disabled,
  onAdd,
  onDrop,
}: {
  disabled: boolean;
  /** Kliknięcie kafla — element ląduje pod treścią wybranej sekcji. */
  onAdd: (kind: PaletteElementKind) => void;
  /** Upuszczenie kafla na płótno — element ląduje POD KURSOREM. */
  onDrop: (kind: PaletteElementKind, pointer: { x: number; y: number }) => boolean;
}) {
  const t = useTranslations("site");

  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-[13px] leading-[18px]">{t("builder.tabElementsHint")}</p>
      <ul className="grid list-none grid-cols-2 gap-2 p-0">
        {PALETTE_ELEMENT_KINDS.map((kind) => (
          <li key={kind}>
            <PaletteTile kind={kind} disabled={disabled} onAdd={() => onAdd(kind)} onDrop={onDrop} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function PaletteTile({
  kind,
  disabled,
  onAdd,
  onDrop,
}: {
  kind: PaletteElementKind;
  disabled: boolean;
  onAdd: () => void;
  onDrop: (kind: PaletteElementKind, pointer: { x: number; y: number }) => boolean;
}) {
  const t = useTranslations("site");
  const Icon = TILE_ICONS[kind];
  const label = t(`elementKinds.${kind}`);
  const [dragging, setDragging] = useState(false);

  /**
   * Gest kafla: wciśnięcie przechwytuje wskaźnik, a decyzja zapada przy
   * PUSZCZENIU — jeśli kursor odjechał ponad próg, próbujemy upuścić element
   * pod nim; jeśli nie, `click` dokłada go zwykłą drogą. Przechwycenie jest
   * konieczne, bo kursor wyjeżdża z kafla nad płótno już po pierwszym pikselu.
   */
  function handlePointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (disabled || !event.isPrimary || event.button !== 0) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const target = event.currentTarget;
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // Ta sama ostrożność co w silniku gestów płótna (ADR-087): przechwyt jest
      // ULEPSZENIEM — trzyma ruch przy kaflu, gdy kursor wyjedzie nad płótno.
      // Gdy wskaźnik zniknął między wciśnięciem a tą linijką (albo zdarzenie
      // przyszło z automatu), wyjątek nie może zabić całego gestu.
    }
    let moved = false;

    const move = (pointer: PointerEvent) => {
      if (!moved && Math.hypot(pointer.clientX - startX, pointer.clientY - startY) > DRAG_THRESHOLD_PX) {
        moved = true;
        setDragging(true);
      }
    };
    const finish = (pointer: PointerEvent) => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", finish);
      target.removeEventListener("pointercancel", finish);
      setDragging(false);
      if (moved) onDrop(kind, { x: pointer.clientX, y: pointer.clientY });
    };

    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", finish);
    target.addEventListener("pointercancel", finish);
  }

  return (
    <button
      type="button"
      data-element-tile={kind}
      aria-label={label}
      disabled={disabled}
      className={`border-border hover:border-accent focus-visible:border-foreground focus-visible:outline-accent dark:focus-visible:outline-ring flex w-full cursor-grab touch-none flex-col items-center gap-1.5 rounded-lg border p-3 text-center outline-none transition-colors [transition-duration:var(--motion-fast)] focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50 ${
        dragging ? "opacity-50" : ""
      }`}
      onPointerDown={handlePointerDown}
      onClick={onAdd}
    >
      <Icon className="text-muted-foreground size-5" aria-hidden />
      <span className="text-[13px] leading-[18px] font-medium">{label}</span>
    </button>
  );
}
