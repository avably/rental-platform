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
 * Oś PIONOWA od K2c (ADR-087) jest procentem WYSOKOŚCI płótna, a wysokość
 * wynika z szerokości przez proporcję `CANVAS_COLUMNS : rows`. Jednostka siatki
 * jest więc kwadratowa przy KAŻDEJ szerokości, a nie tylko przy projektowej —
 * wcześniej pion stał w stałych 8 px i układ rozjeżdżał się na węższym ekranie.
 * Płótno ma sufit szerokości (`CANVAS_DESIGN_WIDTH_PX`) i jest wycentrowane:
 * bez sufitu ten sam układ na monitorze 2560 px rozciągałby wiersze tekstu do
 * nieczytelnej długości.
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
  normalizeImageSource,
  paintOrder,
  type CanvasElement,
  type Geometry,
  type SectionCanvas,
  type TextRun,
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

/**
 * TREŚĆ SFORMATOWANA — SKŁADANA, NIGDY WSTRZYKIWANA (K3, ADR-086).
 *
 * To jest miejsce, w którym pogrubienie i link operatora stają się znacznikami
 * — i dlatego nie ma tu ani jednego stringa HTML. `<strong>`, `<em>` i `<a>`
 * powstają jako ELEMENTY REACTA, a tekst runu wchodzi jako dziecko tekstowe,
 * czyli jest escape'owany przez React z definicji. Nawet gdyby operator wpisał
 * `<script>alert(1)</script>`, wyświetli się jako napis.
 *
 * `dangerouslySetInnerHTML` NIE MA tu prawa się pojawić — pilnuje tego kontrakt
 * bezpieczeństwa (skan źródeł renderu). Adres linku przeszedł już allowlistę
 * schematów w Zodzie; `rel` domykamy tak samo, jak w pozostałych linkach
 * wychodzących.
 */
function FormattedText({ text, runs }: { text: string; runs?: readonly TextRun[] }) {
  if (!runs || runs.length === 0) return <>{text}</>;
  return (
    <>
      {runs.map((run, index) => {
        let node: ReactNode = run.text;
        if (run.bold) node = <strong>{node}</strong>;
        if (run.italic) node = <em>{node}</em>;
        if (run.href) {
          node = (
            <a href={run.href} className="underline" rel="noreferrer noopener">
              {node}
            </a>
          );
        }
        return <Fragment key={index}>{node}</Fragment>;
      })}
    </>
  );
}

/**
 * Geometria (jednostki siatki) → styl pudełka. Jedyne przeliczenie w systemie.
 *
 * OBIE osie idą w PROCENTACH (K2c, ADR-087) — pozioma względem szerokości
 * płótna, pionowa względem jego wysokości. To nie jest kosmetyka zapisu, tylko
 * warunek kwadratowej siatki: płótno ma proporcję `CANVAS_COLUMNS : rows`
 * (patrz {@link SectionCanvasRenderer}), więc jeden procent wysokości i jeden
 * procent szerokości znaczą tyle samo pikseli przy KAŻDEJ szerokości okna.
 * Wcześniej oś pionowa stała w stałych `GRID_UNIT_PX` i siatka była kwadratowa
 * dokładnie przy jednej szerokości płótna.
 */
export function geometryStyle(box: Geometry, rows: number): CSSProperties {
  const safeRows = rows > 0 ? rows : 1;
  return {
    left: `${(box.x / CANVAS_COLUMNS) * 100}%`,
    width: `${(box.w / CANVAS_COLUMNS) * 100}%`,
    top: `${(box.y / safeRows) * 100}%`,
    height: `${(box.h / safeRows) * 100}%`,
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
      const body = <FormattedText text={element.text} runs={element.runs} />;
      if (element.level === 1) return <h1 className={className}>{body}</h1>;
      if (element.level === 2) return <h2 className={className}>{body}</h2>;
      return <h3 className={className}>{body}</h3>;
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
          <FormattedText text={element.text} runs={element.runs} />
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
    case "image": {
      const source = normalizeImageSource(element);
      const objectFit = element.fit === "contain" ? "object-contain" : "object-cover";
      if (source?.kind === "unsplash") {
        // ATRYBUCJA JEST WARUNKIEM LICENCJI, nie ozdobą — dlatego podpis stoi
        // w tym samym pudełku co zdjęcie i nie da się wystawić jednego bez
        // drugiego. Zdjęcie jest hotlinkowane u dostawcy (świadomie nie
        // kopiujemy go do naszego bucketa).
        return (
          <span className="relative block size-full overflow-hidden rounded-lg">
            <img src={source.url} alt={element.alt} className={cn("size-full", objectFit)} loading="lazy" />
            <span
              data-image-credit
              className="text-background absolute inset-x-0 bottom-0 bg-black/55 px-2 py-1 text-[11px] leading-4"
            >
              <a href={source.authorUrl} rel="noreferrer noopener" className="underline">
                {source.authorName}
              </a>
            </span>
          </span>
        );
      }
      return source?.kind === "storage" && siteImageBase ? (
        <img
          src={siteImageUrl(siteImageBase, source.path)}
          alt={element.alt}
          className={cn("size-full rounded-lg", objectFit)}
          loading="lazy"
        />
      ) : (
        // Bez ścieżki (albo bez bazy URL — podgląd bez Storage) element zostaje
        // w układzie jako kafel zastępczy: geometria jest treścią samą w sobie.
        <div className="bg-muted size-full rounded-lg" aria-hidden="true" />
      );
    }
    case "mapLink":
      // TYLKO ODNOŚNIK — bez osadzania obcych map (ADR-082, podtrzymane
      // w ADR-086). Adres jest treścią, link celem; jedno i drugie widoczne.
      return (
        <span className={cn("flex size-full flex-col justify-center gap-1", ALIGN_CLASS[element.align])}>
          <span className="text-base whitespace-pre-line">{element.address}</span>
          <a href={element.url} target="_blank" rel="noreferrer noopener" className="text-sm underline">
            {element.url}
          </a>
        </span>
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
        data-canvas-rows={canvas.rows}
        className="relative isolate mx-auto w-full overflow-hidden"
        /*
         * WYSOKOŚĆ WYNIKA Z SZEROKOŚCI (K2c, ADR-087). Proporcja
         * `CANVAS_COLUMNS : rows` daje wysokość `rows × (szerokość / kolumny)`,
         * czyli dokładnie `rows` jednostek o boku równym kolumnie — siatka jest
         * kwadratowa przy każdej szerokości, a nie tylko przy projektowej.
         * Stała wysokość w pikselach (`rows × GRID_UNIT_PX`) trzymała pion w
         * miejscu, gdy poziom się zwężał: to ona rozjeżdżała układy na węższych
         * ekranach i sadzała elementy w pasie pod widoczną treścią sekcji.
         */
        style={{ maxWidth: CANVAS_DESIGN_WIDTH_PX, aspectRatio: `${CANVAS_COLUMNS} / ${canvas.rows}` }}
      >
        {paintOrder(canvas.elements).map((element) => {
          const body = (
            <div
              data-element-id={element.id}
              data-element-kind={element.kind}
              className="absolute"
              style={geometryStyle(element.layout.desktop, canvas.rows)}
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
