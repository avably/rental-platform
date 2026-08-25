"use client";

/**
 * SKORUPA KREATORA STRON (K1, ADR-083) — pełny ekran: górny pasek, lewa paleta,
 * płótno, prawa szuflada ustawień sekcji.
 *
 * Kreator stoi POZA powłoką panelu świadomie (grupa `(kreator)`): sidebar i
 * belka odbierałyby płótnu tę część szerokości, w której buduje się stronę, a
 * druga nawigacja obok paska kreatora myliłaby drogę powrotną. Powrót jest
 * JEDEN — „← Panel" w pasku.
 *
 * MUTACJE MAJĄ JEDEN KANAŁ (`run`): jedna tranzycja, jeden wskaźnik stanu
 * zapisu, jeden komunikat błędu. Płótno, paleta i publikacja nie trzymają
 * własnych flag oczekiwania, bo trzy niezależne „Zapisywanie…" na jednym pasku
 * mówiłyby operatorowi mniej niż jedno prawdziwe.
 *
 * ================== CO ZMIENIŁ K2 (ADR-084) ==================
 *
 * COFNIJ/PONÓW przestało być szkieletem: historia operacji PŁÓTNA (geometria,
 * warstwa, kopia i usunięcie elementu, wysokość i tło sekcji) mieszka w
 * `useCanvasEditor` i jest pamięciowa — żyje tyle, co otwarty kreator.
 *
 * AUTOZAPIS geometrii idzie tym samym kanałem, ale BEZ `router.refresh()`
 * (`quiet`): odświeżenie przyniosłoby dokładnie to, co przed chwilą wysłaliśmy,
 * a po drodze podmieniłoby propsy w środku kolejnego przeciągnięcia. Zmiany
 * STRUKTURY (dodanie, usunięcie, kolejność, publikacja) odświeżają jak dotąd,
 * bo tam płótno musi zobaczyć nową listę sekcji.
 *
 * ================== CO ZMIENIŁ K2c (ADR-087) ==================
 *
 * Zapis `quiet` wyszedł też POZA tranzycję — jego `pending` szarzył całe płótno
 * co 700 ms w środku pracy. Blokada zostaje przy operacjach struktury; edycja
 * płótna ma iść bez przerwy między jednym gestem a drugim.
 *
 * ================== CO ZMIENIŁ K3 AUDYTU (ADR-169) ==================
 *
 * WSKAŹNIK MA TRZY STANY, NIE DWA: „Zapisywanie…", „Zapisano" i „Nie zapisano".
 * Do ADR-169 nieudany autozapis płótna gasł przy pierwszej udanej akcji obok,
 * a wskaźnik wracał na „Zapisano" — nad sekcją, której w bazie nie ma. Odtąd
 * `run` ZWRACA wynik, `persist` go czyta, a licznik `editor.unsaved` ma
 * pierwszeństwo przed każdym meldunkiem sukcesu.
 *
 * KOMUNIKAT WYSZEDŁ Z BELKI DO WŁASNEJ WARSTWY. Stał pod paskiem, czyli pod
 * modalną nakładką każdej szuflady i każdego okna — a odmowa autozapisu
 * przychodzi najczęściej właśnie WTEDY, gdy operator coś w szufladzie wpisuje.
 * Komunikat niewidoczny jest w skutkach nie do odróżnienia od cichego zapisu.
 *
 * ================== CO ZMIENIŁ ADR-174 ==================
 *
 * WYJŚCIE „← Panel" CZEKA NA ODPOWIEDŹ ZAPISU. Do ADR-174 link odpalał
 * `editor.flush()` i nawigował w tej samej instrukcji — a `flush()` nie zwracał
 * obietnicy, więc nawigacja ruszała natychmiast. Kreator odmontowywał się,
 * zanim serwer odpowiedział; odmowa nie miała już gdzie się pokazać, bo nie
 * było komponentu, który rysuje komunikat. Ścieżka wyjścia była JEDYNĄ, której
 * ADR-169 nie domknął, i zarazem tą, na której operator najczęściej traci
 * pracę — bo wychodzi w przekonaniu, że skończył.
 *
 * ZAMKNIĘCIE KARTY OSTRZEGA, ALE TYLKO PO ODMOWIE (`beforeunload`). Bramka
 * wisi na `editor.unsaved`, czyli na zbiorze sekcji, które serwer JUŻ odrzucił —
 * nie na kolejce `dirty`. Uzasadnienie stoi przy samym efekcie niżej.
 */
