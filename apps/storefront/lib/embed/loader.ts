/**
 * Skrypt osadzający (M3, ADR-120) — JEDYNY nasz kod, który wykonuje się w
 * kontekście strony gospodarza.
 *
 * Jest celowo maleńki i celowo GŁUPI: tworzy ramkę i słucha jej wysokości.
 * Nie zna klucza, nie zna tenanta (ten jest w hoście adresu, z którego skrypt
 * został pobrany), nie renderuje danych i nie dotyka niczego poza własnym
 * kontenerem. Wszystko, co ma wartość — katalog, kalendarz, formularz, dane
 * klienta — żyje po drugiej stronie granicy pochodzenia, w ramce.
 *
 * DLACZEGO ŹRÓDŁO JEST STAŁĄ, A NIE PLIKIEM W public/: bo tak da się je
 * ODPYTAĆ TESTEM. Bramka „w przeglądarce nie ma sekretu" sprawdza ten tekst
 * wprost, a plik statyczny musiałby być czytany z dysku przez test albo
 * pilnowany kontraktem źródła (ślepa plama: przemieszczenie literału).
 *
 * ADRES RAMKI SKŁADAMY Z `document.currentScript.src`, nie z atrybutu na
 * stronie. To jest ta sama zasada, co „tenant nie jest parametrem": origin
 * ramki bierze się z tego, SKĄD gospodarz nas pobrał, a nie z tego, co
 * napisał w HTML-u. Podmiana atrybutu nie przekieruje ramki do innego najemcy.
 */

import {
  EMBED_ATTR_LANG,
  EMBED_ATTR_PRODUCT,
  EMBED_ATTR_THEME,
  EMBED_WIDGET_PATH,
} from "./contract";

/** Nazwa zdarzenia postMessage — ramka melduje wysokość treści. */
export const EMBED_RESIZE_MESSAGE = "avably:embed:height";

export function embedLoaderSource(): string {
  return `(function () {
  "use strict";
  var script = document.currentScript;
  if (!script || !script.src) return;

  var origin;
  try {
    origin = new URL(script.src).origin;
  } catch (error) {
    return;
  }

  var product = script.getAttribute(${JSON.stringify(EMBED_ATTR_PRODUCT)}) || "";
  var lang = script.getAttribute(${JSON.stringify(EMBED_ATTR_LANG)}) || "";
  var theme = script.getAttribute(${JSON.stringify(EMBED_ATTR_THEME)}) || "";

  var url = origin + ${JSON.stringify(EMBED_WIDGET_PATH)};
  var query = [];
  if (product) query.push("product=" + encodeURIComponent(product));
  if (lang) query.push("lang=" + encodeURIComponent(lang));
  if (theme) query.push("theme=" + encodeURIComponent(theme));
  if (query.length) url += "?" + query.join("&");

  var frame = document.createElement("iframe");
  frame.src = url;
  frame.title = "Rezerwacja";
  frame.loading = "lazy";
  // Ramka ma nasz origin, więc same-origin policy chroni ją sama. sandbox
  // zostawiamy DOMYŚLNY (bez atrybutu): sandbox z allow-same-origin nie dodaje
  // tu nic, a bez niego zabrałby ramce formularze i skrypty, czyli cały widget.
  frame.setAttribute("referrerpolicy", "strict-origin");
  frame.style.width = "100%";
  frame.style.border = "0";
  frame.style.display = "block";
  frame.style.height = "720px";
  frame.style.colorScheme = "normal";

  // Kreatory stron potrafią wstrzyknąć wklejony fragment do <head>, a ramka
  // w <head> nie renderuje się wcale. Wtedy jedynym sensownym miejscem jest
  // koniec <body> — lepiej pokazać widget nie tam, gdzie wklejono, niż nigdzie.
  if (script.parentNode && script.parentNode.nodeName !== "HEAD") {
    script.parentNode.insertBefore(frame, script.nextSibling);
  } else {
    document.body.appendChild(frame);
  }

  window.addEventListener("message", function (event) {
    // Wiadomość liczy się WYŁĄCZNIE z naszego origin i WYŁĄCZNIE z tej ramki.
    // Bez obu warunków dowolny skrypt na stronie gospodarza (albo dowolna inna
    // ramka) mógłby dowolnie rozciągać nasz widget.
    if (event.origin !== origin) return;
    if (event.source !== frame.contentWindow) return;
    var data = event.data;
    if (!data || data.type !== ${JSON.stringify(EMBED_RESIZE_MESSAGE)}) return;
    var height = Number(data.height);
    if (!isFinite(height) || height < 120 || height > 4000) return;
    frame.style.height = Math.round(height) + "px";
  });
})();
`;
}
