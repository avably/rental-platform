/**
 * RENDER PŁÓTNA Z ELEMENTAMI — treść sekcji v2 (K2, ADR-084).
 *
 * Sekcja v2 nie jest formularzem o znanym układzie, tylko PUDEŁKIEM o zadanej
 * wysokości, w którym leżą elementy o współrzędnych. Ten plik jest jedynym
 * miejscem, które zamienia jednostki siatki na CSS — i robi to tak samo dla
 * sklepu i dla płótna kreatora, bo renderer zostaje JEDEN (ADR-083, decyzja 2).
 *
 * ================== MIARA ==================
 *
 * Oś POZIOMA jest procentem szerokości PŁÓTNA (kontener), nigdy okna — to ta
 * sama zasada, którą K1b wprowadził dla wariantów responsywnych (ADR-085).
 * Oś PIONOWA to jednostki po 8 px. Płótno ma sufit szerokości
 * (`CANVAS_DESIGN_WIDTH_PX`) i jest wycentrowane: bez sufitu ten sam układ na
 * monitorze 2560 px rozciągałby wiersze tekstu do nieczytelnej długości.
 *
 * ================== BEZPIECZEŃSTWO UKŁADU ==================
 *
 * Płótno PRZYCINA zawartość (`overflow-hidden`) i tworzy własny kontekst
 * układania (`isolate`). Pierwsze pilnuje, żeby element nie rozjechał
 * publicznej strony ani nie wszedł w sąsiednią sekcję; drugie — żeby warstwa
 * `z` elementu (0…999, treść tenanta) nie mogła przebić się nad interfejs
 * kreatora ani nad dialogi panelu.
 */
import {
  CANVAS_COLUMNS,
  CANVAS_DESIGN_WIDTH_PX,
  GRID_UNIT_PX,
  paintOrder,
  type CanvasElement,
  type Geometry,
  type SectionCanvas,
  type UspIcon,
} from "@avably/core/site";
import {
  BadgeCheck,
  CalendarCheck,
  Clock,
  CreditCard,
  Headphones,
  type LucideIcon,
  MapPin,
  Package,
  ShieldCheck,
  Sparkles,
  Star,
  ThumbsUp,
  Truck,
  Wrench,
} from "lucide-react";
import { Fragment, type CSSProperties, type ReactNode } from "react";

import { cn } from "../lib/cn";
import { ProductCards, siteImageUrl } from "./sections";
import type { TemplateStyles } from "./template";
import type { SiteRenderLabels, StorefrontProduct } from "./types";

const ELEMENT_ICON_COMPONENTS: Record<UspIcon, LucideIcon> = {
  truck: Truck,
  "shield-check": ShieldCheck,
  clock: Clock,
  "badge-check": BadgeCheck,
  wrench: Wrench,
  headphones: Headphones,
  "map-pin": MapPin,
  "credit-card": CreditCard,
  package: Package,
  "calendar-check": CalendarCheck,
  sparkles: Sparkles,
  "thumbs-up": ThumbsUp,
};

/**
 * Klasy szablonu opisują element W PRZEPŁYWIE (marginesy, sufit szerokości),
 * a w pudełku o zadanej geometrii jedno i drugie kłamie: margines przesuwa
 * treść względem współrzędnych, a `max-w-*` zwęża ją niezależnie od `w`.
 * Kasujemy oba — `cn()` scala przez tailwind-merge, więc `m-0`/`max-w-none`
 * wygrywają z tym, co przyszło z szablonu.
 */
function boxed(classes: string, extra?: string): string {
  return cn(classes, "m-0 max-w-none", extra);
}

const ALIGN_CLASS = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
} as const;

const JUSTIFY_CLASS = {
  left: "justify-start",
  center: "justify-center",
  right: "justify-end",
} as const;

/** Geometria (jednostki siatki) → styl pudełka. Jedyne przeliczenie w systemie. */
export function geometryStyle(box: Geometry): CSSProperties {
  return {
    left: `${(box.x / CANVAS_COLUMNS) * 100}%`,
    width: `${(box.w / CANVAS_COLUMNS) * 100}%`,
    top: box.y * GRID_UNIT_PX,
    height: box.h * GRID_UNIT_PX,
    zIndex: box.z,
  };
}

