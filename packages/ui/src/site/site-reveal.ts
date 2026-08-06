/**
 * SKRYPT UZBRAJAJĄCY WEJŚCIE SEKCJI (ADR-097).
 *
 * ==================== PO CO SKRYPT, SKORO BYŁ CSS ====================
 *
 * K6 (ADR-092) postawiło wejście na osi widoku — bez ani jednego kilobajta
 * JavaScriptu. Zaletę tę oddajemy świadomie, bo scrub nie ma własnej prędkości:
 * postęp animacji jest funkcją przewijania, więc przy jednym obrocie kółka
 * przebieg wykonuje się w kilku klatkach, a przy przewijaniu w tył — cofa.
 * Uzasadnienie w całości: ADR-097.
 *
 * ==================== DLACZEGO STAN STARTOWY NADAJE SKRYPT ====================
 *
 * Animacja wejścia potrzebuje stanu „jeszcze nie widać". Gdyby ten stan stał
 * w arkuszu bezwarunkowo, strona bez JavaScriptu byłaby PUSTA — a to jest wada
 * poważniejsza niż brak animacji, bo dotyka robota indeksującego i czytelnika
 * z wyłączonymi skryptami. Stąd konstrukcja:
 *
 *   1. arkusz chowa treść WYŁĄCZNIE pod `[data-site-reveal="armed"]`;
 *   2. atrybut nadaje TEN skrypt, i to tylko wtedy, gdy naprawdę umie go zdjąć
 *      (jest `IntersectionObserver`, czytelnik nie prosi o mniej ruchu);
 *   3. brak JS = brak atrybutu = brak stanu startowego.
 *
 * Fail-open wynika więc z KSZTAŁTU SELEKTORA, a nie z reguły awaryjnej, którą
 * trzeba pamiętać dopisać (nasza strona marketingowa ma dokładnie taką regułę
 * w `<noscript>` — działa, ale jest jednym miejscem do zapomnienia więcej).
 *
 * ==================== SKRYPT MUSI BIEC PRZED MALOWANIEM ====================
 *
 * Wstawiamy go jako PIERWSZE DZIECKO korzenia strony, inline i synchronicznie.
 * Przeglądarka wykonuje go, zanim sparsuje sekcje stojące niżej w strumieniu,
 * więc stan startowy obowiązuje od pierwszej klatki. Skrypt doładowany później
 * (moduł, `defer`, hydracja Reacta) pokazałby treść, a potem ją schował —
 * mignięcie przy wolnym łączu jest wadą tak samo jak brak animacji.
 *
 * ==================== SIATKA BEZPIECZEŃSTWA ====================
 *
 * Jest stan pośredni, w którym fail-open oparty na samym „braku JS" nie działa:
 * skrypt WSTAŁ (więc treść jest schowana), ale obserwator nigdy nie strzelił —
 * bo wyjątek, bo rozszerzenie przeglądarki, bo egzotyczna implementacja. Treść
 * zostałaby wtedy niewidoczna na zawsze.
 *
 * Dlatego uzbrojenie odpala licznik. `IntersectionObserver` woła zwrotkę
 * NIEZWŁOCZNIE po `observe()` (także wtedy, gdy nic nie przecina okna), więc
 * pierwsze wywołanie zwrotki jest dowodem życia obserwatora i licznik gasi.
 * Jeśli zwrotka nie przyjdzie — licznik odsłania WSZYSTKO. Ta ścieżka ma
 * własną oś mutacyjną w dowodach E9.
 */

/** Atrybut korzenia dokumentu: „stan startowy wolno pokazać". */
export const REVEAL_ARMED_ATTR = "data-site-reveal";

/** Atrybut podmiotu: „to pudełko już weszło". */
export const REVEAL_DONE_ATTR = "data-section-revealed";

/**
 * Ile czekamy na pierwszy znak życia obserwatora, zanim odsłonimy wszystko.
 * Krótko: to jest ścieżka awaryjna, a nie budżet na wczytanie strony.
 */
