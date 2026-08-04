"use client";

/**
 * Galeria „Dodaj sekcję" (kreator A2, ADR-082) — kafelek KAŻDEGO typu (nazwa,
 * jednozdaniowy opis, ikona). Zamknięta lista (13 typów), bez wyszukiwarki.
 * Kliknięcie kafla woła `onAdd(type)`; wstawienie NA POZYCJI ogarnia wołający.
 *
 * Dwa opakowania jednej galerii (K1, ADR-083): `SectionTypeGallery` to sama
 * siatka kafli — stoi wprost w lewej palecie kreatora; `AddSectionDialog` ta
 * sama siatka w modalu, dla „+ Dodaj sekcję" wywoływanego z płótna między
 * sekcjami. Siatka jest JEDNA, bo lista typów i ich opisy mają się rozjeżdżać
 * tylko w jednym miejscu — w `SECTION_TYPES`.
 */
import { SECTION_TYPES, type SectionType } from "@avably/core/site";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@avably/ui";
import {
  AlignLeft,
  HelpCircle,
  Images,
  LayoutGrid,
  type LucideIcon,
  Mail,
  MapPin,
  Megaphone,
  MousePointerClick,
  PanelBottom,
  Quote,
  Sparkles,
  Tag,
  Truck,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";

/** Ikona kafla per typ sekcji (miniatura galerii „Dodaj sekcję"). */
const SECTION_TYPE_ICONS: Record<SectionType, LucideIcon> = {
  hero: Megaphone,
  products: LayoutGrid,
  pricing: Tag,
  faq: HelpCircle,
  contact: Mail,
  freeform: AlignLeft,
  testimonials: Quote,
  gallery: Images,
  usp: Sparkles,
  cta: MousePointerClick,
  directions: MapPin,
  delivery: Truck,
  footer: PanelBottom,
};

/**
 * Próg, po którym wciśnięcie kafla staje się PRZECIĄGNIĘCIEM. Ta sama liczba,
 * co w palecie elementów i w silniku gestów płótna (ADR-087) — operator ma
 * jedno wyczucie „to już ruch", niezależnie od tego, co akurat chwyta.
 */
const DRAG_THRESHOLD_PX = 4;

/** Wskazanie miejsca upuszczenia sekcji przeciąganej z palety (K6, ADR-092). */
export interface SectionDragHandlers {
  /** Ruch nad płótnem — wołane w każdej klatce, ma podświetlić slot docelowy. */
  onDragMove: (pointer: { x: number; y: number }) => void;
  /** Puszczenie nad płótnem — sekcja ma wejść w podświetlone miejsce. */
  onDrop: (type: SectionType, pointer: { x: number; y: number }) => void;
  /** Przerwanie gestu (poza płótnem, `pointercancel`) — zdejmij podświetlenie. */
  onDragEnd: () => void;
}

/**
 * Sama siatka kafli — bez okna. `columns="single"` dla wąskiej palety kreatora,
 * gdzie dwie kolumny zmieniłyby kafle w nieczytelne skrawki.
 *
 * `drag` jest OPCJONALNE i to jest celowe: kafel w palecie da się przeciągnąć
 * na płótno, a ten sam kafel w modalu „+" — nie. W modalu miejsce wstawienia
 * jest już rozstrzygnięte (operator kliknął konkretny slot), a przeciąganie
 * z okna, które zaraz się zamknie, nie ma dokąd prowadzić.
 */
export function SectionTypeGallery({
  onAdd,
  disabled,
  columns = "auto",
  drag,
  unavailable,
}: {
  onAdd: (type: SectionType) => void;
  disabled?: boolean;
  columns?: "auto" | "single";
  drag?: SectionDragHandlers;
  /**
   * Typy, których na tej stronie dołożyć się NIE DA (dziś: stopka, gdy strona
   * już ją ma — ADR-092). Kafel zostaje widoczny, ale wyłączony: znikający
   * kafel kazałby operatorowi zgadywać, czy typ jeszcze istnieje.
   */
  unavailable?: readonly SectionType[];
}) {
  const t = useTranslations("site");

  return (
    <ul
      data-add-section-gallery
      className={`grid list-none grid-cols-1 gap-2 p-0${columns === "auto" ? " sm:grid-cols-2" : ""}`}
    >
      {SECTION_TYPES.map((type) => (
        <li key={type}>
          <SectionTypeTile
            type={type}
            disabled={Boolean(disabled) || (unavailable ?? []).includes(type)}
            label={t(`sectionTypes.${type}`)}
            description={
              (unavailable ?? []).includes(type)
                ? t("sections.alreadyOnPage")
                : t(`sectionTypeDescriptions.${type}`)
            }
            onAdd={() => onAdd(type)}
            drag={drag}
          />
        </li>
      ))}
    </ul>
  );
}

/**
 * Kafel typu sekcji. Gest jest DOSŁOWNYM lustrem kafla palety elementów (K3):
 * przechwycony wskaźnik, próg 4 px, decyzja „klik czy przeciągnięcie" zapada
 * dopiero przy puszczeniu. Powód jest ten sam co tam — paleta jest
 * RODZEŃSTWEM płótna w drzewie, więc `DndContext` płótna jej nie obejmuje.
 *
 * Różnica względem elementu jest jedna, ale istotna: sekcja ma miejsce
 * WSTAWIENIA (przed którą sekcją stanie), a nie współrzędne. Dlatego gest woła
 * `onDragMove` w każdej klatce — podświetlony slot musi obiecywać wynik, zanim
 * operator puści przycisk.
 */
function SectionTypeTile({
  type,
  disabled,
  label,
  description,
  onAdd,
  drag,
}: {
  type: SectionType;
  disabled: boolean;
  label: string;
  description: string;
  onAdd: () => void;
  drag?: SectionDragHandlers;
}) {
  const Icon = SECTION_TYPE_ICONS[type];
  const [dragging, setDragging] = useState(false);

  function handlePointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (!drag || disabled || !event.isPrimary || event.button !== 0) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const target = event.currentTarget;
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // Przechwyt jest ULEPSZENIEM (ADR-087): trzyma ruch przy kaflu, gdy kursor
      // wyjedzie nad płótno. Jego brak nie może zabić gestu.
    }
    let moved = false;

    const move = (pointer: PointerEvent) => {
      if (!moved && Math.hypot(pointer.clientX - startX, pointer.clientY - startY) > DRAG_THRESHOLD_PX) {
        moved = true;
        setDragging(true);
      }
      if (moved) drag.onDragMove({ x: pointer.clientX, y: pointer.clientY });
    };
    const finish = (pointer: PointerEvent) => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", finish);
      target.removeEventListener("pointercancel", finish);
      setDragging(false);
      if (!moved) return;
      if (pointer.type === "pointercancel") {
        drag.onDragEnd();
        return;
      }
      drag.onDrop(type, { x: pointer.clientX, y: pointer.clientY });
    };

    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", finish);
    target.addEventListener("pointercancel", finish);
  }

  return (
    <button
      type="button"
      data-add-section-tile={type}
      disabled={disabled}
      className={`border-border hover:border-foreground focus-visible:border-foreground focus-visible:outline-accent dark:focus-visible:outline-ring flex w-full items-start gap-3 rounded-lg border p-3 text-left outline-none transition-colors focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
        drag ? "cursor-grab touch-none active:cursor-grabbing" : "cursor-pointer"
      } ${dragging ? "opacity-50" : ""}`}
      onPointerDown={handlePointerDown}
      onClick={onAdd}
    >
      <span className="text-muted-foreground mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="text-muted-foreground block text-[13px] leading-[18px]">{description}</span>
      </span>
    </button>
  );
}

export function AddSectionDialog({
  trigger,
  onAdd,
  disabled,
}: {
  trigger: ReactNode;
  onAdd: (type: SectionType) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("site");
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("sections.add")}</DialogTitle>
          <DialogDescription>{t("sections.addModalDescription")}</DialogDescription>
        </DialogHeader>
        <SectionTypeGallery
          disabled={disabled}
          onAdd={(type) => {
            onAdd(type);
            setOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