import {
  canvasMetrics,
  clampGeometry,
  createElement,
  defaultSizeOf,
  isPinnedLastType,
  isSectionCanvas,
  isStructuredSection,
  isStructuredType,
  presetContentFor,
  sectionCanvasFrom,
  structuredFromLegacy,
  structuredPresetFor,
  withStructuredLayout,
  type Geometry,
  type PaletteElementKind,
  type SectionContent,
  type SectionType,
  snapMove,
  unitsFromPx,
  type ResolvedSiteStyle,
} from "@avably/core/site";
import {
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TooltipProvider,
  type SiteMoney,
  type StorefrontCategory,
  type StorefrontProduct,
} from "@avably/ui";
import { AlertTriangle, ArrowLeft, Monitor, Redo2, Smartphone, Undo2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";

import { PublishDialog } from "@/components/publish-dialog";
import { Link, useRouter } from "@/i18n/navigation";
import type { EditorSection } from "@/app/[locale]/(panel)/strona/content";
import {
  deleteSection,
  duplicateSection,
  publishSite,
  reorderSections,
  restoreSection,
  toggleSection,
  applyStarterTemplate,
  updateStoreStyle,
  upsertSection,
} from "@/lib/actions/site";

import {
  BuilderCanvas,
  type BuilderSelection,
  type BuilderViewport,
  type ElementSelection,
} from "./builder-canvas";
import { BuilderPalette } from "./builder-palette";
import { TemplateGallery } from "./template-gallery";
import { ImagePicker } from "./image-picker";
import { SectionPicker, type InsertLayout, type InsertTarget } from "./section-picker";
import { SectionSettingsDrawer } from "./section-settings-drawer";
import type { StructuredFormTab } from "./structured-section-form";
import { appendSpotBelow, newElementId, replaceElement, useCanvasEditor } from "./use-canvas-editor";
import { publishWarnings } from "@/lib/publish-warnings";

type ActionResult = { ok: true } | { ok: false; error: string };
/**
 * `published` jest OSOBNYM stanem sukcesu (L6, audyt E2E 2026-08-07): publikacja
 * meldowana wspólnym „Zapisano" była zdaniem prawdziwym dla szkicu i fałszywym
 * dla operacji, która właśnie przestawiła sklep.
 */
type SaveState = "idle" | "saving" | "saved" | "published";
type RunOptions = {
  quiet?: boolean;
  blocking?: boolean;
  /** Jaki stan sukcesu zamelduje wskaźnik — publikacja mówi swoim zdaniem. */
  announce?: "saved" | "published";
};

/**
 * Jak długo świeża sekcja MIGA po wstawieniu (E2). Tyle, żeby przyciągnąć oko
 * i zniknąć, zanim zacznie przeszkadzać — dłuższy błysk zamienia się w drugi,
 * konkurencyjny stan zaznaczenia.
 */
const FLASH_MS = 700;

/**
 * Element czekający na wstawienie — z geometrią (upuszczenie wskazało miejsce)
 * albo bez niej (klik kafla: „pod dotychczasową treścią"). Ten sam kształt
 * niesie pytanie o konwersję sekcji zastanej (K-12), żeby potwierdzenie
 * wstawiało DOKŁADNIE to, o co operator poprosił, a nie „coś podobnego".
 */
type PendingElement = {
  kind: PaletteElementKind;
  sectionId: string;
  geometry?: Geometry;
};

export function SiteBuilder({
  siteId,
  siteName,
  live = false,
  address = "/",
  style,
  sections,
  products,
  categories = [],
  pageRecord,
  pageRecordPinned = false,
  productTemplate = false,
  money,
  importSources,
}: {
  siteId: string;
  /**
   * Nazwa STRONY, którą operator ma otwartą (0048, ADR-093). Przy wielu
   * stronach płótno bez etykiety nie odpowiada na pytanie „którą stronę
   * właśnie edytuję" — a to jest pytanie, które pada najczęściej.
   */
  siteName: string;
  /**
   * WSAD POTWIERDZENIA PUBLIKACJI (L6; kształt po ADR-165): czy TĘ stronę
   * klienci już widzą i pod jakim adresem stanie po publikacji. Stał tu props
   * `liveName` („którą żywą stronę zgasi ta publikacja") — od 0074 publikacja
   * nie gasi żadnej, więc pytanie zniknęło razem z odpowiedzią.
   */
  live?: boolean;
  address?: string;
  /** Styl SZKICU (motyw + akcent + para krojów) — jedyne wejście wyglądu (ADR-090). */
  style: ResolvedSiteStyle;
  sections: EditorSection[];
  products: StorefrontProduct[];
  /**
   * Kategorie do podglądu sekcji „kategorie" (Faza 7) — jak `products`, ale
   * OPCJONALNE: brak = pusta lista, czyli sekcja z samym nagłówkiem. Trasa
   * kreatora podaje je zawsze; testy powierzchni bez kategorii ich nie muszą.
   */
  categories?: StorefrontCategory[];
  /**
   * POZYCJA, NA KTÓREJ STOI TA STRONA (faza 5, ADR-178) — `undefined` na
   * każdej powierzchni, która rekordu strony nie ma (strona główna, treściowa).
   *
   * JEDEN PROPS, DWA SKUTKI, I TO JEST DECYZJA. Jego OBECNOŚĆ znaczy „ta
   * powierzchnia ma rekord strony", więc szuflada pokazuje wtedy — i tylko
   * wtedy — wiązanie do rekordu strony; jego WARTOŚĆ jedzie do podglądu, żeby
   * płótno rysowało prawdziwą nazwę i prawdziwą cenę zamiast powycinanych
   * węzłów. Osobna flaga boolowska obok wartości pozwalałaby im się rozjechać:
   * kontrolka obiecywałaby wiązanie, a podgląd pokazywałby pustkę — czyli
   * dokładnie ten stan, przed którym ostrzega komentarz przy
   * `BINDING_RECORD_KINDS` („kontrolka bez skutku uczy operatora, że
   * ustawienia bywają ozdobą").
   *
   * `undefined` NA SZABLONIE Z PUSTYM KATALOGIEM jest stanem legalnym i tak
   * ma wyglądać: nie ma pozycji, na której szablon mógłby stanąć, więc nie ma
   * czego pokazać ani do czego się wiązać.
   */
  pageRecord?: StorefrontProduct;
  /**
   * PODGLĄD PRZYPIĘTY DO PRODUKTU (faza B, ADR-200): `true` na WYJĄTKU
   * (`sites.product_id` ustawione) — strona dotyczy jednej pozycji, więc
   * przełącznika podglądu nie ma, a pasek mówi, KTÓREJ. Na matce (`false`)
   * operator przełącza pozycję podglądu dropdownem: to sam PODGLĄD, zero
   * zapisu — szablon nie ma prawa nieść w sobie uuid-a pozycji (ADR-178 D6).
   */
  pageRecordPinned?: boolean;
  /**
   * CZY TA STRONA JEST SZABLONEM STRONY PRODUKTU (rola `product`) — dla okna
   * publikacji: zasięg matki to strona KAŻDEGO sprzętu, wyjątku — jednego,
   * a zwykła strona staje pod adresem. Osobno od `pageRecord`, bo szablon
   * z pustym katalogiem rekordu nie ma, a rolę ma dalej.
   */
  productTemplate?: boolean;
  /**
   * WPISY Z INNYCH MODUŁÓW PANELU do skopiowania w mini-CMS (E5, ADR-096) —
   * po nazwie źródła z rejestru typów. Trasa czyta je z bazy i mapuje na
   * kształt wpisu; kreator przenosi je do szuflady i nic o nich nie wie.
   */
  /**
   * WALUTA I ZAPIS KWOT NAJEMCY (E6). Jedna wartość na dwa cele: płótno rysuje
   * nią cennik tak, jak zobaczy go klient, a szuflada przelicza nią to, co
   * operator wpisuje w polu ceny. Rozdzielenie ich na dwa propsy pozwalałoby
   * im się rozjechać — a wtedy podgląd pokazywałby inną walutę niż edytor.
   */
  money: SiteMoney;
  importSources?: Record<string, readonly unknown[]>;
}) {
  const t = useTranslations("site");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  /**
   * DLACZEGO praca nie weszła do bazy (K3, ADR-169). Osobno od `error`, bo
   * `error` kasuje się na starcie KAŻDEJ następnej akcji — a przyczyna
   * niezapisanej sekcji ma zostać na ekranie dokładnie tak długo, jak długo
   * ta sekcja nie jest zapisana. Rysujemy ją wyłącznie przy `editor.unsaved`
   * większym od zera, więc nie ma czego zerować przy sukcesie.
   */
  const [unsavedReason, setUnsavedReason] = useState<string | null>(null);
  /**
   * AKCJA DO PONOWIENIA po ODRZUCONYM promise (L6). Trzymamy argumenty, nie
   * gotową funkcję: handler kliknięcia woła `run` z nich, więc ponowienie
   * przechodzi ten sam kanał (wskaźnik, błąd, odświeżenie) co pierwotny zapis.
   * Ustawia ją WYŁĄCZNIE ścieżka odrzucenia — błąd biznesowy (`ok: false`)
   * odrzuciłby drugie podejście identycznie, więc przycisk obiecywałby
   * naprawę, której nie ma.
   */
  const [retryArgs, setRetryArgs] = useState<{
    action: () => Promise<ActionResult>;
    onFail?: () => void;
    options?: RunOptions;
  } | null>(null);
  /**
   * WYJŚCIE W TOKU (ADR-174) — trwa zapis odpalony kliknięciem „← Panel".
   * Stan istnieje po to, żeby drugie kliknięcie nie odpaliło drugiej wysyłki
   * i żeby pasek nie wyglądał na martwy w czasie, w którym coś się dzieje.
   */
  const [leaving, setLeaving] = useState(false);
  const [viewport, setViewport] = useState<BuilderViewport>("desktop");
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  /**
   * ZAKŁADKA, NA KTÓREJ MA SIĘ OTWORZYĆ SZUFLADA (E8) — albo `undefined`, gdy
   * wołający nie wskazał żadnej („ustawienia sekcji" z paska narzędzi).
   * Trzyma ją SKORUPA, bo to ona zna wszystkie drogi otwarcia; szuflada tylko
   * przenosi wskazanie do mini-CMS-u.
   */
  const [settingsTab, setSettingsTab] = useState<StructuredFormTab | undefined>(undefined);
  /**
   * ZAZNACZENIE W HIERARCHII (E2): sekcja albo element W SEKCJI. Jeden stan na
   * oba poziomy — patrz `BuilderSelection` w `builder-canvas.tsx`.
   */
  const [selection, setSelection] = useState<BuilderSelection | null>(null);
  const [picking, setPicking] = useState<ElementSelection | null>(null);
  /** Sekcja, która przyjmie przeciągany właśnie ELEMENT (K6, ADR-092). */
  const [elementDropSectionId, setElementDropSectionId] = useState<string | null>(null);
  /**
   * PYTANIE O KONWERSJĘ SEKCJI ZASTANEJ NA PŁÓTNO (K-12, audyt UX 2026-08-25) —
   * element czekający na zgodę albo `null`. Zgoda „nie pytaj ponownie" żyje
   * TYLE, CO OTWARTY KREATOR (`skipConvertPrompt`): jest odpowiedzią na
   * uciążliwość jednej sesji pracy, a nie deklaracją operatora o wszystkich
   * przyszłych stronach — trwałe „nie pytaj" byłoby stanem, który trzeba by
   * gdzieś zapisać i którego nie da się cofnąć bez osobnego ekranu.
   */
  const [convertPrompt, setConvertPrompt] = useState<PendingElement | null>(null);
  const [convertRemember, setConvertRemember] = useState(false);
  const [skipConvertPrompt, setSkipConvertPrompt] = useState(false);
  /**
   * Sekcje, które ta sesja już przepisała na płótno. Propsy o tym nie wiedzą:
   * autozapis geometrii idzie kanałem `quiet`, czyli BEZ odświeżenia RSC, więc
   * `section.content` zostaje w starej generacji aż do następnego odczytu trasy.
   * Bez tego zbioru drugi element w tej samej sekcji pytałby o konwersję, która
   * już się wydarzyła.
   */
  const convertedRef = useRef(new Set<string>());
  /**
   * MIEJSCE, w którym otwarto picker (E2), albo `null` przy zamkniętym oknie.
   * Skorupa trzyma to sama, bo to ona zna WSZYSTKIE trzy wejścia: „+" na
   * płótnie, paletę („na końcu strony") i konwersję z szuflady.
   */
  const [insertTarget, setInsertTarget] = useState<InsertTarget | null>(null);
  /** Sekcja, która właśnie weszła — miga i gaśnie (E2). */
  const [flashId, setFlashId] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * GALERIA PUNKTÓW WYJŚCIA (K5 v2, ADR-090; pusta strona od ADR-161). Otwarta
   * z automatu przy PIERWSZEJ wizycie, czyli wtedy, gdy strona nie ma ani
   * jednej sekcji: pusty kreator jest gorszą odpowiedzią na „nie wiem, od czego
   * zacząć" niż sześć gotowych stron. Później wraca przyciskiem
   * „zacznij od nowa".
   *
   * WYBÓR „PUSTA STRONA" ZAMYKA GALERIĘ BEZ ZAPISU i nie zostawia po sobie
   * śladu w bazie — bo nie ma czego zapisywać. Skutek jest jawny i świadomy:
   * po przeładowaniu trasy strona dalej nie ma sekcji, więc galeria otworzy się
   * znowu. Alternatywą byłaby kolumna trzymająca podpowiedź interfejsu („ten
   * operator już wybrał"), czyli stan publiczny w rozumieniu ADR-091 — bliźniak,
   * wpis u strażnika i test za jedno kliknięcie mniej. Pierwsza wstawiona sekcja
   * kończy sprawę sama.
   *
   * ================== CO ZMIENIŁ K-20 (audyt UX 2026-08-25) ==================
   *
   * WARUNEK JEST WYLICZANY, A NIE ZAPAMIĘTANY W CHWILI MONTAŻU. Stało tu
   * `useState(sections.length === 0)`, czyli odpowiedź policzona RAZ — przy
   * pierwszym renderze TEJ INSTANCJI komponentu. Nawigacja klienta między
   * kreatorami dwóch stron nie montuje kreatora od nowa (ten sam komponent w tym
   * samym miejscu drzewa), więc inicjalizator się nie wykonywał: wejście z
   * gotowej strony na świeżą, pustą zostawiało galerię ZAMKNIĘTĄ, a wejście
   * odwrotne potrafiło ją pokazać nad stroną, która sekcje ma. Galeria
   * „pojawiała się losowo" dokładnie dlatego.
   *
   * Odtąd stan trzyma WYŁĄCZNIE wolę operatora (`auto` = jeszcze jej nie
   * wyraził), a widoczność liczy się z niej i z liczby sekcji przy każdym
   * renderze. Zmiana strony resetuje wolę — to jest inna strona i inne pytanie.
   */
  const [galleryChoice, setGalleryChoice] = useState<"auto" | "open" | "closed">("auto");
  const [galleryFor, setGalleryFor] = useState(siteId);
  if (galleryFor !== siteId) {
    setGalleryFor(siteId);
    setGalleryChoice("auto");
  }
  const galleryOpen = galleryChoice === "open" || (galleryChoice === "auto" && sections.length === 0);
  /**
   * POZYCJA PODGLĄDU wybrana w pasku (faza B, ADR-200) — wyłącznie na MATCE.
   * `null` = domyślna z trasy (pierwsza pozycja katalogu). Stan jest CZYSTO
   * KLIENCKI i ulotny: przełącznik zmienia to, na czym operator OGLĄDA
   * szablon, a nie cokolwiek w treści — dlatego nie ma go w żadnym zapisie.
   */
  const [previewRecordId, setPreviewRecordId] = useState<string | null>(null);
  /*
   * REKORD, KTÓRY WIDZI PŁÓTNO I SZUFLADA — jedna wartość dla obu (ta sama
   * zasada, co przy `pageRecord` z trasy: dwie drogi rozjechałyby kontrolkę
   * wiązania z podglądem). Na wyjątku wybór jest ignorowany z konstrukcji
   * (przypięcie); wybór wskazujący pozycję, której już nie ma na liście,
   * degraduje do domyślnej zamiast wycinać węzły.
   */
  const previewRecord = pageRecordPinned
    ? pageRecord
    : previewRecordId !== null
      ? (products.find((product) => product.id === previewRecordId) ?? pageRecord)
      : pageRecord;

  /**
   * Jedyna droga mutacji w kreatorze. Sukces odświeża RSC (`router.refresh`),
   * więc płótno pokazuje zapisany szkic BEZ przeładowania trasy; porażka cofa
   * zmianę optymistyczną i zostawia komunikat. `quiet` zdejmuje odświeżenie —
   * patrz nagłówek pliku (autozapis geometrii).
   */
  const run = useCallback(
    (
      action: () => Promise<ActionResult>,
      onFail?: () => void,
      options?: RunOptions,
      /*
       * WYNIK WRACA DO WOŁAJĄCEGO (K3, ADR-169). Do tej pory `run` niczego nie
       * zwracał, więc autozapis płótna nie miał jak się dowiedzieć, że zapis
       * NIE wszedł — i kolejka kasowała sekcję tak samo po sukcesie, jak po
       * odmowie. Wołający, którzy wyniku nie potrzebują, ignorują go jak dotąd.
       */
    ): Promise<ActionResult> => {
      setError(null);
      setRetryArgs(null);
      setSaveState("saving");

      const settle = (result: ActionResult, refresh: boolean): ActionResult => {
        if (result.ok) {
          setSaveState(options?.announce ?? "saved");
          if (refresh) router.refresh();
        } else {
          setSaveState("idle");
          setError(result.error);
          onFail?.();
        }
        return result;
      };

      /*
       * ODRZUCONY PROMISE ≠ `ok: false` (L6, audyt E2E 2026-08-07). Akcje
       * zwracają porażki jako wynik, ale ich obietnica potrafi zostać
       * ODRZUCONA naprawdę: memberCtx re-rzuca wszystko poza AuthError
       * (site.ts), a transport dokłada własne awarie. Bez tej gałęzi `settle`
       * nie odpalał się wcale — wskaźnik zostawał na „Zapisywanie…" NA ZAWSZE,
       * a operator zamykał kartę w przekonaniu, że edycja jest na serwerze.
       *
       * Rollback optymistyczny (`onFail`) idzie jak przy porażce biznesowej;
       * edycja treści NIE ginie — autozapis nie ma rollbacku (treść zostaje
       * w edytorze), a ponowienie wysyła dokładnie tę samą akcję jeszcze raz.
       */
      const reject = (): ActionResult => {
        const failure = { ok: false as const, error: t("builder.saveFailed") };
        setSaveState("idle");
        setError(failure.error);
        setRetryArgs({ action, onFail, options });
        onFail?.();
        return failure;
      };

      /*
       * ŻADEN ZAPIS NIE BLOKUJE PŁÓTNA — POZA PUBLIKACJĄ (pinezka właściciela
       * 2026-08-03, druga tura po K2c/ADR-087).
       *
       * K2c wyprowadziło z tranzycji zapisy `quiet` (geometria), ale zmiany
       * STRUKTURY — włączenie sekcji, duplikat, usunięcie, przywrócenie,
       * kolejność, wybór szablonu, a od K5 także KAŻDE kliknięcie w panelu
       * „Styl strony" — dalej szły `startTransition`. Jego `pending` jedzie do
       * `busy` płótna i wyłącza wszystko: uchwyty, paski sekcji, ramki
       * elementów. Operator klikał akcent i przez cały odczyt RSC (lokalnie
       * kilkaset ms, na produkcji więcej) miał martwy kreator — dokładnie to,
       * co zgłosił: „za każdym razem po kliknięciu się zapisuje, muszę czekać".
       *
       * Odtąd blokada zostaje WYŁĄCZNIE przy publikacji, bo tam wstrzymanie ma
       * sens merytoryczny: publikacja przenosi komplet stanu widocznego (ADR-091)
       * i druga w locie znaczyłaby dwie prawdy o tym, co jest opublikowane.
       * Reszta idzie w tle, ze wspólnym wskaźnikiem „Zapisywanie…/Zapisano" —
       * on INFORMUJE, a nie zatrzymuje.
       *
       * Czego to NIE psuje: kolejność sekcji zapisuje się KOMPLETEM pozycji
       * (`reorderPlan`), więc dwie operacje w locie kończą się stanem ostatniej,
       * a nie stanem połowicznym; serwer i tak przelicza pozycje od zera.
       */
      if (options?.blocking) {
        return new Promise<ActionResult>((resolve) => {
          startTransition(async () => {
            try {
              resolve(settle(await action(), true));
            } catch {
              resolve(reject());
            }
          });
        });
      }

      return action().then((result) => settle(result, !options?.quiet), reject);
    },
    [router, t],
  );

  const editor = useCanvasEditor({
    sections,
    /*
     * AUTOZAPIS PŁÓTNA MELDUJE KOLEJCE, CZY WSZEDŁ (K3, ADR-169). Zwrócony
     * `false` oznacza, że sekcja WRACA do kolejki i zapala licznik `unsaved` —
     * a przyczynę zatrzymujemy osobno, bo `error` skasuje pierwsza następna
     * akcja, choćby zupełnie niezwiązana.
     */
    persist: useCallback(
      async (section: EditorSection, content: SectionContent) => {
        const result = await run(
          () =>
            upsertSection({
              siteId,
              sectionId: section.id,
              type: section.type,
              content,
            } as Parameters<typeof upsertSection>[0]),
          undefined,
          { quiet: true },
        );
        if (!result.ok) setUnsavedReason(result.error);
        return result.ok;
      },
      [run, siteId],
    ),
  });

  /**
   * WYJŚCIE Z KREATORA CZEKA NA ODPOWIEDŹ ZAPISU (ADR-174).
   *
   * Do ADR-174 stało tu `onClick={() => editor.flush()}` i nawigacja ruszała
   * natychmiast — `flush()` nie zwracał obietnicy, więc nie było na co czekać.
   * Kreator odmontowywał się w trakcie wysyłki, a `settle(id, false)` zapalał
   * licznik w komponencie, którego już nie ma: komunikat wyprowadzony przez
   * ADR-169 aż na `body` nie miał się gdzie pokazać. Operator wychodził
   * przekonany, że zapisał.
   *
   * Odtąd klik NAJPIERW pyta o wynik, a nawiguje dopiero po `true`. Odmowa
   * zostawia operatora na płótnie z komunikatem, przyciskiem „Zapisz ponownie"
   * i treścią, której nie stracił — bo autozapis nie ma rollbacku.
   *
   * KLIK Z MODYFIKATOREM ZOSTAJE PRZEGLĄDARCE (⌘/Ctrl/Shift/Alt, środkowy
   * przycisk): otwiera panel w nowej karcie, więc kreator zostaje otwarty i nie
   * ma czego domykać. Przejęcie takiego kliknięcia zabrałoby operatorowi
   * zachowanie, którego link nauczył go wszędzie indziej.
   */
  function leave(event: React.MouseEvent<HTMLAnchorElement>) {
    if (
      event.defaultPrevented ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    )
      return;
    event.preventDefault();
    // Drugie kliknięcie w trakcie wysyłki nie ma czego dołożyć — kolejka jest
    // już pusta, a druga tura zapisu wysłałaby te same sekcje jeszcze raz.
    if (leaving) return;
    setLeaving(true);
    void editor.flush().then(
      (saved) => {
        setLeaving(false);
        if (saved) router.push("/strona");
      },
      () => setLeaving(false),
    );
  }

  /**
   * ZAMKNIĘCIE KARTY OSTRZEGA — ALE DOPIERO PO ODMOWIE SERWERA (ADR-174).
   *
   * Bramką jest `editor.unsaved`, czyli zbiór sekcji, które serwer JUŻ odrzucił,
   * a NIE kolejka `dirty`. Ta różnica jest całą decyzją:
   *
   *   • `dirty` jest niepuste przez 700 ms po KAŻDYM poprawnym geście, więc
   *     bramka na nim pytałaby przy prawie każdym zamknięciu karty. Dialog
   *     `beforeunload` jest własnym, nietłumaczalnym oknem przeglądarki —
   *     operator nauczyłby się klikać „Opuść" odruchowo i bramka przestałaby
   *     działać dokładnie wtedy, gdy ma znaczenie. To jest ta uciążliwość,
   *     przez którą ostrzeżenia przy zamykaniu mają złą sławę;
   *   • `failed` jest niepuste WYŁĄCZNIE wtedy, gdy zapis został ODRZUCONY —
   *     stan, którego żaden zegar nie naprawi, o którym operator już czyta na
   *     ekranie i który przy zamknięciu karty ginie bezpowrotnie. Przy pracy,
   *     która idzie dobrze, nasłuchu NIE MA W OGÓLE, więc w trybie
   *     deweloperskim nie da się go zobaczyć bez wywołania odmowy.
   *
   * Krótkiego okna `dirty` ta bramka świadomie NIE pilnuje: cena (pytanie po
   * każdym geście) jest wyższa niż strata (ostatnie 700 ms ruchu myszą,
   * odtwarzalne jednym przeciągnięciem).
   */
  useEffect(() => {
    if (editor.unsaved === 0) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Napis jest ignorowany od 2017 (przeglądarki pokazują własny), ale samo
      // jego ustawienie jest w starszych silnikach warunkiem pojawienia się okna.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [editor.unsaved]);

  /**
   * WSTAWIENIE SEKCJI W MIEJSCU WSKAZANYM PRZEZ „+" (E2).
   *
   * Jedno wywołanie, nie dwa. Do E2 dodanie sekcji było parą kroków (wstawka
   * na końcu + `reorderSections` z kompletem pozycji policzonym u KLIENTA),
   * a para kroków przegrywa wyścig: drugie kliknięcie liczy komplet na stanie
   * sprzed pierwszego (K6-delta, ADR-092 decyzja 1b). Odtąd miejsce jedzie
   * z żądaniem jako KOTWICA (`insertBefore` — identyfikator sekcji, nad którą
   * ma stanąć nowa), a układa je serwer na stanie BAZY. Klient nie zapisuje
   * kolejności przy dodawaniu w ogóle.
   *
   * GENERACJA NOWEJ SEKCJI ZALEŻY OD TYPU (E1, ADR-094). Typ z rejestru
   * strukturalnego rodzi się jako treść v3 z presetem swojego typu (FAQ: trzy
   * realne pary pytań) — w wariancie układu WYBRANYM w pickerze; pozostałe —
   * jak dotąd — jako płótno v2 z presetu v1. Rozstrzyga REJESTR, nie lista
   * `if`-ów: kolejny typ strukturalny wchodzi tu bez zmiany ani jednej linii.
   */
  function addSection(
    type: SectionType,
    layout: InsertLayout,
    target: InsertTarget,
    /**
     * Gotowa treść zamiast presetu — dziś jedna droga: konwersja „Przełącz na
     * sekcję 2.0", która PRZENOSI treść starej sekcji (E3). Bez tego parametru
     * konwersja musiałaby być drugim wywołaniem `upsertSection` obok tego,
     * a para kroków przegrywa wyścig (patrz nagłówek tej funkcji).
     */
    content?: unknown,
  ) {
    const treść =
      content ??
      (isStructuredType(type)
        ? (() => {
            const preset = structuredPresetFor(type, locale);
            return layout ? withStructuredLayout(preset, layout) : preset;
          })()
        : sectionCanvasFrom(type, presetContentFor(type, locale)));

    run(async () => {
      const added = await upsertSection({
        siteId,
        type,
        content: treść,
        insertBefore: target.beforeId,
      } as Parameters<typeof upsertSection>[0]);
      if (added.ok) flash(added.sectionId);
      return added;
    });
  }

  /**
   * BŁYSK NA ŚWIEŻEJ SEKCJI (E2). Znacznik zdejmuje się sam — bez tego zostałby
   * na płótnie jako drugi, konkurencyjny stan zaznaczenia. Poprzedni licznik
   * kasujemy, bo dwa dodania pod rząd mają migać po kolei, a nie zgasić się
   * nawzajem w połowie.
   */
  function flash(sectionId: string) {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setFlashId(sectionId);
    flashTimer.current = setTimeout(() => setFlashId(null), FLASH_MS);
  }

  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
  }, []);

  /**
   * ESCAPE WSPINA SIĘ O POZIOM WYŻEJ (E2): element → sekcja → nic.
   *
   * Nasłuch stoi na DOKUMENCIE, a nie na płótnie, bo zaznaczenie sekcji nie
   * przenosi fokusu (klik w tło niczego nie fokusuje) — handler na kontenerze
   * nie dostałby ani jednego zdarzenia.
   *
   * Dwa wyjątki, oba dlatego, że Escape ma tam WŁASNE, mocniejsze znaczenie:
   * otwarte okno (szuflada, picker, dialog usunięcia) zamyka się nim, a edycja
   * tekstu w miejscu — anuluje. Wspinaczka po poziomach zdarzyłaby się wtedy
   * „przy okazji" i operator straciłby zaznaczenie, którego nie chciał puszczać.
   */
  useEffect(() => {
    if (!selection) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector('[role="dialog"], [data-inline-editor]')) return;
      event.preventDefault();
      setSelection((current) =>
        current?.elementId ? { sectionId: current.sectionId } : null,
      );
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selection]);

  /**
   * KOLEJNOŚĆ, KTÓRĄ OPERATOR MA PRZED OCZAMI — czytana z drzewa, nie z
   * propsów: płótno trzyma własny, optymistyczny stan kolejności (K1), więc
   * lista z propsów potrafi być o jeden ruch do tyłu. Potrzebuje tego jedno
   * miejsce — konwersja „Przełącz na sekcję 2.0", która wstawia świeży preset
   * BEZPOŚREDNIO POD starą sekcją (ADR-094, decyzja 5).
   */
  function canvasOrderIds(): string[] {
    return Array.from(
      document.querySelectorAll<HTMLElement>("[data-builder-canvas] [data-canvas-section]"),
    )
      .map((node) => node.getAttribute("data-canvas-section"))
      .filter((id): id is string => Boolean(id));
  }

  /**
   * Sekcja pod kursorem przy przeciąganiu ELEMENTU. Ta sama miara, której
   * używa `dropElementAt` przy puszczeniu — wskazanie i wynik muszą pochodzić
   * z jednego pomiaru, inaczej obrys obiecuje sekcję, a element ląduje obok.
   */
  function elementDropTargetAt(pointer: { x: number; y: number }): string | null {
    const grid = document
      .elementsFromPoint(pointer.x, pointer.y)
      .find((node): node is HTMLElement => node instanceof HTMLElement && node.hasAttribute("data-canvas-grid"));
    const sectionId = grid?.closest<HTMLElement>("[data-canvas-section]")?.getAttribute("data-canvas-section");
    if (!sectionId) return null;
    // Sekcja usunięta w szkicu elementów nie przyjmuje (K5a) — nie obiecujemy
    // celu, którego upuszczenie i tak odrzuci.
    if (sections.find((section) => section.id === sectionId)?.deletedInDraft) return null;
    return sectionId;
  }

  /**
   * Typy, których na tej stronie nie da się dołożyć. Dziś dokładnie jeden
   * przypadek: stopka, gdy strona ma już ŻYWĄ stopkę (unikat częściowy w 0047).
   * Nagrobek się nie liczy — po jego usunięciu w szkicu nowa stopka wejdzie.
   */
  const unavailableTypes = sections.some(
    (section) => isPinnedLastType(section.type) && !section.deletedInDraft,
  )
    ? (["footer"] as const)
    : [];

  /**
   * SEKCJE, KTÓRE MOGĄ PRZYJĄĆ ELEMENT (K-09). Sekcja usunięta w szkicu nie
   * może (K5a, ADR-091): zniknie przy najbliższej publikacji, więc byłby to
   * zapis do kosza. Pusta lista znaczy „paleta elementów nie ma dokąd
   * dokładać" — i wtedy jej kafle są wygaszone, zamiast milczeć po kliknięciu.
   */
  const editableSections = sections.filter((section) => !section.deletedInDraft);

  /**
   * OSTRZEŻENIA PRZED PUBLIKACJĄ (K-13/K-14, audyt UX 2026-08-25) — liczone ze
   * SZKICU W EDYTORZE, a nie z propsów: operator ma zobaczyć stan, który za
   * chwilę wypuści, razem z tym, co zmienił w ciągu ostatnich 700 ms.
   *
   * Ostrzeżenia NIE BLOKUJĄ: przycisk w oknie zostaje aktywny i mówi
   * „Opublikuj mimo to". Sekcja z treścią przykładową i obraz bez źródła są
   * stanami legalnymi — bywają etapem pracy — ale wypuszczone do klientów po
   * cichu są wpadką, o której najemca dowiaduje się od nich.
   */
  const warnings = publishWarnings(
    editableSections.map((section) => ({
      type: section.type,
      enabled: section.enabled,
      content: editor.contentOf(section.id) ?? section.content,
    })),
  );

  /**
   * WSTAWIENIE ELEMENTU — JEDNA DROGA DLA KLIKU I DLA UPUSZCZENIA (K-11/K-12).
   *
   * Brak geometrii znaczy „dołóż POD treścią" (`appendSpotBelow`, patrz tam):
   * pozycja jest zawsze niżej niż najniższy element, a sekcja rośnie, jeśli nie
   * ma dla niej miejsca. Podana geometria pochodzi z upuszczenia i idzie
   * nietknięta — tam operator wskazał miejsce sam.
   */
  function insertElement({ kind, sectionId, geometry }: PendingElement) {
    if (!editor.canvasOf(sectionId)) return;
    const id = newElementId();
    // Sekcja jest już płótnem od tej chwili — nie pytamy o tę samą konwersję
    // drugi raz. Propsy przyniosą nową generację dopiero po odświeżeniu RSC,
    // a autozapis płótna go świadomie nie robi (`quiet`).
    convertedRef.current.add(sectionId);
    editor.mutate(sectionId, (current) => {
      const spot = geometry
        ? { geometry, rows: current.rows }
        : appendSpotBelow(defaultSizeOf(kind, locale), current);
      return {
        ...current,
        rows: spot.rows,
        elements: [...current.elements, createElement(kind, id, spot.geometry, locale)],
      };
    });
    setSelection({ sectionId, elementId: id });
  }

  /**
   * BRAMKA PRZED WSTAWIENIEM (K-09/K-12, audyt UX 2026-08-25).
   *
   * Trzy stany, które do tej poprawki kończyły się MILCZENIEM:
   *
   *   • sekcji nie ma albo jest usunięta w szkicu — kafel nie robił nic
   *     (K5a). Paleta jest odtąd wygaszona, gdy nie ma ani jednej sekcji, więc
   *     tu zostaje wyłącznie zabezpieczenie drogi wywołanej inaczej;
   *   • sekcja jest STRUKTURALNA (v3) — nie ma w niej pudełek i mieć nie
   *     będzie, bo jej treść edytuje się w szufladzie. Klik kafla nie miał
   *     żadnego skutku i żadnego komunikatu;
   *   • sekcja jest ZASTANA (v1) — pierwszy element PRZEPISUJE ją na swobodne
   *     płótno i układ przestaje być automatyczny. To jest zmiana nieodwracalna
   *     w skutkach dla treści (od tej pory pilnuje jej operator, nie renderer),
   *     a zdarzała się bez jednego słowa.
   *
   * Odpowiedź `true` znaczy „przyjęte" — także wtedy, gdy zamiast wstawienia
   * otwiera się pytanie o konwersję: wołający (gest upuszczenia) pyta o to, czy
   * kafel wylądował, a nie o to, czy element jest już na płótnie.
   */
  function requestElement(pending: PendingElement): boolean {
    const section = sections.find((item) => item.id === pending.sectionId);
    if (!section || section.deletedInDraft) return false;
    if (editor.structuredOf(pending.sectionId)) {
      setError(t("builder.elementsStructured"));
      return false;
    }
    if (!editor.canvasOf(pending.sectionId)) return false;
    if (!skipConvertPrompt && convertsSection(section)) {
      setConvertPrompt(pending);
      return true;
    }
    insertElement(pending);
    return true;
  }

  /**
   * Czy dołożenie elementu PRZEPISZE tę sekcję na płótno. Pytamy o treść
   * z PROPSÓW (stan serwera), a nie o szkic: szkic sekcji v1 jest konwertowany
   * do płótna w locie przy samym otwarciu kreatora (`draftOfSection`), więc
   * odpowiadałby „to już płótno" o sekcji, która w bazie jest dalej v1.
   */
  function convertsSection(section: EditorSection): boolean {
    if (convertedRef.current.has(section.id)) return false;
    return !isSectionCanvas(section.content) && !isStructuredSection(section.content);
  }

  /**
   * Dodanie elementu KLIKNIĘCIEM kafla palety (K3). Trafia do sekcji, w której
   * operator ostatnio coś zaznaczył — a gdy nic nie zaznaczył, do PIERWSZEJ
   * sekcji strony. Zgadywanie „gdzieś" byłoby gorsze niż jedna przewidywalna
   * zasada, którą widać po wyniku.
   */
  function addElement(kind: PaletteElementKind) {
    // Sekcja usunięta w szkicu nie przyjmuje elementów (K5a, ADR-091) — zniknie
    // przy najbliższej publikacji, więc byłby to zapis do kosza.
    const target = selection?.sectionId ?? editableSections[0]?.id;
    if (!target) return;
    requestElement({ kind, sectionId: target });
  }

  /**
   * UPUSZCZENIE KAFLA PALETY NA PŁÓTNO (K3, ADR-086).
   *
   * Logika siedzi w SKORUPIE, nie w płótnie, bo paleta jest jej rodzeństwem —
   * `DndContext` płótna obejmuje wyłącznie kolejność sekcji, więc kafel i tak
   * nie mógłby być w nim źródłem przeciągania. Miejsce liczymy z pozycji
   * wskaźnika względem PŁÓTNA sekcji, pod którą wypadł kursor, JEDNĄ KWADRATOWĄ
   * miarą siatki (`canvasMetrics`) w obu osiach — stała wysokość jednostki
   * kładłaby element gdzie indziej, niż pokazywał kursor, na każdej szerokości
   * płótna innej niż projektowa (ADR-087, decyzja 3).
   */
  function dropElementAt(kind: PaletteElementKind, pointer: { x: number; y: number }): boolean {
    const grid = document
      .elementsFromPoint(pointer.x, pointer.y)
      .find((node): node is HTMLElement => node instanceof HTMLElement && node.hasAttribute("data-canvas-grid"));
    const sectionId = grid?.closest<HTMLElement>("[data-canvas-section]")?.getAttribute("data-canvas-section");
    const canvas = sectionId ? editor.canvasOf(sectionId) : undefined;
    if (!grid || !sectionId || !canvas) return false;
    // Upuszczenie na sekcję usuniętą w szkicu nie ma skutku (K5a, ADR-091).
    if (sections.find((section) => section.id === sectionId)?.deletedInDraft) return false;

    /*
     * W WIDOKU TELEFONU upuszczenie NIE wskazuje miejsca (K4, ADR-088).
     * Współrzędne pod kursorem opisują wtedy układ MOBILNY, a nowy element musi
     * dostać geometrię DESKTOPOWĄ — to ona jest źródłem, z którego wyprowadza
     * się telefon. Przeliczenie jednego na drugie byłoby zgadywaniem; element
     * ląduje więc pod treścią wskazanej sekcji, dokładnie tak, jak po
     * kliknięciu kafla, i od razu widać go na obu breakpointach.
     */
    if (viewport === "mobile") {
      return requestElement({ kind, sectionId });
    }

    const box = grid.getBoundingClientRect();
    const metrics = canvasMetrics(grid.clientWidth, canvas.rows);
    const size = defaultSizeOf(kind, locale);
    // Kafel „chwyta się" środkiem — bez odjęcia połowy pudełka element
    // wyskakiwałby w prawo i w dół od kursora.
    const raw = {
      x: unitsFromPx(pointer.x - box.left, metrics) - size.w / 2,
      y: unitsFromPx(pointer.y - box.top, metrics) - size.h / 2,
      w: size.w,
      h: size.h,
      z: canvas.elements.length,
    };
    // Przyciąganie do siatki i sąsiadów — te same czyste funkcje, co gest.
    const snapped = snapMove(clampGeometry(raw, canvas.rows), 0, 0, {
      rows: canvas.rows,
      neighbours: canvas.elements.map((element) => element.layout.desktop),
      snap: true,
    });

    return requestElement({ kind, sectionId, geometry: snapped.geometry });
  }

  const openSection = sections.find((section) => section.id === settingsId) ?? null;

  return (
    // Kreator ma WŁASNEGO dostawcę tooltipów: trasa stoi poza powłoką panelu
    // (grupa `(kreator)`, ADR-083), więc nie dziedziczy tego z belki — a od K3
    // tooltipy niosą znaczenie ikon w paskach akcji i w pasku formatowania.
    <TooltipProvider>
    <div data-site-builder className="flex h-screen min-h-screen flex-col">
      <h1 className="sr-only">{t("builder.title")}</h1>

      <header
        data-builder-topbar
        className="border-border bg-card flex shrink-0 flex-wrap items-center gap-3 border-b px-3 py-2"
      >
        {/*
          STAN WYJŚCIA JEDZIE WARTOŚCIĄ ZNACZNIKA z rodziny `data-builder-*`
          (ta sama reguła, co przy wskaźniku zapisu w ADR-169: rejestr warstwy
          edycyjnej sklepu pilnuje RODZINY, więc nazwa spoza niej przestaje być
          pilnowana w publicznym renderze). `blocked` znaczy „klik nie wyprowadzi
          stąd, dopóki serwer nie przyjmie pracy" — i jest tym, co mierzy sonda.
        */}
        <Button asChild type="button" variant="ghost" size="sm">
          <Link
            href="/strona"
            data-builder-back
            data-builder-back-state={leaving ? "leaving" : editor.unsaved > 0 ? "blocked" : "idle"}
            onClick={leave}
          >
            <ArrowLeft className="size-4" aria-hidden />
            {t("builder.back")}
          </Link>
        </Button>

        <span data-builder-site-name className="truncate text-sm font-medium">
          {siteName}
        </span>

        {/*
          PODGLĄD NA POZYCJI (faza B, ADR-200; §3 dokumentu architektury:
          „projektuję szablon, widzę go na konkretnym rowerze"). Kontrolka jest
          FIZYCZNIE osobna od nawigacji i mówi wprost, że zmienia sam podgląd.
          Na MATCE — dropdown po pozycjach z listy płótna (te same dane, więc
          pozycja wybrana tu na pewno się narysuje); na WYJĄTKU — zdanie
          o przypięciu, bez wyboru: strona dotyczy jednej pozycji i podgląd na
          innej byłby kłamstwem o niej. Bez rekordu (pusty katalog) kontrolki
          nie ma — nie miałaby czego przełączać.
        */}
        {pageRecord ? (
          pageRecordPinned ? (
            <span
              data-builder-record-pinned
              className="text-muted-foreground truncate text-[13px] leading-[18px]"
            >
              {t("builder.recordPinned", { name: pageRecord.name })}
            </span>
          ) : (
            <div
              data-builder-record-switch
              className="text-muted-foreground flex items-center gap-2 text-[13px] leading-[18px]"
            >
              <span>{t("builder.recordPreviewLabel")}</span>
              <Select
                value={previewRecord?.id ?? pageRecord.id}
                onValueChange={setPreviewRecordId}
              >
                <SelectTrigger
                  aria-label={t("builder.recordPreviewLabel")}
                  data-builder-record-select
                  className="h-8 max-w-56"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {products.map((product) => (
                    <SelectItem key={product.id} value={product.id}>
                      {product.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )
        ) : null}

        <div
          role="group"
          aria-label={t("builder.viewportLegend")}
          data-builder-viewport-switch
          className="border-border flex gap-1 rounded-md border p-1"
        >
          <ViewportButton
            active={viewport === "desktop"}
            label={t("builder.viewportDesktop")}
            icon={<Monitor className="size-4" aria-hidden />}
            onClick={() => setViewport("desktop")}
          />
          <ViewportButton
            active={viewport === "mobile"}
            label={t("builder.viewportMobile")}
            icon={<Smartphone className="size-4" aria-hidden />}
            onClick={() => setViewport("mobile")}
          />
        </div>

        {/* Historia płótna (K2) — wyłączona, gdy nie ma czego cofnąć: `disabled`
            mówi to samo maszynowo, co szarość mówi oku (#135). */}
        <div data-builder-history className="border-border flex gap-1 rounded-md border p-1">
          <HistoryButton
            label={t("builder.undo")}
            action="undo"
            disabled={!editor.canUndo || pending}
            icon={<Undo2 className="size-4" aria-hidden />}
            onClick={editor.undo}
          />
          <HistoryButton
            label={t("builder.redo")}
            action="redo"
            disabled={!editor.canRedo || pending}
            icon={<Redo2 className="size-4" aria-hidden />}
            onClick={editor.redo}
          />
        </div>

        {/*
          TRZY STANY, NIE DWA (K3, ADR-169). „Nie zapisano" ma PIERWSZEŃSTWO
          przed każdym meldunkiem sukcesu: dopóki choć jedna sekcja nie weszła
          do bazy, zdanie „Zapisano" jest fałszywe — nieważne, że akcja, która
          właśnie przeszła, przeszła naprawdę. To dokładnie ta podmiana gasiła
          ślad po zgubionej pracy.
        */}
        {/*
          STAN JEDZIE WARTOŚCIĄ TEGO SAMEGO ZNACZNIKA, nie drugim atrybutem.
          Rejestr warstwy edycyjnej sklepu (`site-render-builder-leak`) pilnuje
          RODZINY `data-builder-*` — nazwa spoza niej przestaje być pilnowana
          w publicznym renderze. Jedna nazwa z wartością jest zarazem
          uczciwszym zapisem: `[data-builder-save-state="unsaved"]` odpowiada
          na pytanie o stan, a `[data-builder-save-state]` dalej odnajduje
          wskaźnik tak, jak odnajdywał go do tej pory.
        */}
        <p
          data-builder-save-state={editor.unsaved > 0 ? "unsaved" : saveState}
          role="status"
          className={`ml-auto text-sm ${editor.unsaved > 0 ? "text-destructive font-medium" : "text-muted-foreground"}`}
        >
          {editor.unsaved > 0
            ? t("builder.unsaved")
            : saveState === "saving"
              ? t("builder.saving")
              : saveState === "saved"
                ? t("builder.saved")
                : saveState === "published"
                  ? t("builder.published")
                  : null}
        </p>

        {/*
          PODGLĄD SZKICU otwiera się w NOWEJ KARCIE (pinezka właściciela): karta
          kreatora zostaje tam, gdzie była, z niezapisaną historią cofania i
          zaznaczeniem. `target="_blank"` wymaga `rel="noreferrer"` — trasa jest
          nasza, ale nowa karta z dostępem do `window.opener` to nawyk, którego
          nie zostawiamy nawet u siebie.
        */}
        <Button asChild type="button" size="sm" variant="secondary">
          <a
            href={`/${locale}/strona/${siteId}/podglad`}
            target="_blank"
            rel="noreferrer"
            data-builder-preview
            title={t("preview.openHint")}
          >
            {t("preview.open")}
          </a>
        </Button>

        <StartOverButton
          disabled={pending}
          hasSections={sections.length > 0}
          onConfirm={() => setGalleryChoice("open")}
        />

        {/*
          PUBLIKACJA MA POTWIERDZENIE (L6) — ten sam `PublishDialog`, którym
          potwierdza lista stron: obie drogi prowadzą do tej samej operacji,
          więc nie mają prawa mówić o niej co innego. Akcja idzie dopiero po
          potwierdzeniu; jedynie ona blokuje kreator (patrz `run`) i melduje
          sukces osobnym „Opublikowano".
        */}
        <PublishDialog
          disabled={pending}
          live={live}
          name={siteName}
          address={address}
          /*
            ZASIĘG PUBLIKACJI mówi prawdę o ROLI strony (ADR-200): matka
            obowiązuje na stronie każdego sprzętu, wyjątek — jednego. Bez tego
            okno obiecywałoby szablonowi adres `/`, pod którym nie stoi (ta
            sama klasa kłamstwa, którą na liście stron zamknęło ADR-178).
            Nazwa sprzętu z PRZYPIĘTEGO rekordu; wyjątek bez rekordu (stan
            praktycznie niereprezentowalny — kaskada 0088) dostaje zdanie
            z etykietą zastępczą zamiast zdania o cudzym zasięgu.
          */
          productTemplate={productTemplate}
          exceptionProductName={
            productTemplate && pageRecordPinned
              ? (pageRecord?.name ?? t("pages.exceptionProductFallback"))
              : null
          }
          warnings={warnings}
          onConfirm={() =>
            run(() => publishSite(siteId), undefined, { blocking: true, announce: "published" })
          }
          trigger={
            <Button type="button" size="sm" data-builder-publish loading={pending} disabled={pending}>
              {pending ? t("publish.publishing") : t("publish.publish")}
            </Button>
          }
        />
      </header>

      <BuilderAlert
        unsaved={editor.unsaved}
        reason={unsavedReason}
        error={error}
        onSaveAgain={editor.flush}
        onRetry={
          retryArgs ? () => run(retryArgs.action, retryArgs.onFail, retryArgs.options) : undefined
        }
      />

      {galleryOpen ? (
        <TemplateGallery
          disabled={pending}
          onPick={(starterId) =>
            // Galeria zamyka się WYŁĄCZNIE po udanym zapisie: przy błędzie
            // operator ma zostać tam, gdzie kliknął, i zobaczyć komunikat.
            run(() =>
              applyStarterTemplate({ siteId, starterId, locale }).then((result: ActionResult) => {
                if (result.ok) setGalleryChoice("closed");
                return result;
              }),
            )
          }
          /*
            PUSTA STRONA JEST PUNKTEM WYJŚCIA, A NIE UCIECZKĄ (ADR-161).
            Do tej pory zamknięcie galerii przy pierwszej wizycie było
            niemożliwe: bez sekcji operator NIE MIAŁ jak dostać się do płótna,
            więc każda nowa strona rodziła się z cudzej treści, którą trzeba
            było wyczyścić. Puste płótno nie jest ślepą uliczką — ma paletę
            i „+", czyli dokładnie te same drogi wstawienia sekcji, co strona
            z treścią.
          */
          onEmpty={() => setGalleryChoice("closed")}
          // Zamknięcie BEZ wyboru zostaje przy stronie, która treść już ma:
          // tam „wróć do kreatora" znaczy „zostaw wszystko, jak było", i to
          // jest inna obietnica niż „zacznij od pustej".
          onDismiss={sections.length > 0 ? () => setGalleryChoice("closed") : undefined}
        />
      ) : null}

      <div className={galleryOpen ? "hidden" : "flex min-h-0 flex-1"}>
        <BuilderPalette
          open={paletteOpen}
          onToggle={() => setPaletteOpen((open) => !open)}
          disabled={pending}
          style={style}
          /*
            Zakładka „Sekcje" jest odtąd WEJŚCIEM DO PICKERA z kontekstem
            „na końcu strony" (E2) — brak kotwicy znaczy dokładnie to, a serwer
            i tak postawi sekcję przypiętą pod spodem. Lista typów żyje w JEDNYM
            miejscu (picker), razem z podglądami; druga jej kopia w palecie
            znaczyłaby dwa miejsca, w których operator wybiera to samo.
          */
          onAddSection={() => setInsertTarget({})}
          /*
            KAFLE ELEMENTÓW GASNĄ NA PUSTEJ STRONIE (K-09). Element dokłada się
            DO SEKCJI — bez sekcji nie ma dokąd, więc do tej poprawki klik kafla
            był cichym no-opem: nic się nie działo i nic tego nie tłumaczyło.
          */
          elementsTarget={editableSections.length > 0}
          onAddElement={addElement}
          onDropElement={dropElementAt}
          onDragElementOver={(pointer) => setElementDropSectionId(elementDropTargetAt(pointer))}
          onDragElementEnd={() => setElementDropSectionId(null)}
          onSaveStyle={(next) => run(() => updateStoreStyle(next))}
        />

        {/* Scena przewija się w OBU osiach (K4, ADR-088): płótno desktopowe ma
            zagwarantowaną szerokość co najmniej 40 rem, żeby renderer nigdy nie
            wpadł w układ mobilny w widoku „komputer" — a w wąskim oknie ta
            gwarancja musi mieć gdzie się zmieścić. */}
        <main data-builder-stage className="bg-muted min-w-0 flex-1 overflow-auto p-4 md:p-6">
          <BuilderCanvas
            money={money}
            style={style}
            sections={sections}
            products={products}
            categories={categories}
            record={previewRecord}
            viewport={viewport}
            busy={pending}
            dropSectionId={elementDropSectionId}
            flashId={flashId}
            run={run}
            reorderAction={(orderedIds) => reorderSections(siteId, orderedIds)}
            toggleAction={(section) => toggleSection(section.id, !section.enabled)}
            duplicateAction={(sectionId) => duplicateSection(sectionId)}
            deleteAction={(sectionId) => deleteSection(sectionId)}
            restoreAction={(sectionId) => restoreSection(sectionId)}
            onInsert={setInsertTarget}
            /*
              DROGA POWROTNA DO SZABLONÓW Z PUSTEGO PŁÓTNA (K-20). Galeria
              zamknięta wyborem „pusta strona" była do tej poprawki drogą
              w JEDNĄ stronę: „Zacznij od nowa" w pasku pokazuje się wyłącznie
              przy stronie, która sekcje ma (nie ma czego zastępować), a poza
              nim nie było ani jednego wejścia do szablonów. Operator, który
              kliknął „pustą" i zmienił zdanie, musiał przeładować trasę.
            */
            onOpenTemplates={() => setGalleryChoice("open")}
            /*
              Otwarcie szuflady NIESIE ZE SOBĄ ZAKŁADKĘ (E8): „ustawienia
              sekcji" z paska narzędzi jej nie wskazują, a przycisk pustego
              stanu wskazuje listę wpisów — bo dokładnie to obiecuje jego napis.
            */
            onOpenSettings={(sectionId, tab) => {
              setSettingsTab(tab);
              setSettingsId(sectionId);
            }}
            editor={editor}
            selection={selection}
            onSelect={setSelection}
            onPickImage={setPicking}
            onChanged={() => {
              setSaveState("saved");
              router.refresh();
            }}
          />
        </main>
      </div>

      {/* PICKER SEKCJI (E2) — jedno okno na wszystkie trzy wejścia: „+" na
          płótnie, paleta („na końcu strony") i pusta strona. Miejsce niesie
          `insertTarget`, więc okno nie musi wiedzieć, kto je otworzył. */}
      <SectionPicker
        open={insertTarget !== null}
        target={insertTarget}
        style={style}
        products={products}
        categories={categories}
        disabled={pending}
        unavailableTypes={unavailableTypes}
        onAdd={addSection}
        onClose={() => setInsertTarget(null)}
      />

      {/*
        KONWERSJA SEKCJI ZASTANEJ NA SWOBODNE PŁÓTNO MA POTWIERDZENIE (K-12).
        Okno mówi o SKUTKU, nie o generacji treści: „układ przestanie być
        automatyczny" jest zdaniem, na które operator umie odpowiedzieć, a
        „sekcja v1 zostanie zapisana jako v2" — nie jest.
      */}
      <Dialog
        open={convertPrompt !== null}
        onOpenChange={(open) => {
          if (!open) setConvertPrompt(null);
        }}
      >
        <DialogContent data-builder-convert-dialog>
          <DialogHeader>
            <DialogTitle>{t("builder.convertTitle")}</DialogTitle>
            <DialogDescription data-builder-convert-scope="canvas">
              {t("builder.convertBody")}
            </DialogDescription>
          </DialogHeader>
          <Label className="flex items-center gap-2 text-sm font-normal">
            <Checkbox
              checked={convertRemember}
              data-builder-convert-remember
              onCheckedChange={(value) => setConvertRemember(value === true)}
            />
            {t("builder.convertRemember")}
          </Label>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setConvertPrompt(null)}>
              {t("builder.convertCancel")}
            </Button>
            <Button
              type="button"
              data-builder-convert-confirm
              onClick={() => {
                const pending = convertPrompt;
                if (convertRemember) setSkipConvertPrompt(true);
                setConvertPrompt(null);
                if (pending) insertElement(pending);
              }}
            >
              {t("builder.convertConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ImagePicker
        siteId={siteId}
        open={picking !== null}
        onClose={() => setPicking(null)}
        onPick={(source, alt) => {
          const target = picking;
          if (!target) return;
          editor.mutate(target.sectionId, (canvas) =>
            replaceElement(canvas, target.elementId, (element) =>
              element.kind === "image"
                ? {
                    ...element,
                    source,
                    // Stara ścieżka schodzi razem ze źródłem — zgodność wstecz
                    // jest DROGĄ ODCZYTU, nie miejscem zapisu (ADR-086).
                    imagePath: undefined,
                    alt: alt && alt.trim().length > 0 ? alt : element.alt,
                  }
                : element,
            ),
          );
          setPicking(null);
        }}
      />

      <SectionSettingsDrawer
        siteId={siteId}
        currency={money.currency}
        importSources={importSources}
        pageRecord={previewRecord}
        section={openSection}
        canvas={openSection ? editor.canvasOf(openSection.id) : undefined}
        structured={openSection ? editor.structuredOf(openSection.id) : undefined}
        structuredTab={settingsTab}
        selectedElementId={
          openSection && selection?.sectionId === openSection.id
            ? (selection.elementId ?? null)
            : null
        }
        onCanvasChange={(update) => {
          if (openSection) editor.mutate(openSection.id, update);
        }}
        onStructuredChange={(update) => {
          if (openSection) editor.mutateStructured(openSection.id, update);
        }}
        /*
          KONWERSJA „Przełącz na sekcję 2.0" (ADR-094). Nowa sekcja wchodzi
          BEZPOŚREDNIO POD starą — czyli NAD sekcją, która stoi zaraz za nią.
          Kotwicę bierzemy z aktualnej kolejności PŁÓTNA, a nie z propsów:
          płótno trzyma stan optymistyczny i to ono pokazuje operatorowi, gdzie
          ta sekcja stoi. Stara sekcja na końcu treści nie ma następnika — brak
          kotwicy znaczy wtedy „na końcu", czyli dokładnie pod nią.

          Szuflada zamyka się od razu: zostawałaby otwarta na STAREJ sekcji,
          sugerując, że to w niej coś się zmieniło.
        */
        onConvert={
          openSection && !editor.structuredOf(openSection.id)
            ? () => {
                const ids = canvasOrderIds();
                const next = ids[ids.indexOf(openSection.id) + 1];
                /*
                 * TREŚĆ NOWEJ SEKCJI ROZSTRZYGA REJESTR (E3), nie ten plik.
                 * FAQ dostaje preset, bo treści spłaszczonej do płótna nie da
                 * się rozpisać z powrotem na pytania i odpowiedzi bez
                 * zgadywania; galeria dostaje PRZENIESIONE zdjęcia, bo zdjęcie
                 * zostaje zdjęciem w każdej generacji. Kolejny typ zmienia to
                 * zachowanie wpisem w rejestrze, a nie gałęzią tutaj.
                 */
                const converted = isStructuredType(openSection.type)
                  ? structuredFromLegacy(
                      openSection.type,
                      editor.contentOf(openSection.id) ?? openSection.content,
                      locale,
                    )
                  : undefined;
                addSection(
                  openSection.type,
                  undefined,
                  { beforeId: ids.includes(openSection.id) ? next : undefined },
                  converted,
                );
                setSettingsId(null);
              }
            : undefined
        }
        /* Picker zdjęcia dotyczy ELEMENTU, więc pojawia się wyłącznie na tym
           poziomie zaznaczenia — zaznaczona sama sekcja nie ma czego zmienić. */
        onPickImage={
          openSection && selection?.sectionId === openSection.id && selection.elementId
            ? () => setPicking({ sectionId: selection.sectionId, elementId: selection.elementId! })
            : undefined
        }
        onClose={() => setSettingsId(null)}
        onSaved={() => {
          setSaveState("saved");
          router.refresh();
        }}
      />
    </div>
    </TooltipProvider>
  );
}

/**
 * KOMUNIKAT KREATORA PONAD WSZYSTKIM, CO OTWARTE (K3, ADR-169).
 *
 * Pasek błędu stał dotąd pod belką, w drzewie kreatora. Każda szuflada i każde
 * okno stoi na Radix Dialogu, którego nakładka jest `fixed inset-0 z-50`, więc
 * przykrywała komunikat OBRAZEM, a `hideOthers` z `aria-hidden` odbierało go
 * czytnikowi ekranu. Odmowa autozapisu przychodzi najczęściej dokładnie wtedy,
 * gdy operator coś w szufladzie wpisuje — więc jedyny moment, w którym ten
 * komunikat jest naprawdę potrzebny, był jedynym, w którym go nie było.
 *
 * Dlatego warstwa:
 *   • wisi na `body`, nie w drzewie kreatora — inaczej dowolny przodek
 *     z własnym kontekstem układania mógłby ją uwięzić pod nakładką;
 *   • ma z-index WYŻSZY niż nakładka okna (`z-50`), więc maluje się nad nią;
 *   • ZDEJMUJE Z SIEBIE `aria-hidden`, który zakłada jej modal. To nie jest
 *     obejście cudzej biblioteki, tylko jawna decyzja: stan „twoja praca nie
 *     jest zapisana" musi dojść do operatora niezależnie od tego, co ma
 *     otwarte, a nakładka wycisza wszystko poza sobą bez wyjątków;
 *   • przepuszcza wskaźnik (`pointer-events-none`) poza samą kartą, żeby nie
 *     odbierać kliknięć płótnu pod spodem.
 */
function BuilderAlert({
  unsaved,
  reason,
  error,
  onSaveAgain,
  onRetry,
}: {
  /** Ile sekcji NIE weszło do bazy — patrz `CanvasEditor.unsaved`. */
  unsaved: number;
  /** Przyczyna odmowy, słowami serwera. */
  reason: string | null;
  /** Błąd ostatniej akcji struktury (kasowany przy następnej). */
  error: string | null;
  onSaveAgain: () => void;
  onRetry?: () => void;
}) {
  const t = useTranslations("site");
  /*
   * Węzeł warstwy powstaje w INICJALIZATORZE stanu, a nie w efekcie: efekt
   * wołający `setState` kaskaduje render (bramka `react-hooks/set-state-in-effect`),
   * a zapis do referencji w renderze jest zapisem w trakcie renderu. Tu jest
   * jedno wywołanie na instancję, a na serwerze nie ma `document`, więc
   * komponent renderuje się do niczego i wchodzi dopiero u klienta.
   */
  const [layer] = useState<HTMLElement | null>(() => {
    if (typeof document === "undefined") return null;
    const node = document.createElement("div");
    node.setAttribute("data-builder-alert-layer", "");
    node.className = "pointer-events-none fixed inset-x-0 bottom-0 z-[70] flex justify-center p-4";
    return node;
  });

  useEffect(() => {
    if (!layer) return;
    document.body.append(layer);

    /*
     * Modal zakłada `aria-hidden` na każde dziecko `body` poza swoim portalem
     * (pakiet `aria-hidden`, wołany przez Radix przy otwarciu). Obserwator
     * zdejmuje go z TEJ JEDNEJ warstwy — pętli nie ma, bo usunięcie atrybutu
     * wywołuje kolejne zdarzenie, w którym nie ma już czego usuwać.
     */
    const observer = new MutationObserver(() => {
      if (layer.hasAttribute("aria-hidden")) layer.removeAttribute("aria-hidden");
    });
    observer.observe(layer, { attributes: true, attributeFilter: ["aria-hidden"] });

    return () => {
      observer.disconnect();
      layer.remove();
    };
  }, [layer]);

  if (!layer) return null;
  if (unsaved === 0 && !error) return null;

  /*
   * NIEZAPISANA PRACA BIJE ZWYKŁY BŁĄD. `error` gaśnie przy pierwszej
   * następnej akcji, a sekcja poza bazą zostaje — więc gdy zachodzą oba,
   * na wierzch idzie ten stan, który nie mija sam z siebie.
   */
  const lost = unsaved > 0;

  return createPortal(
    <div
      data-builder-alert
      data-builder-alert-kind={lost ? "unsaved" : "error"}
      className="border-destructive bg-card pointer-events-auto flex max-w-2xl flex-wrap items-start gap-3 rounded-md border px-4 py-3"
    >
      <AlertTriangle className="text-destructive mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="flex min-w-0 flex-col gap-1">
        <p role="alert" className="text-destructive text-sm font-medium">
          {lost ? `${t("builder.unsaved")}: ${reason ?? t("builder.saveFailed")}` : error}
        </p>
        {lost ? (
          <p className="text-muted-foreground text-[13px] leading-[18px]">
            {t("builder.unsavedBody")}
          </p>
        ) : null}
      </div>
      <div className="ml-auto flex gap-2">
        {lost ? (
          <Button type="button" size="sm" variant="secondary" data-builder-save-again onClick={onSaveAgain}>
            {t("builder.saveAgain")}
          </Button>
        ) : null}
        {/*
          PONOWIENIE stoi wyłącznie po ODRZUCENIU (L6): ta sama akcja, ten sam
          kanał. Przy porażce biznesowej przycisku nie ma — walidacja odrzuci
          drugie podejście identycznie.
        */}
        {onRetry ? (
          <Button type="button" size="sm" variant="secondary" data-builder-retry onClick={onRetry}>
            {t("builder.retry")}
          </Button>
        ) : null}
      </div>
    </div>,
    layer,
  );
}

function ViewportButton({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      title={label}
      data-viewport-option={active ? "active" : "inactive"}
      onClick={onClick}
      className={`focus-visible:border-foreground focus-visible:outline-accent dark:focus-visible:outline-ring flex size-8 cursor-pointer items-center justify-center rounded-sm border border-transparent outline-none transition-colors [transition-duration:var(--motion-fast)] focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 ${
        active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
    </button>
  );
}

function HistoryButton({
  label,
  action,
  disabled,
  icon,
  onClick,
}: {
  label: string;
  action: "undo" | "redo";
  disabled: boolean;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={label}
      title={label}
      data-builder-history-button={action}
      onClick={onClick}
      className={`text-muted-foreground focus-visible:border-foreground focus-visible:outline-accent dark:focus-visible:outline-ring flex size-8 items-center justify-center rounded-sm border border-transparent outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 ${
        disabled ? "cursor-not-allowed opacity-50" : "hover:text-foreground cursor-pointer"
      }`}
    >
      {icon}
    </button>
  );
}

/**
 * „ZACZNIJ OD NOWA" (K5 v2, ADR-090) — powrót do galerii szablonów.
 *
 * Dialog MÓWI PRAWDĘ o skutku, i to jest tu cała robota. Do 0045 zastosowanie
 * szablonu kasowało sekcje wierszami, więc zdejmowało je z ŻYWEJ strony
 * natychmiast; dziś usunięcia idą nagrobkami (ADR-091), więc opublikowana
 * strona nie zmienia się ani o piksel do chwili publikacji. Komunikat opisuje
 * dokładnie ten stan — inaczej operator albo bałby się kliknąć, albo
 * dowiedziałby się o skutku od klienta.
 *
 * Rozróżnienie „strona ma sekcje / nie ma" jest istotne: przy pierwszej wizycie
 * nie ma czego zastępować, więc nie ma o co pytać.
 */
function StartOverButton({
  disabled,
  hasSections,
  onConfirm,
}: {
  disabled: boolean;
  hasSections: boolean;
  onConfirm: () => void;
}) {
  const t = useTranslations("site");

  if (!hasSections) return null;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="secondary" data-builder-start-over disabled={disabled}>
          {t("starter.startOver")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("starter.confirmTitle")}</DialogTitle>
          <DialogDescription data-start-over-scope="draft-only">
            {t("starter.confirmBody")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              {t("starter.confirmCancel")}
            </Button>
          </DialogClose>
          <DialogClose asChild>
            <Button type="button" onClick={onConfirm} data-start-over-confirm>
              {t("starter.confirmAccept")}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