export const REVEAL_FALLBACK_MS = 1200;

/**
 * Margines wyzwalacza: podmiot uznajemy za „wchodzący", gdy przetnie linię
 * 10% wysokości okna nad jego dolną krawędzią. Bez marginesu wejście odpalałoby
 * się dokładnie na krawędzi ekranu i pierwsza klatka ruchu ginęłaby poza kadrem.
 */
export const REVEAL_ROOT_MARGIN = "0px 0px -10% 0px";

/**
 * Źródło skryptu. Trzymamy je jako NAPIS, a nie moduł, z trzech powodów:
 * ma trafić do dokumentu inline (przed malowaniem), ma być identyczne w sklepie
 * i w podglądzie szkicu, i ma dać się przetestować w jsdom bez budowania paczki.
 *
 * Składnia celowo bez `const`/strzałek — skrypt wykonuje się przed jakimkolwiek
 * transpilowaniem i ma zadziałać wszędzie tam, gdzie działa `IntersectionObserver`.
 */
export const SITE_REVEAL_SCRIPT = `(function(){
var d=document,r=d.documentElement,io=null,licznik=0,pierwszeZa=0;
if(!window.IntersectionObserver)return;
try{if(window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches)return;}catch(e){return;}
r.setAttribute("${REVEAL_ARMED_ATTR}","armed");
function cele(){return d.querySelectorAll('.site-root:not([data-site-motion="off"]) [data-section-reveal]');}
function odsloń(el){el.setAttribute("${REVEAL_DONE_ATTR}","");}
function wszystko(){licznik=0;var l=cele();for(var i=0;i<l.length;i++)odsloń(l[i]);}
function zwrotka(w){
if(licznik){clearTimeout(licznik);licznik=0;}
for(var i=0;i<w.length;i++)if(w[i].isIntersecting){odsloń(w[i].target);io.unobserve(w[i].target);}
}
function podepnij(){
if(!io){try{io=new IntersectionObserver(zwrotka,{rootMargin:"${REVEAL_ROOT_MARGIN}",threshold:0});}catch(e){wszystko();return;}}
var l=cele(),n=0,i;
for(i=0;i<l.length;i++){if(!l[i].hasAttribute("${REVEAL_DONE_ATTR}")){io.observe(l[i]);n++;}}
/* Licznik ratunkowy uzbraja się TYLKO przy pierwszym podpięciu. Gdyby wracał
   przy każdym kolejnym, podmiot dołożony w trakcie czytania kasowałby wejście
   wszystkim sekcjom poniżej zgięcia po ${REVEAL_FALLBACK_MS} ms. */
if(n&&!licznik&&!pierwszeZa){pierwszeZa=1;licznik=setTimeout(wszystko,${REVEAL_FALLBACK_MS});}
}
if(d.readyState==="loading")d.addEventListener("DOMContentLoaded",podepnij);else podepnij();
/* Drugi przebieg na zdarzeniu load: sekcje dostarczone strumieniem po
   DOMContentLoaded (Suspense) nie byłyby inaczej ani obserwowane, ani
   odsłonięte. Ponowna obserwacja tego samego celu jest bezczynna. */
window.addEventListener("load",podepnij);
/* Trzecia droga: podmiot ZAMONTOWANY PÓŹNIEJ. W sklepie to przypadek skrajny
   (strumień), w podglądzie szkicu — codzienny, bo operator zmienia treść
   i drzewo sekcji powstaje na nowo. Bez tego taki podmiot zostaje uzbrojony,
   nieobserwowany i NIEWIDOCZNY. Zgłoszenia dławimy, bo w panelu drzewo rusza
   się przy każdym kliknięciu. */
if(window.MutationObserver){
var czeka=0;
new MutationObserver(function(){if(czeka)return;czeka=setTimeout(function(){czeka=0;podepnij();},100);})
.observe(d.documentElement,{childList:true,subtree:true});
}
})();`;
