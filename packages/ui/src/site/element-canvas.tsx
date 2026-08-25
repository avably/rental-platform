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
 * ================== DWA UKŁADY W JEDNYM DRZEWIE (K4, ADR-088) ==================
 *
 * Sekcja niesie geometrię PER BREAKPOINT, a wybór między nimi robi CSS, nie
 * JavaScript: pudełko dostaje oba komplety współrzędnych jako właściwości
 * niestandardowe, a zapytanie kontenera w `site.css` podmienia zestaw poniżej
 * progu 40 rem. Nic tu nie mierzy okna i nic nie czeka na hydrację — sklep
 * wychodzi z serwera od razu w układzie właściwym dla szerokości, na której
 * został osadzony, a płótno kreatora zwężone do 390 px pokazuje DOKŁADNIE to,
 * co dostanie telefon (K1b, ADR-085).
 *
 * Układ mobilny NIE JEST ZAPISANY w treści: liczy go czysta funkcja
 * (`mobileLayoutOf`) przy każdym renderze, a w treści siedzą wyłącznie RĘCZNE
 * poprawki. Dzięki temu element dodany na desktopie pojawia się na telefonie
 * bez niczyjej ręki.
 *
 * ================== PUDEŁKO OBEJMUJE TREŚĆ ==================
 *
 * Wymiar może być jawny (procent płótna) albo `hug` — wtedy w miejsce procentu
 * idzie `max-content`, a pudełko jest dokładnie tym, co widać. Sufit szerokości
 * (`max-width` do prawej krawędzi płótna) pilnuje, żeby długi napis zawinął się
 * zamiast wyjechać poza sekcję.
 *
 * ================== BEZPIECZEŃSTWO UKŁADU ==================
 *
 * Płótno PRZYCINA zawartość (`overflow-hidden`) i tworzy własny kontekst
 * układania (`isolate`). Pierwsze pilnuje, żeby element nie rozjechał
 * publicznej strony ani nie wszedł w sąsiednią sekcję; drugie — żeby warstwa
 * `z` elementu (0…999, treść tenanta) nie mogła przebić się nad interfejs
 * kreatora ani nad dialogi panelu.
 *
 * ================== TREŚĆ NIGDY NIE ZNIKA (ADR-274) ==================
 *
 * Powyższe przycięcie ma cenę, którą audyt UX 2026-08-25 zebrał jako S-11,
 * S-25, S-26 i S-50: pudełko tekstu ma wysokość w JEDNOSTKACH płótna, a sam
 * tekst w pikselach zaciśniętych `clamp()`, więc poniżej pewnej szerokości
 * akapit przestaje się w nim mieścić i albo wchodzi pod sąsiada, albo wypada
 * poza kadr. Do tego warstwa `z` jest liczbą z treści, więc zdjęcie
 * przeciągnięte na nagłówek po prostu go zasłania.
 *
 * Odpowiedź jest w RDZENIU (`@avably/core/site/canvas-render.ts`), bo pyta
 * o nią także płótno kreatora, a ten plik jest miejscem, w którym staje się
 * CSS-em: warstwa idzie z {@link renderLayerZ} (pasmo treści nad pasmem
 * dekoracji), a proporcja płótna z {@link canvasStretchAt} — per pasmo
 * szerokości, bo `calc()` nie umie policzyć łamania tekstu. Geometria zapisana
 * przez najemcę jest przy tym NIETKNIĘTA: obie liczby powstają przy renderze.
 */
import {
  CANVAS_COLUMNS,
  CANVAS_DESIGN_WIDTH_PX,
  MOBILE_DESIGN_WIDTH_PX,
  canvasStretchAt,
  isPublishableElement,
  mobileLayoutOf,
  normalizeImageSource,
  paintOrder,
  renderLayerZ,
  sizeOf,
  type CanvasElement,
  type ElementColor,
  type ElementSize,
  type Geometry,
  type MobileLayout,
  type SectionCanvas,
  type TextRun,
} from "@avably/core/site";
import { Fragment, type CSSProperties, type ReactNode } from "react";

import { cn } from "../lib/cn";
import { sectionBandClass } from "./bands";
import { elementBindings, type ElementBindingResult, type SiteRecordContext } from "./binding-render";
import { externalLinkRel } from "./links";
import { bindOrphans } from "./orphans";
import { FooterMark, ProductCards, siteImageUrl } from "./sections";
import { siteIconComponent } from "./site-icons";
import type { TemplateStyles } from "./template";
import type { SiteLogoRender, SiteRenderLabels, StorefrontProduct } from "./types";

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
 * ROLA KOLORU → KLASA (K5, ADR-090) — domknięcie wady z K3.
 *
 * Model treści niósł `color` na nagłówku i tekście od K3 (ADR-086), a szuflada
 * ustawień w panelu ZAPISYWAŁA go — ale render nigdy go nie czytał. Operator
 * wybierał kolor, widział zapis i nie widział skutku; wada była niema, bo nic
 * się nie wywracało. Ta tablica jest tym brakującym ogniwem.
 *
 * `accent` celuje w klasę arkusza, a nie w wartość: kolor przychodzi ze zmiennej
 * CZYNNEJ, którą arkusz przełącza per pas (site.css), więc ten sam napis czyta
 * się i na papierze, i na atramencie. `inverted` bierze `--background`, czyli
 * dokładnie ten kolor, którym pasy odwrócone i kształt `ink` (`bg-foreground`)
 * malują swój tekst — jedno źródło prawdy o „odwrotności" w obu motywach.
 *
 * `default` jest PUSTE świadomie: brak roli znaczy kolor odziedziczony po pasie,
 * a nie kolor własny. Dopisanie tu `text-foreground` zamroziłoby napis w kolorze
 * strony i wywróciłoby go na pasie odwróconym.
 */
