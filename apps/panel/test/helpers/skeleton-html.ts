/**
 * Pomocnik kontraktu ekranów ładowania (delta v3, 2026-08-05).
 *
 * Pinezka właściciela mówi, co ma być WIDAĆ: „tylko pasek u góry i informację
 * na dole". Żeby dało się to sprawdzić testem, a nie okiem na zrzucie, trzeba
 * umieć oddzielić w renderze ramy to, co maluje, od tego, co tylko rezerwuje
 * miejsce. Podział jest ostry: rezerwa siedzi w CAŁOŚCI pod korzeniem
 * `data-skeleton-screen`, który nosi `visibility: hidden`, więc nie maluje ani
 * jednego piksela razem z całym poddrzewem. Wszystko POZA tym poddrzewem —
 * maluje.
 *
 * Stąd `tagsOutsideReserve`: wycina poddrzewo rezerwy licząc zagnieżdżenie
 * znaczników i zwraca nazwy elementów, które zostały. Lista musi być krótka
 * i dokładnie znana; jej rozrost to nowa rzecz na ekranie, czyli złamanie
 * pinezki.
 */

/** Korzeń rezerwy geometrii w renderze ramy ładowania. */
const RESERVE_ROOT = /<div[^>]*data-skeleton-screen[^>]*>/;

/** Zakres poddrzewa rezerwy w HTML ramy — `[start, end)`. */
function reserveRange(html: string): [number, number] {
  const start = html.search(RESERVE_ROOT);
  if (start < 0) {
    throw new Error("brak korzenia rezerwy (data-skeleton-screen) w renderze ramy");
  }

  // Skan po znacznikach z licznikiem zagnieżdżenia. `<foo/>` (element pusty)
  // nie zmienia głębokości — bez tego wyjątku pierwszy `<img/>` w rezerwie
  // rozjechałby licznik i wycięcie objęłoby pół dokumentu.
  const tag = /<(\/?)([a-z]+)[^>]*?(\/?)>/g;
  tag.lastIndex = start;
  let depth = 0;
  for (let match = tag.exec(html); match !== null; match = tag.exec(html)) {
    if (match[3] === "/") continue;
    depth += match[1] === "/" ? -1 : 1;
    if (depth === 0) return [start, tag.lastIndex];
  }
  throw new Error("niedomknięte poddrzewo rezerwy geometrii");
}

/**
 * Nazwy elementów renderu ramy stojące POZA rezerwą geometrii — czyli komplet
 * tego, co ekran ładowania maluje.
 *
 * Rzuca, gdy w HTML nie ma rezerwy albo gdy jej poddrzewo jest niedomknięte:
 * cicha zerowa odpowiedź zrobiłaby z kontraktu bramkę, która nie umie spłonąć.
 */
export function tagsOutsideReserve(html: string): string[] {
  const [start, end] = reserveRange(html);
  const outside = html.slice(0, start) + html.slice(end);
  return [...outside.matchAll(/<([a-z]+)[^>]*>/g)].map((match) => match[1]!);
}

/** Znaczniki otwierające WEWNĄTRZ rezerwy, z korzeniem włącznie. */
export function tagsInsideReserve(html: string): string[] {
  const [start, end] = reserveRange(html);
  return [...html.slice(start, end).matchAll(/<[a-z]+[^>]*>/g)].map((match) => match[0]);
}

/**
 * Klasa przywracająca widoczność: goła `visible`, ta sama pod DOWOLNYM
 * wariantem (`md:visible`, `group-hover:visible`) oraz zapis dowolny
 * (`[visibility:visible]`, też z wariantem).
 */
const VISIBLE_TOKEN = /^(?:[^\s:]+:)*visible$/;
const VISIBLE_ARBITRARY = /\[visibility:\s*visible\]/;
/** Ta sama deklaracja wpisana wprost w `style`. */
const INLINE_VISIBLE = /visibility\s*:\s*visible/i;

/**
 * Węzły rezerwy, które PRZYWRACAJĄ SOBIE WIDOCZNOŚĆ (uwaga recenzji PM do #179).
 *
 * Dlaczego to osobna noga kontraktu. `visibility: hidden` na korzeniu rezerwy
 * DZIEDZICZY się w dół, ale nie jest nieodwracalne: potomek z własnym
 * `visibility: visible` maluje się mimo ukrytego rodzica (inaczej niż przy
 * `display: none`, gdzie potomka nie ma w ogóle). Kontrakt patrzący WYŁĄCZNIE
 * na klasę korzenia był więc zielony przy rezerwie malującej komplet pudełek —
 * mutacja PM (`cn("visible", className)` w `SkeletonBlock`) przeszła całą suitę.
 * To ta sama rodzina wad co „zadeklarowane vs namalowane": deklaracja na górze
 * nie jest dowodem na to, co widać na dole.
 *
 * Dlatego ta funkcja przechodzi CAŁE renderowane poddrzewo i zwraca znaczniki
 * winne odwrócenia — a wołający dokłada osłonę anty-pustą (drzewo musi mieć
 * węzły), żeby bramka nie zzieleniała po zbiorze zerowym.
 */
export function visibilityOverridesInsideReserve(html: string): string[] {
  return tagsInsideReserve(html).filter((tag) => {
    const classAttr = tag.match(/\sclass="([^"]*)"/)?.[1] ?? "";
    const styleAttr = tag.match(/\sstyle="([^"]*)"/)?.[1] ?? "";
    if (VISIBLE_ARBITRARY.test(classAttr)) return true;
    if (INLINE_VISIBLE.test(styleAttr)) return true;
    return classAttr.split(/\s+/).some((token) => VISIBLE_TOKEN.test(token));
  });
}

/**
 * Komplet elementów, jakie ekran ładowania ma prawo malować: rama, szyna
 * (`div` + `span` wypełnienia) i komunikat. Cztery znaczniki, ani jeden więcej.
 */
export const PAINTED_TAGS = ["div", "div", "span", "p"] as const;