function ElementBody({
  element,
  styles,
  products,
  labels,
  siteImageBase,
}: {
  element: CanvasElement;
  styles: TemplateStyles;
  products: StorefrontProduct[];
  labels: SiteRenderLabels;
  siteImageBase?: string;
}) {
  switch (element.kind) {
    case "heading": {
      const className = boxed(
        element.level === 1
          ? styles.heroHeading
          : element.level === 2
            ? styles.sectionHeading
            : styles.cardTitle,
        ALIGN_CLASS[element.align],
      );
      if (element.level === 1) return <h1 className={className}>{element.text}</h1>;
      if (element.level === 2) return <h2 className={className}>{element.text}</h2>;
      return <h3 className={className}>{element.text}</h3>;
    }
    case "text": {
      const variant =
        element.variant === "lead"
          ? styles.lead
          : element.variant === "small"
            ? "text-muted-foreground text-sm"
            : "text-base";
      return (
        <p className={boxed(variant, cn("whitespace-pre-line", ALIGN_CLASS[element.align]))}>
          {element.text}
        </p>
      );
    }
    case "button":
      return (
        <span className={cn("flex size-full items-center", JUSTIFY_CLASS[element.align])}>
          <a
            href={element.href}
            className={boxed(
              element.variant === "solid"
                ? styles.cta
                : "inline-flex items-center rounded-full border border-current px-6 py-3 text-sm font-medium",
            )}
          >
            {element.label}
          </a>
        </span>
      );
    case "image":
      return element.imagePath && siteImageBase ? (
        <img
          src={siteImageUrl(siteImageBase, element.imagePath)}
          alt={element.alt}
          className={cn(
            "size-full rounded-lg",
            element.fit === "contain" ? "object-contain" : "object-cover",
          )}
          loading="lazy"
        />
      ) : (
        // Bez ścieżki (albo bez bazy URL — podgląd bez Storage) element zostaje
        // w układzie jako kafel zastępczy: geometria jest treścią samą w sobie.
        <div className="bg-muted size-full rounded-lg" aria-hidden="true" />
      );
    case "icon": {
      const Icon = ELEMENT_ICON_COMPONENTS[element.name] ?? Star;
      return (
        <span
          className={cn(
            styles.iconTile,
            "size-full",
            element.tone === "muted" ? "text-muted-foreground" : undefined,
          )}
        >
          <Icon className="size-1/2" aria-hidden="true" />
        </span>
      );
    }
    case "shape":
      if (element.shape === "divider") {
        return (
          <span className="flex size-full items-center" aria-hidden="true">
            <span className="bg-border h-px w-full" />
          </span>
        );
      }
      return (
        <span
          aria-hidden="true"
          className={cn(
            "block size-full rounded-lg",
            element.fill === "paper" && "bg-card border",
            element.fill === "accent" && "bg-primary/10",
            element.fill === "ink" && "bg-foreground",
            element.fill === "none" && "border border-dashed",
          )}
        />
      );
    case "catalog":
      return (
        <div className="size-full overflow-hidden">
          <ProductCards products={products} labels={labels} styles={styles} />
        </div>
      );
    default: {
      // Wyczerpanie unii — nowy rodzaj elementu bez gałęzi zapali typecheck.
      const exhaustive: never = element;
      return exhaustive;
    }
  }
}

/**
 * Tło pasa sekcji. Wysokości NIE niesie tu padding (jak w v1), tylko geometria
 * płótna — dlatego pasy są samym kolorem.
 */
function backgroundClass(canvas: SectionCanvas, styles: TemplateStyles): string | undefined {
  if (canvas.background === "muted") return "bg-muted";
  if (canvas.background === "inverted") return styles.canvasInverted;
  return undefined;
}

export function SectionCanvasRenderer({
  canvas,
  styles,
  products = [],
  labels,
  siteImageBase,
  elementWrapper,
}: {
  canvas: SectionCanvas;
  styles: TemplateStyles;
  products?: StorefrontProduct[];
  labels: SiteRenderLabels;
  siteImageBase?: string;
  /**
   * OWIJKA ELEMENTU — szew bliźniaczy do `sectionWrapper` (ADR-083): kreator
   * wnosi przez niego zaznaczenie, uchwyty rozmiaru i nasłuch przeciągania,
   * a sklep NIE podaje nic i dostaje samo pudełko. Bez tego szwu płótno
   * musiałoby mieć własny render elementów — czyli drugie źródło prawdy o tym,
   * jak wygląda strona.
   */
  elementWrapper?: (element: CanvasElement, children: ReactNode) => ReactNode;
}) {
  return (
    <section data-section-canvas={canvas.version} className={backgroundClass(canvas, styles)}>
      <div
        data-canvas-grid
        className="relative isolate mx-auto w-full overflow-hidden"
        style={{ maxWidth: CANVAS_DESIGN_WIDTH_PX, height: canvas.rows * GRID_UNIT_PX }}
      >
        {paintOrder(canvas.elements).map((element) => {
          const body = (
            <div
              data-element-id={element.id}
              data-element-kind={element.kind}
              className="absolute"
              style={geometryStyle(element.layout.desktop)}
            >
              <ElementBody
                element={element}
                styles={styles}
                products={products}
                labels={labels}
                siteImageBase={siteImageBase}
              />
            </div>
          );
          return (
            <Fragment key={element.id}>
              {elementWrapper ? elementWrapper(element, body) : body}
            </Fragment>
          );
        })}
      </div>
    </section>
  );
}