const ELEMENT_COLOR_CLASS = {
  default: undefined,
  muted: "site-text-muted",
  accent: "site-text-accent",
  inverted: "site-text-inverted",
  onScrim: "site-text-on-scrim",
} as const satisfies Record<ElementColor, string | undefined>;

function colorClass(color: ElementColor | undefined): string | undefined {
  return color ? ELEMENT_COLOR_CLASS[color] : undefined;
}

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
  /*
   * Sieroty (S-47): jednoliterowy spójnik dostaje twardą spację w chwili
   * renderu — PER RUN, bo run jest granicą formatowania i tekst nie ma prawa
   * jej przekroczyć. Spójnik na SZWIE runów (koniec jednego, słowo w drugim)
   * zostaje łamliwy świadomie: szew to decyzja formatowania operatora,
   * a klejenie przez nią wymagałoby ruszania cudzych przebiegów.
   */
  if (!runs || runs.length === 0) return <>{bindOrphans(text)}</>;
  return (
    <>
      {runs.map((run, index) => {
        let node: ReactNode = bindOrphans(run.text);
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

/**
 * Geometria → WŁAŚCIWOŚCI NIESTANDARDOWE pudełka (K4, ADR-088).
 *
 * Dwa komplety (`--el-*` dla desktopu, `--el-m*` dla telefonu) jadą w jednym
 * atrybucie `style`, a wybór między nimi robi zapytanie kontenera w arkuszu.
 * Wartości MUSZĄ być stringami — silnik nie zna typu właściwości
 * niestandardowej, więc goła liczba zostałaby wstawiona bez jednostki.
 *
 * `hug` zamienia wymiar na `max-content`: pudełko jest wtedy dokładnie tym, co
 * widać, a nie prostokątem, w którym treść leży gdzieś w środku. Sufit
 * szerokości sięga prawej krawędzi płótna — długi napis ma się ZAWINĄĆ, a nie
 * wyjechać poza sekcję.
 */
export function boxVariables(
  box: Geometry,
  rows: number,
  size: ElementSize,
  breakpoint: "desktop" | "mobile",
  /**
   * WARSTWA RENDERU (ADR-274) — liczba z {@link renderLayerZ}, a nie `box.z`.
   *
   * Zapisane `z` zostaje w danych i dalej rozstrzyga kolejność WEWNĄTRZ pasma;
   * o tym, czy element maluje się nad napisem, decyduje jego ROLA. Domyślka
   * (`box.z`) jest dla wołających spoza renderu strony — kreator podstawia tu
   * własną warstwę edycyjną i geometrii używa wyłącznie do pudełka.
   */
  layer: number = box.z,
): Record<string, string> {
  const safeRows = rows > 0 ? rows : 1;
  const prefix = breakpoint === "mobile" ? "--el-m" : "--el-";
  const left = (box.x / CANVAS_COLUMNS) * 100;
  return {
    [`${prefix}x`]: `${left}%`,
    [`${prefix}y`]: `${(box.y / safeRows) * 100}%`,
    [`${prefix}w`]: size.w === "hug" ? "max-content" : `${(box.w / CANVAS_COLUMNS) * 100}%`,
    [`${prefix}h`]: size.h === "hug" ? "max-content" : `${(box.h / safeRows) * 100}%`,
    [`${prefix}maxw`]: `${100 - left}%`,
    [`${prefix}z`]: String(layer),
  };
}

/**
 * PASMA WIDTHOWE ROZCIĄGNIĘCIA PŁÓTNA (ADR-274).
 *
 * Rozciągnięcie zależy od SZEROKOŚCI płótna, a CSS nie umie policzyć „ile
 * wierszy złamie się przy tej szerokości" — potrzebny byłby iloraz przez
 * długość, którego `calc()` nie zna. Liczy je więc serwer, dla kilku ustalonych
 * szerokości, a zapytanie kontenera wybiera właściwą wartość.
 *
 * Każde pasmo liczy się przy swoim WĘŻSZYM końcu, bo to tam tekst potrzebuje
 * najwięcej miejsca; wewnątrz pasma sekcja bywa więc o kilka procent wyższa,
 * niż musi. Progi MUSZĄ zgadzać się z regułami `@container` w `site.css` —
 * pilnuje ich kontrakt kontenerowy.
 */
export const CANVAS_STRETCH_BANDS = [
  { token: "72", widthPx: 1024 },
  { token: "64", widthPx: 896 },
  { token: "56", widthPx: 768 },
  { token: "48", widthPx: 640 },
] as const;

/** Pasma płótna MOBILNEGO — telefony węższe od projektowych 390 px. */
export const CANVAS_MOBILE_STRETCH_BANDS = [
  { token: "m24", widthPx: 352 },
  { token: "m22", widthPx: 320 },
] as const;

/**
 * Proporcje płótna dla wszystkich pasm — wyłącznie te, w których treść naprawdę
 * potrzebuje więcej miejsca. Pasmo bez rozciągnięcia NIE dostaje właściwości,
 * więc arkusz spada na proporcję projektową i strona zdrowa wygląda dokładnie
 * tak, jak wyglądała (co do bajtu wyjścia).
 */
function stretchVariables(
  elements: readonly CanvasElement[],
  boxOf: (element: CanvasElement) => Geometry,
  rows: number,
  designWidthPx: number,
  bands: readonly { token: string; widthPx: number }[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const band of bands) {
    const stretch = canvasStretchAt(elements, boxOf, rows, band.widthPx, designWidthPx);
    if (stretch <= 1) continue;
    // Zaokrąglenie W GÓRĘ, tak samo jak sam współczynnik: dwie setne jednostki
    // to nic, ale odejmowanie ich od miary, która ma coś zmieścić, to zła
    // strona zaokrąglenia.
    out[`--canvas-ratio-${band.token}`] =
      `${CANVAS_COLUMNS} / ${Math.ceil(rows * stretch * 100) / 100}`;
  }
  return out;
}

/**
 * Klasa wypełnienia pudełka. Treść rozpycha się do krawędzi TYLKO na osiach
 * o wymiarze jawnym — `size-full` w pudełku obejmującym treść znaczyłoby
 * „sto procent z wysokości, która wynika ze mnie", czyli zapętlenie, które
 * przeglądarka rozstrzyga zerem albo zignorowaniem reguły.
 */
function fillClass(size: ElementSize): string | undefined {
  if (size.w === "fixed" && size.h === "fixed") return "size-full";
  if (size.w === "fixed") return "w-full";
  if (size.h === "fixed") return "h-full";
  return undefined;
}

/**
 * SKALA TYPOGRAFII PŁÓTNA (K4, ADR-088) — klasa, nie rozmiar w kodzie.
 *
 * Do K3 tekst elementu szedł skalami szablonu w `rem`, a geometria — procentem
 * płótna. Przy szerokości projektowej to się zgadzało i rozjeżdżało wszędzie
 * indziej: płótno zwężone do 700 px miało pudełka o 40 % mniejsze i tekst
 * niezmieniony, więc akapit wychodził poza swoje pudełko. Skale płótna są więc
 * zaciśnięte do JEDNOSTEK KONTENERA (`cqw` płótna): powyżej pewnej szerokości
 * stoją na rozmiarze projektowym, w dół skalują się razem z geometrią, a przy
 * szerokości telefonu zatrzymują się na rozmiarze CZYTELNYM — i to jest ten sam
 * rozmiar, którym auto-układ mierzy wysokość pudełek (`text-metrics.ts`).
 */
function typeClass(element: CanvasElement): string {
  switch (element.kind) {
    case "heading":
      return element.level === 1
        ? "canvas-type-display"
        : element.level === 2
          ? "canvas-type-heading"
          : "canvas-type-title";
    case "text":
      return element.variant === "lead"
        ? "canvas-type-lead"
        : element.variant === "small"
          ? "canvas-type-small"
          : "canvas-type-body";
    case "button":
      return "canvas-type-small";
    default:
      return "canvas-type-body";
  }
}

/**
 * NAPIS ATRYBUTU — Z KATALOGU, GDY ZWIĄZANY; z treści, gdy nie (faza 3, ADR-163).
 *
 * Sformatowane runy WYPADAJĄ razem z podstawieniem, i to nie jest uproszczenie:
 * `runs` opisują pogrubienia i linki W KONKRETNYM NAPISIE operatora, więc
 * przyłożone do wartości z katalogu wskazywałyby zakresy znaków, których w niej
 * nie ma (a przy krótszej wartości — po prostu inny fragment słowa).
 */
function boundText(
  bindings: ElementBindingResult,
  attribute: string,
  fallback: { text: string; runs?: readonly TextRun[] },
): { text: string; runs?: readonly TextRun[] } {
  const value = bindings.values[attribute];
  if (value?.kind === "text") return { text: value.text };
  return fallback;
}

function ElementBody({
  element,
  size,
  styles,
  products,
  labels,
  siteImageBase,
  bindings,
  currentPath,
  priority = false,
}: {
  element: CanvasElement;
  size: ElementSize;
  styles: TemplateStyles;
  products: StorefrontProduct[];
  labels: SiteRenderLabels;
  siteImageBase?: string;
  /** Wiązania rozwiązane PRZED zbudowaniem węzła — patrz `SectionCanvasRenderer`. */
  bindings: ElementBindingResult;
  /** Publiczna ścieżka bieżącej strony (S-52) — patrz `SectionCanvasRenderer`. */
  currentPath?: string;
  /**
   * Czy TEN element jest pierwszym obrazem strony (S-39 audytu 2026-08-25) —
   * rozstrzyga `SectionCanvasRenderer` z odpowiedzi renderera o całej stronie.
   * Do tej poprawki KAŻDY obraz płótna był `loading="lazy"`, także zdjęcie hero
   * nad zgięciem: element LCP startował dopiero po pierwszym malowaniu.
   */
  priority?: boolean;
}) {
  const fill = fillClass(size);
  const type = typeClass(element);

  switch (element.kind) {
    case "heading": {
      const className = boxed(
        element.level === 1
          ? styles.heroHeading
          : element.level === 2
            ? styles.sectionHeading
            : styles.cardTitle,
        cn(type, ALIGN_CLASS[element.align], colorClass(element.color)),
      );
      const shown = boundText(bindings, "text", element);
      const body = <FormattedText text={shown.text} runs={shown.runs} />;
      if (element.level === 1) return <h1 className={className}>{body}</h1>;
      if (element.level === 2) return <h2 className={className}>{body}</h2>;
      return <h3 className={className}>{body}</h3>;
    }
    case "text": {
      const variant =
        element.variant === "lead"
          ? styles.lead
          : element.variant === "small"
            ? "site-text-muted"
            : undefined;
      const shown = boundText(bindings, "text", element);
      return (
        // Rola koloru idzie OSTATNIA, żeby wygrała z przygaszeniem, które
        // wariant `small` dokłada z definicji (tailwind-merge zostawia
        // ostatnią klasę tej samej właściwości).
        <p
          className={boxed(
            cn(variant, type),
            cn("whitespace-pre-line", ALIGN_CLASS[element.align], colorClass(element.color)),
          )}
        >
          <FormattedText text={shown.text} runs={shown.runs} />
        </p>
      );
    }
    case "button": {
      const label = (
        <a
          href={element.href}
          // Adres pochodzi od najemcy i bywa absolutny — link wychodzący bez
          // `rel` oddawałby obcemu hostowi `window.opener` karty klienta
          // (audyt E1, ADR-094). Kotwice i ścieżki własne zostają bez atrybutu.
          rel={externalLinkRel(element.href)}
          /*
            SELF-LINK (S-52 audytu 2026-08-25): przycisk, którego adres JEST
            bieżącą stroną („Regulamin" w stopce na /regulaminie), dostaje
            `aria-current="page"` i wagę z klasy `aria-[current=page]:` —
            zamiast być klikiem, który przeładowuje tę samą stronę.
          */
          aria-current={currentPath && element.href === currentPath ? "page" : undefined}
          className={boxed(
            element.variant === "solid"
              ? styles.cta
              : "site-cta-secondary inline-flex items-center font-medium",
            cn(type, "aria-[current=page]:font-semibold"),
          )}
        >
          {boundText(bindings, "label", { text: element.label }).text}
        </a>
      );
      // Pudełko OBEJMUJĄCE treść nie ma czego w sobie wyrównywać — jest
      // przyciskiem. Owijka wyrównująca zostaje wyłącznie przy wymiarze jawnym.
      if (!fill) return label;
      return (
        <span className={cn("flex items-center", fill, JUSTIFY_CLASS[element.align])}>{label}</span>
      );
    }
    case "image": {
      const source = normalizeImageSource(element);
      const objectFit = element.fit === "contain" ? "object-contain" : "object-cover";
      const bound = bindings.values.source;
      if (bound?.kind === "image") {
        /*
         * ZDJĘCIE Z KATALOGU (faza 3, ADR-163). Adres jest PEŁNYM publicznym
         * URL-em obiektu bucketa `product-images` — składa go warstwa odczytu,
         * ta sama, która buduje miniaturę kafla. Nie idzie więc przez
         * `siteImageUrl`: prefiks bucketa sekcji doklejony do gotowego adresu
         * dałby ścieżkę, pod którą nie ma nic.
         *
         * Opis alternatywny jedzie RAZEM z adresem (patrz `bindings` w
         * schemacie zdjęcia) — statyczny `alt` obok opisuje zdjęcie, którego
         * na tym elemencie już nie ma.
         */
        return (
          <img
            data-element-bound="source"
            src={bound.url}
            alt={bound.alt}
            className={cn("site-media size-full", objectFit)}
            loading={priority ? "eager" : "lazy"}
            fetchPriority={priority ? "high" : undefined}
          />
        );
      }
      if (source?.kind === "unsplash") {
        // ATRYBUCJA JEST WARUNKIEM LICENCJI, nie ozdobą — dlatego podpis stoi
        // w tym samym pudełku co zdjęcie i nie da się wystawić jednego bez
        // drugiego. Zdjęcie jest hotlinkowane u dostawcy (świadomie nie
        // kopiujemy go do naszego bucketa).
        return (
          <span className="site-media relative block size-full overflow-hidden">
            <img
              src={source.url}
              alt={element.alt}
              className={cn("size-full", objectFit)}
              loading={priority ? "eager" : "lazy"}
              fetchPriority={priority ? "high" : undefined}
            />
            <span
              data-image-credit
              className="site-scrim site-text-inverted absolute inset-x-0 bottom-0 px-2 py-1 text-[11px] leading-4"
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
          className={cn("site-media size-full", objectFit)}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : undefined}
        />
      ) : (
        // Bez ścieżki (albo bez bazy URL — podgląd bez Storage) element zostaje
        // w układzie jako kafel zastępczy: geometria jest treścią samą w sobie.
        <div className="site-placeholder size-full" aria-hidden="true" />
      );
    }
    case "icon": {
      const Icon = siteIconComponent(element.name);
      // Przy pudełku obejmującym treść rozmiar kafelka bierze się ze SKALI
      // PŁÓTNA (`canvas-icon`), a nie ze stałej szablonu: ikona w `rem` nie
      // malała razem z płótnem i wchodziła na tytuł pod sobą.
      return (
        <span
          className={cn(
            styles.iconTile,
            fill ?? "canvas-icon",
            element.tone === "muted" ? "site-text-muted" : undefined,
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
            <span className="site-divider h-px w-full" />
          </span>
        );
      }
      return (
        <span
          aria-hidden="true"
          className={cn(
            "block size-full",
            element.fill === "paper" && "site-card",
            // Kształt akcentowy bierze akcent STRONY, nie kolor panelu (K5,
            // ADR-090) — alfa zostaje ta sama, którą liczy bramka kontrastu.
            element.fill === "accent" && "site-shape-accent",
            element.fill === "ink" && "site-band-inverted site-media",
            // WELON pod tekstem na zdjęciu: półprzezroczysta powłoka w kolorze
            // najciemniejszego pasa motywu. Jedyny kształt, który ma stać NAD
            // zdjęciem i pod tekstem — i jedyny, którego kontrast liczy się do
            // mieszaniny, a nie do koloru (patrz SCRIM_ALPHA w core).
            element.fill === "scrim" && "site-scrim",
            element.fill === "none" && "site-outline",
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
 * KOMPLET zmiennych pudełka elementu — oba breakpointy naraz, dokładnie tak,
 * jak układa je render (niżej). Wystawione, bo kreator MUSI umieć postawić
 * własną owijkę (edycja w miejscu) w TYM SAMYM pudełku: własne przeliczenie
 * współrzędnych rozjeżdżało się z tym i przesuwało tekst w chwili wejścia
 * w edycję (pinezka właściciela 2026-08-03).
 */
/**
 * CZY ELEMENT JEST TŁEM PEŁNOEKRANOWYM (aneks do ADR-088).
 *
 * Reguła jest w GEOMETRII, nie w nowym polu treści: element, który zajmuje CAŁĄ
 * szerokość płótna i leży pod treścią, jest tłem — nic innego nie ma powodu tak
 * stać. Dzięki temu istniejące szablony (hero na pełnym kadrze z welonem)
 * dostają zachowanie bez zmiany ani jednego bajtu zapisanej treści, a operator
 * uzyskuje je, rozciągając zdjęcie do krawędzi płótna.
 *
 * Zawężenie do zdjęcia i kształtu jest celowe: tekst rozciągnięty na całą
 * szerokość ma zostać w kolumnie czytelności, bo linia na 1600 px jest nie do
 * czytania — a to jest właśnie ta granica, o którą prosił właściciel
 * („treść zostaje w kolumnie").
 */
export function bleedsToEdges(element: CanvasElement): boolean {
  if (element.kind !== "image" && element.kind !== "shape") return false;
  const box = element.layout.desktop;
  return box.x === 0 && box.w === CANVAS_COLUMNS;
}

export function canvasBoxVariables(
  element: CanvasElement,
  rows: number,
  mobile: { rows: number; boxes: Record<string, Geometry> },
  /** Warstwy renderu per breakpoint — patrz {@link boxVariables}. */
  layers?: { desktop: Record<string, number>; mobile: Record<string, number> },
): Record<string, string> {
  const size = sizeOf(element);
  return {
    ...boxVariables(
      element.layout.desktop,
      rows,
      size,
      "desktop",
      layers?.desktop[element.id] ?? element.layout.desktop.z,
    ),
    ...boxVariables(
      mobile.boxes[element.id] ?? element.layout.desktop,
      mobile.rows,
      size,
      "mobile",
      layers?.mobile[element.id] ?? element.layout.desktop.z,
    ),
  };
}

export function SectionCanvasRenderer({
  canvas,
  styles,
  products = [],
  record,
  labels,
  siteImageBase,
  elementWrapper,
  mobile: providedMobile,
  as = "section",
  mark = null,
  currentPath,
  imagePriority = false,
}: {
  canvas: SectionCanvas;
  styles: TemplateStyles;
  products?: StorefrontProduct[];
  /**
   * REKORD, NA KTÓRYM STOI STRONA (faza 3, ADR-163) — wejście wiązań
   * `pageProduct`. Podaje go szablon strony produktu (faza 5); powierzchnia bez
   * rekordu strony po prostu go nie ma i takie wiązanie wycina węzeł.
   */
  record?: StorefrontProduct;
  labels: SiteRenderLabels;
  siteImageBase?: string;
  /**
   * Układ mobilny (K4, ADR-088). Domyślnie liczony TU, z tej samej czystej
   * funkcji, co w kreatorze — sklep nie musi o nim wiedzieć. Kreator podaje
   * własną instancję, bo ten sam wynik jest mu potrzebny także do ramek
   * zaznaczenia i do gestu; liczenie go dwa razy dałoby ten sam obiekt, ale
   * dwa razy.
   */
  mobile?: MobileLayout;
  /**
   * OWIJKA ELEMENTU — szew bliźniaczy do `sectionWrapper` (ADR-083): kreator
   * wnosi przez niego zaznaczenie, uchwyty rozmiaru i nasłuch przeciągania,
   * a sklep NIE podaje nic i dostaje samo pudełko. Bez tego szwu płótno
   * musiałoby mieć własny render elementów — czyli drugie źródło prawdy o tym,
   * jak wygląda strona.
   */
  elementWrapper?: (element: CanvasElement, children: ReactNode) => ReactNode;
  /**
   * ZNACZNIK POWŁOKI (K6, ADR-092). Płótno jest jedno dla wszystkich typów
   * sekcji, ale nie każda sekcja jest `<section>`: stopka to ROLA W DOKUMENCIE
   * i czytnik ekranu ma prawo ją znaleźć jako `contentinfo`. Rozstrzyga o tym
   * TYP sekcji, który zna wołający — płótno o typie nie wie i wiedzieć nie musi.
   */
  as?: "section" | "footer";
  /**
   * ZNAK FIRMY NAJEMCY POD SIATKĄ (ADR-167) — piąty szew warstwy danych, wnoszony
   * tą samą drogą co `siteImageBase`: znak jest własnością NAJEMCY, więc nie ma
   * go w treści żadnej sekcji.
   *
   * Płótno nie zna ani przełącznika najemcy, ani reguły „czy ta stopka znak
   * przyjmie" — rozstrzyga je wołający (`SectionSwitch`), a tu przychodzi już
   * albo gotowy znak, albo `null`. To jest ten sam podział, którym ADR-160
   * rozdzielił `footerLogo`: pakiet UI dostaje decyzję, a nie dane do decyzji.
   */
  mark?: SiteLogoRender | null;
  /**
   * PUBLICZNA ŚCIEŻKA BIEŻĄCEJ STRONY (S-52 audytu 2026-08-25) — przycisk
   * płótna o dokładnie tym adresie dostaje `aria-current="page"`. Podaje ją
   * wyłącznie sklep; płótno kreatora i podgląd nie podają nic.
   */
  currentPath?: string;
  /**
   * CZY TA SEKCJA NIESIE PIERWSZY OBRAZ STRONY (S-39 audytu 2026-08-25).
   *
   * Rozstrzyga renderer strony (`../image-priority`), bo „pierwsza" jest
   * własnością całej listy sekcji. Płótno zamienia tę odpowiedź na wskazanie
   * KONKRETNEGO elementu — pierwszego obrazu w kolejności malowania — bo sekcja
   * bywa kolażem kilku zdjęć, a priorytet ma dostać dokładnie jedno.
   */
  imagePriority?: boolean;
}) {
  /*
   * WIĄZANIA ROZWIĄZANE RAZ, PRZED ZBUDOWANIEM DRZEWA (faza 3, ADR-163).
   *
   * Tu, a nie w `ElementBody`, z dwóch powodów. Pierwszy: WYCIĘCIE musi zdjąć
   * cały węzeł, a nie jego wnętrze — element ma pudełko ze zmiennymi geometrii
   * i tło, więc „pusty w środku" byłby dalej widoczny. Drugi: ta funkcja biegnie
   * na SERWERZE (sklep jest `force-dynamic`), więc wycięty element nie jedzie do
   * przeglądarki ani w kodzie strony, ani w danych hydracji.
   */
  const recordContext: SiteRecordContext = { products, record };
  const bound = new Map(
    canvas.elements.map((element) => [element.id, elementBindings(element, recordContext)] as const),
  );
  const isCut = (element: CanvasElement): boolean => bound.get(element.id)?.cut === true;
  const bindingsOf = (element: CanvasElement): ElementBindingResult =>
    bound.get(element.id) ?? { cut: false, values: {} };

  /*
   * RUSZTOWANIE KREATORA NIE JEDZIE DO KLIENTA (S-50 audytu 2026-08-25).
   *
   * Kafel zdjęcia bez zdjęcia i element, który został przy treści startowej
   * z palety („Kliknij, żeby napisać własny tekst."), są narzędziem EDYCJI:
   * bez nich nie dałoby się elementu ani zaznaczyć, ani wypełnić. Klient
   * dostawał je jednak tak samo, jak treść — szary prostokąt w hero i zdanie
   * z instrukcji obsługi na opublikowanej stronie.
   *
   * Rozstrzyga OWIJKA ELEMENTU: podaje ją wyłącznie kreator (ADR-083), więc
   * jej brak znaczy „to jest strona, nie edytor". Świadomie NIE idzie to drogą
   * `cut`: węzeł wycięty wiązaniem znika w kreatorze z pudełka i zostaje samą
   * ramką, a rusztowanie ma w kreatorze pozostać WIDOCZNE — inaczej operator
   * traci kafel, w który miał wstawić zdjęcie.
   */
  const editing = Boolean(elementWrapper);
  const isScaffolding = (element: CanvasElement): boolean =>
    !editing && !isPublishableElement(element);

  /*
   * AUTO-UKŁAD MOBILNY LICZY SIĘ Z TREŚCI, KTÓRA NAPRAWDĘ WYJDZIE.
   *
   * Rusztowanie zdjęte z rendera zostawiałoby po sobie DZIURĘ: kolumna
   * telefonu jest ciągiem pudełek jedno pod drugim, więc miejsce zarezerwowane
   * dla kafla, którego nikt nie zobaczy, jest po prostu pustką w środku sekcji.
   * Kreator dostaje układ PEŁNY (podaje własną instancję albo owijkę), bo tam
   * rusztowanie stoi i ma stać dokładnie tam, gdzie stanie treść.
   */
  const mobile =
    providedMobile ??
    mobileLayoutOf(
      editing
        ? canvas
        : { ...canvas, elements: canvas.elements.filter((element) => !isScaffolding(element)) },
    );

  /*
   * WARSTWY RENDERU (ADR-274) — pasmo treści nad pasmem dekoracji, osobno dla
   * każdego breakpointu. Telefon dokłada zatopienie kształtów, którym rolę
   * podkładu wyznaczył AUTOMAT: ich mobilne pudełko obejmuje całą grupę, więc
   * zapisane `z` przestaje o nich cokolwiek mówić.
   */
  /*
   * ZATOPIENIE OMIJA ELEMENTY PEŁNOEKRANOWE — i to nie jest wyjątek, tylko ta
   * sama zasada widziana z drugiej strony.
   *
   * Element rozciągnięty do obu krawędzi renderuje się w WARSTWIE TŁA (aneks do
   * ADR-088), która jako całość leży pod siatką treści — nie ma jak niczego
   * zasłonić. Sensem zatopienia jest podkład, który auto-układ rozciągnął na
   * całą grupę W SIATCE; welon pełnoekranowy nad zdjęciem pełnoekranowym
   * (hero każdego szablonu startowego) jest projektem, a nie kolizją, i
   * zatopiony przestałby przygaszać kadr, na którym stoi.
   */
  const sunkOnMobile = new Set(
    canvas.elements
      .filter((element) => mobile.backdrops.has(element.id) && !bleedsToEdges(element))
      .map((element) => element.id),
  );

  const layers = {
    desktop: renderLayerZ(canvas.elements),
    mobile: renderLayerZ(canvas.elements, sunkOnMobile),
  };

  const bleeding = paintOrder(canvas.elements).filter(
    (element) => bleedsToEdges(element) && !isCut(element) && !isScaffolding(element),
  );

  /*
   * PIERWSZY OBRAZ TEJ SEKCJI (S-39) — w KOLEJNOŚCI MALOWANIA, czyli w tej
   * samej, w której przeglądarka układa warstwy. W sekcji hero to zdjęcie tła
   * (najniższy `z`), a nie ikonka doklejona nad nim — a właśnie zdjęcie tła
   * jest tam elementem LCP. Węzeł wycięty wiązaniem nie maluje się wcale, więc
   * nie ma po co dawać mu priorytetu.
   */
  const priorityElementId = imagePriority
    ? (paintOrder(canvas.elements).find(
        (element) => element.kind === "image" && !isCut(element) && !isScaffolding(element),
      )?.id ?? null)
    : null;

  const Shell = as;

  return (
    <Shell
      data-section-canvas={canvas.version}
      className={cn("relative overflow-hidden", sectionBandClass(canvas.background, styles))}
    >
      {/*
        TŁO PEŁNOEKRANOWE (aneks do ADR-088). Elementy rozciągnięte na CAŁĄ
        szerokość płótna (zdjęcie hero, welon) wychodzą poza siatkę, bo to ona
        ma sufit szerokości 1152 px — a tło ma sięgać krawędzi okna. Leżą więc
        w osobnej warstwie, dziecku SEKCJI: pion biorą z tych samych zmiennych
        (`--el-y`, `--el-h`, per breakpoint), poziom rozciągają na 100 %
        szerokości sekcji. Treść zostaje w siatce, czyli w kolumnie czytelności.
      */}
      {bleeding.length > 0 ? (
        <div
          data-canvas-bleed
          /*
           * `isolate` NIE jest ozdobą. Elementy tła niosą własne `z-index`
           * (zdjęcie 0, welon 1) — bez własnego kontekstu składania te wartości
           * trafiają do kontekstu SEKCJI i welon z `z-index: 1` wychodzi nad
           * siatkę treści, czyli nad tekst hero (złapane w weryfikacji: napis
           * robił się szary, bo leżał POD welonem). `isolation: isolate` zamyka
           * je w tej warstwie, a warstwa jako całość zostaje pod siatką.
           */
          className="pointer-events-none absolute inset-0 isolate"
        >
          {bleeding.map((element) => (
            <div
              key={element.id}
              data-element-id={element.id}
              data-element-kind={element.kind}
              className="canvas-box canvas-bleed"
              style={canvasBoxVariables(element, canvas.rows, mobile, layers) as CSSProperties}
            >
              <ElementBody
                element={element}
                size={sizeOf(element)}
                styles={styles}
                products={products}
                labels={labels}
                siteImageBase={siteImageBase}
                bindings={bindingsOf(element)}
                currentPath={currentPath}
                priority={element.id === priorityElementId}
              />
            </div>
          ))}
        </div>
      ) : null}

      <div
        data-canvas-grid
        /*
         * PODMIOT ANIMACJI WEJŚCIA — WARIANT `block` (E9 + ADR-097).
         *
         * Sekcja v2 nie ma pustego marginesu nad treścią (siatka JEST treścią),
         * więc znacznik nie przesuwa tu strefy ani o piksel. Wariant `block`,
         * a nie `stagger`, bo elementy płótna stoją na współrzędnych
         * absolutnych: kaskada po dzieciach rozsypywałaby układ na oczach
         * czytelnika zamiast go odsłaniać. Znacznik stoi mimo to, bo kontrakt
         * liczy DOKŁADNIE JEDEN podmiot na sekcję: gdyby płótno go nie miało,
         * animacja znikałaby z sekcji v2 po cichu.
         */
        data-section-reveal="block"
        data-canvas-rows={canvas.rows}
        data-canvas-rows-mobile={mobile.rows}
        className="canvas-grid relative isolate mx-auto w-full overflow-hidden"
        /*
         * WYSOKOŚĆ WYNIKA Z SZEROKOŚCI (K2c, ADR-087). Proporcja
         * `CANVAS_COLUMNS : rows` daje wysokość `rows × (szerokość / kolumny)`,
         * czyli dokładnie `rows` jednostek o boku równym kolumnie — siatka jest
         * kwadratowa przy każdej szerokości, a nie tylko przy projektowej.
         * Stała wysokość w pikselach (`rows × GRID_UNIT_PX`) trzymała pion w
         * miejscu, gdy poziom się zwężał: to ona rozjeżdżała układy na węższych
         * ekranach i sadzała elementy w pasie pod widoczną treścią sekcji.
         *
         * Proporcja idzie WŁAŚCIWOŚCIĄ NIESTANDARDOWĄ, bo od K4 są dwie —
         * płótno mobilne jest wyższe (jedna kolumna) i podmienia ją zapytanie
         * kontenera w `site.css`.
         */
        style={
          {
            maxWidth: CANVAS_DESIGN_WIDTH_PX,
            "--canvas-ratio": `${CANVAS_COLUMNS} / ${canvas.rows}`,
            "--canvas-ratio-mobile": `${CANVAS_COLUMNS} / ${mobile.rows}`,
            /*
             * WYSOKOŚĆ SEKCJI ROŚNIE Z TREŚCIĄ (ADR-274). Poniżej szerokości,
             * przy której skala typografii dobija do dolnego końca zacisku,
             * pudełko dalej maleje razem z płótnem, a tekst już nie — akapit
             * przestaje mieścić się w swoim prostokącie i wchodzi pod element
             * niżej albo wypada poza dolną krawędź (płótno przycina). Proporcja
             * płótna jest więc PER PASMO: rozciągnięcie mnoży wysokość, a
             * ponieważ WSZYSTKIE pudełka są jej procentem, układ zostaje
             * proporcjonalny. Przy szerokości projektowej rozciągnięcia nie ma
             * z konstrukcji, więc desktop nie zmienia się ani o piksel.
             */
            ...stretchVariables(
              canvas.elements,
              (element) => element.layout.desktop,
              canvas.rows,
              CANVAS_DESIGN_WIDTH_PX,
              CANVAS_STRETCH_BANDS,
            ),
            ...stretchVariables(
              canvas.elements,
              (element) => mobile.boxes[element.id] ?? element.layout.desktop,
              mobile.rows,
              MOBILE_DESIGN_WIDTH_PX,
              CANVAS_MOBILE_STRETCH_BANDS,
            ),
          } as CSSProperties
        }
      >
        {paintOrder(canvas.elements).map((element) => {
          const size = sizeOf(element);
          /*
           * ELEMENT PEŁNOEKRANOWY MALUJE SIĘ W WARSTWIE TŁA, ALE ZOSTAJE TUTAJ
           * jako miejsce dla warstwy edycyjnej (regres złapany przez PM przy
           * PR #172).
           *
           * Pierwsza wersja odfiltrowywała go z siatki w całości — a to siatka
           * jest jedynym miejscem, przez które kreator wnosi ramkę zaznaczenia
           * (`elementWrapper`, ADR-083). Skutek był jednokierunkową pułapką:
           * rozciągnięcie zdjęcia na pełną szerokość odbierało do niego dostęp
           * NA ZAWSZE — nie dało się go zaznaczyć, podmienić, przeskalować ani
           * usunąć.
           *
           * Odtąd element pełnoekranowy przechodzi przez owijkę z PUSTĄ treścią:
           * maluje się raz (w warstwie tła), a jego ramka rysuje się w siatce,
           * z jego własnej geometrii. Sklep, który owijki nie podaje, nie
           * dostaje w siatce nic — czyli dokładnie tyle, ile ma dostać.
           */
          /*
           * WĘZEŁ WYCIĘTY WIĄZANIEM ZOSTAJE W SIATCE JAKO MIEJSCE DLA WARSTWY
           * EDYCYJNEJ — dokładnie tak, jak element pełnoekranowy niżej, i z tej
           * samej lekcji (regres złapany przez PM przy PR #172).
           *
           * Gdyby wycięty element wypadał z siatki także w kreatorze, wiązanie
           * do pozycji usuniętej z katalogu odbierałoby operatorowi dostęp do
           * elementu NA ZAWSZE: nie dałoby się go zaznaczyć, odwiązać ani
           * skasować. Sklep, który owijki nie podaje, nie dostaje tu nic —
           * czyli dokładnie tyle, ile ma dostać.
           */
          const cut = isCut(element);
          const bleeds = bleedsToEdges(element);
          // Rusztowanie kreatora znika ZE STRONY, a nie z edytora — patrz
          // `isScaffolding` wyżej. Predykat jest fałszywy, gdy owijka jest,
          // więc ta linia nie może zabrać niczego kreatorowi.
          if (isScaffolding(element)) return null;
          if ((bleeds || cut) && !elementWrapper) return null;
          const body = bleeds || cut ? null : (
            <div
              data-element-id={element.id}
              data-element-kind={element.kind}
              className="canvas-box"
              style={canvasBoxVariables(element, canvas.rows, mobile, layers) as CSSProperties}
            >
              <ElementBody
                element={element}
                size={size}
                styles={styles}
                products={products}
                labels={labels}
                siteImageBase={siteImageBase}
                bindings={bindingsOf(element)}
                currentPath={currentPath}
                priority={element.id === priorityElementId}
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
      {mark ? <FooterMark logo={mark} /> : null}
    </Shell>
  );
}
