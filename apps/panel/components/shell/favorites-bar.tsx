"use client";

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
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId } from "react";

import { Link, usePathname } from "@/i18n/navigation";
import { findNavItem, matchNavItem, type PanelNavItem } from "@/lib/shell/nav";

import { NAV_ICONS, NAV_ICON_STROKE_WIDTH } from "./nav-icons";
import { useNavFavorites } from "./nav-favorites-provider";

/**
 * PASEK ULUBIONYCH (ADR-232) — skróty do przypiętych ekranów, pod topbarem.
 *
 * SCHOWANY GDY PUSTO (decyzja właściciela): zero przypięć → komponent zwraca
 * `null`, żadnej „zachęty". Stan bierze z `NavFavoritesProvider` — te same
 * ulubione, którymi świecą gwiazdki drzewa, więc odpięcie z paska gasi gwiazdkę
 * i odwrotnie, na żywo.
 *
 * WSPÓŁISTNIENIE Z PASKIEM PRZEWODNIKA (ADR-229): oba stoją pod topbarem, ale
 * pasek ulubionych jest PIERWSZY (bezpośrednio pod belką), a przewodnik POD nim.
 * Ulubione są TRWAŁE, a przewodnik ZNIKA po 7/7 — trzymając trwały element
 * wyżej, jego pozycja się nie przesuwa, gdy przewodnik gaśnie (element trwały
 * nie skacze). Layout renderuje je w tej kolejności.
 *
 * DRAG&DROP: `@dnd-kit/sortable` (już w panelu — kreator), strategia POZIOMA;
 * uchwyt `GripVertical` z `sortableKeyboardCoordinates`, więc kolejność zmienia
 * się też z klawiatury. Mobile: rząd chipów przewija się w poziomie
 * (`overflow-x-auto`), uchwyt zostaje dotykalny (PointerSensor, distance 4).
 */
export function FavoritesBar() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const favorites = useNavFavorites();
  const dndId = useId();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Poza providerem (kontrakty powłoki bez ulubionych) — nic nie renderuje.
  if (!favorites) return null;

  const items = favorites.favorites
    .map((id) => findNavItem(id))
    .filter((item): item is PanelNavItem => item !== undefined);

  // SCHOWANY GDY PUSTO — brak paska, nie pusty pojemnik.
  if (items.length === 0) return null;

  const activeId = matchNavItem(pathname)?.id;

  function handleDragEnd(event: DragEndEvent) {
    if (!favorites) return;
    const ids = favorites.favorites;
    const from = ids.indexOf(String(event.active.id));
    const to = event.over ? ids.indexOf(String(event.over.id)) : -1;
    if (from < 0 || to < 0 || from === to) return;
    favorites.reorder(arrayMove(ids, from, to));
  }

  return (
    <nav
      data-favorites-bar="true"
      aria-label={t("favoritesBar")}
      className="border-border bg-background flex items-center gap-2 overflow-x-auto border-b px-4 py-2 md:px-6"
    >
      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={favorites.favorites} strategy={horizontalListSortingStrategy}>
          <ul className="flex items-center gap-2">
            {items.map((item) => (
              <FavoriteChip
                key={item.id}
                item={item}
                label={t(item.labelKey)}
                current={activeId === item.id}
                onRemove={() => favorites.toggle(item.id)}
                removeLabel={t("unpinScreen", { screen: t(item.labelKey) })}
                dragLabel={t("reorderFavorite", { screen: t(item.labelKey) })}
                disabled={favorites.pending}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </nav>
  );
}

function FavoriteChip({
  item,
  label,
  current,
  onRemove,
  removeLabel,
  dragLabel,
  disabled,
}: {
  item: PanelNavItem;
  label: string;
  current: boolean;
  onRemove: () => void;
  removeLabel: string;
  dragLabel: string;
  disabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const Icon = NAV_ICONS[item.id];

  return (
    <li
      ref={setNodeRef}
      data-favorite-chip={item.id}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`border-border bg-card group flex shrink-0 items-center rounded-md border text-sm ${
        isDragging ? "z-10 opacity-70 shadow-sm" : ""
      } ${current ? "border-accent" : ""}`}
    >
      <button
        type="button"
        data-favorite-drag={item.id}
        aria-label={dragLabel}
        {...attributes}
        {...listeners}
        className="text-muted-foreground flex h-8 cursor-grab touch-none items-center rounded-l-md pr-0.5 pl-1.5 outline-none transition-[color,background-color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:text-foreground focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-[-3px] focus-visible:outline-accent dark:focus-visible:outline-ring"
      >
        <GripVertical aria-hidden="true" className="size-3.5" strokeWidth={NAV_ICON_STROKE_WIDTH} />
      </button>
      <Link
        href={item.href}
        data-favorite-link={item.id}
        aria-current={current ? "page" : undefined}
        className={`flex min-h-8 items-center gap-1.5 py-1 pr-1 font-medium outline-none transition-[color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-[-3px] focus-visible:outline-accent dark:focus-visible:outline-ring ${
          current ? "text-foreground" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        {Icon ? (
          <Icon aria-hidden="true" className="size-4 shrink-0" strokeWidth={NAV_ICON_STROKE_WIDTH} />
        ) : null}
        <span className="whitespace-nowrap">{label}</span>
      </Link>
      <button
        type="button"
        data-favorite-remove={item.id}
        aria-label={removeLabel}
        onClick={onRemove}
        disabled={disabled}
        className="text-muted-foreground mr-0.5 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md outline-none transition-[color,background-color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:bg-muted/60 hover:text-foreground focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-[-3px] focus-visible:outline-accent disabled:cursor-default disabled:opacity-50 dark:focus-visible:outline-ring"
      >
        <X aria-hidden="true" className="size-3.5" strokeWidth={NAV_ICON_STROKE_WIDTH} />
      </button>
    </li>
  );
}
