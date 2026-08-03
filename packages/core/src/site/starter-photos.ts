/**
 * ZDJĘCIA SZABLONÓW STARTOWYCH (K5 v2, ADR-090) — KURACJA, NIE LOSOWANIE.
 *
 * Szablon ma wyglądać „gotowo do produkcji" od pierwszego wejścia, a to znaczy
 * ZDJĘCIA — nie szare kafle z podpisem „miejsce na zdjęcie". Zdjęcia pochodzą
 * od dostawcy, którego wyszukiwarkę kreator ma od K3 (ADR-086), i wchodzą tu
 * jako DANE: adres kadru, nazwisko autora, link do profilu z parametrami
 * atrybucji i adres wyzwalacza pobrania.
 *
 * ================== DLACZEGO OSOBNY PLIK, A NIE POLE W SZABLONIE ==================
 *
 * Szablon opisuje UKŁAD i TREŚĆ — rzeczy, które projektujemy. Zdjęcie opisuje
 * KADR I ATRYBUCJĘ — rzeczy, które przychodzą Z API dostawcy i których nie wolno
 * przepisywać z ręki (nazwisko autora wpisane ręcznie bywa literówką, a literówka
 * w atrybucji to złamanie licencji). Rozdzielenie ma trzy praktyczne skutki:
 *
 *   1. metadane wchodzą tu MASZYNOWO, jednym przebiegiem kuracji, i nikt ich
 *      nie „poprawia" przy okazji zmiany copy;
 *   2. układ szablonu jest identyczny przed kuracją i po niej — sekcja bez
 *      zdjęcia renderuje kafel zastępczy w tym samym pudełku, więc geometrii
 *      nie trzeba przeliczać, gdy zdjęcie wejdzie;
 *   3. wymiana kadru (nowy sezon, inny nastrój) rusza JEDEN wpis, a nie treść
 *      szablonu.
 *
 * ================== WARUNEK LICENCJI JEST WARUNKIEM TYPU ==================
 *
 * Każdy wpis musi przejść `imageSourceSchema` w wariancie `unsplash`, czyli
 * mieć KOMPLET: adres, nazwisko autora, link do profilu i `downloadLocation`.
 * Wpis bez kompletu nie jest „gorszym zdjęciem" — jest zdjęciem, którego nie
 * wolno pokazać. Pilnuje tego kontrakt szablonów, a `applyStarterTemplate`
 * odpala wyzwalacz pobrania dla KAŻDEGO zdjęcia zastosowanego szablonu (wymóg
 * regulaminu dostawcy: to z niego liczą się statystyki autora).
 */
import { imageSourceSchema, type ImageSource } from "./elements";

/**
 * SLOTY — miejsca w szablonach, w których stoi zdjęcie. Identyfikatory są
 * stabilne i angielskie, bo trafiają do treści tenanta razem z kadrem.
 */
export const STARTER_PHOTO_SLOTS = [
  "construction-hero",
  "construction-delivery",
  "bike-hero",
  "bike-location",
  "event-hero",
  "event-gallery-1",
  "event-gallery-2",
  "event-gallery-3",
  "photo-hero",
  "photo-studio",
  "lean-hero",
  "lean-workshop",
  "catalog-hero",
  "catalog-delivery",
] as const;
export type StarterPhotoSlot = (typeof STARTER_PHOTO_SLOTS)[number];

/**
 * ZAPYTANIA KURACYJNE — czym szukać kadru do slotu. Stoją w repozytorium, a nie
 * w głowie autora, bo to one czynią kurację POWTARZALNĄ: wymiana zdjęcia po
 * roku ma zaczynać się od tego samego zapytania, a nie od zgadywania, czego
 * właściwie szukał poprzednik.
 */
export const STARTER_PHOTO_QUERIES: Record<StarterPhotoSlot, string> = {
  "construction-hero": "construction site heavy machinery dusk",
  "construction-delivery": "flatbed truck construction equipment delivery",
  "bike-hero": "mountain bike rider trail action",
  "bike-location": "bicycle workshop shop interior",
  "event-hero": "outdoor wedding tent string lights evening",
  "event-gallery-1": "banquet table setting event",
  "event-gallery-2": "party marquee dance floor",
  "event-gallery-3": "event chairs rows outdoor ceremony",
  "photo-hero": "film camera cinema lighting dark studio",
  "photo-studio": "photography studio softbox equipment",
  "lean-hero": "warm minimal workshop tools daylight",
  "lean-workshop": "craftsman workbench warm light",
  "catalog-hero": "clean product shelves warehouse organised",
  "catalog-delivery": "delivery van loading parcels daylight",
};

/**
 * KADRY — wybrane 2026-08-03 przez API dostawcy, wartości WPROST z odpowiedzi
 * (adres, nazwisko autora, profil, wyzwalacz pobrania). Do linku profilu
 * doklejone są parametry atrybucji wymagane regulaminem — te same, które
 * dokłada picker w kreatorze (`withAttribution` w apps/panel/lib/unsplash.ts).
 *
 * Każdy kadr obejrzany w DWÓCH przycięciach: poziomym (desktop) i pionowym
 * 2:3 (auto-układ mobilny przy 390 px). Kadr, który po zwężeniu tracił temat,
 * nie wchodził — stąd np. rezygnacja z panoram budowy na rzecz maszyny
 * w pionie i wymiana zapytania dla warsztatu rowerowego.
 */
export const STARTER_PHOTOS: Partial<Record<StarterPhotoSlot, ImageSource>> = {
  "construction-hero": {
    kind: "unsplash",
    url: "https://images.unsplash.com/photo-1575281923032-f40d94ef6160?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8MXx8Y29uc3RydWN0aW9uJTIwc2l0ZSUyMGhlYXZ5JTIwbWFjaGluZXJ5fGVufDF8MHx8fDE3ODU3ODI5MDV8MA&ixlib=rb-4.1.0&q=80&w=1080",
    authorName: "Troy Mortier",
    authorUrl: "https://unsplash.com/@troyscanon?utm_source=avably&utm_medium=referral",
    downloadLocation: "https://api.unsplash.com/photos/eKY6_9W_iqY/download?ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8MXx8Y29uc3RydWN0aW9uJTIwc2l0ZSUyMGhlYXZ5JTIwbWFjaGluZXJ5fGVufDF8MHx8fDE3ODU3ODI5MDV8MA",
  },
  "construction-delivery": {
    kind: "unsplash",
    url: "https://images.unsplash.com/photo-1597399069243-e782acdca4d6?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8NHx8dHJ1Y2slMjBjb25zdHJ1Y3Rpb24lMjBlcXVpcG1lbnQlMjBkZWxpdmVyeXxlbnwxfDB8fHwxNzg1NzgyOTA2fDA&ixlib=rb-4.1.0&q=80&w=1080",
    authorName: "Troy Mortier",
    authorUrl: "https://unsplash.com/@troyscanon?utm_source=avably&utm_medium=referral",
    downloadLocation: "https://api.unsplash.com/photos/4wj8Rs9SJeQ/download?ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8NHx8dHJ1Y2slMjBjb25zdHJ1Y3Rpb24lMjBlcXVpcG1lbnQlMjBkZWxpdmVyeXxlbnwxfDB8fHwxNzg1NzgyOTA2fDA",
  },
  "bike-hero": {
    kind: "unsplash",
    url: "https://images.unsplash.com/photo-1760462127033-2189eb2202e7?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8NXx8bW91bnRhaW4lMjBiaWtlJTIwcmlkZXIlMjB0cmFpbHxlbnwxfDB8fHwxNzg1NzgyOTA3fDA&ixlib=rb-4.1.0&q=80&w=1080",
    authorName: "Sunil Chandra Sharma",
    authorUrl: "https://unsplash.com/@sunilcsharma?utm_source=avably&utm_medium=referral",
    downloadLocation: "https://api.unsplash.com/photos/uY7lsAz8fjA/download?ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8NXx8bW91bnRhaW4lMjBiaWtlJTIwcmlkZXIlMjB0cmFpbHxlbnwxfDB8fHwxNzg1NzgyOTA3fDA",
  },
  "bike-location": {
    kind: "unsplash",
    url: "https://images.unsplash.com/photo-1455641374154-422f32e234cd?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8Mnx8YmlrZSUyMHNob3AlMjBpbnRlcmlvciUyMGJpY3ljbGVzJTIwZm9yJTIwcmVudHxlbnwxfDB8fHwxNzg1NzgzNTMyfDA&ixlib=rb-4.1.0&q=80&w=1080",
    authorName: "Viktor Keri",
    authorUrl: "https://unsplash.com/@viktorkeri?utm_source=avably&utm_medium=referral",
    downloadLocation: "https://api.unsplash.com/photos/UdGEXZtlx-E/download?ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8Mnx8YmlrZSUyMHNob3AlMjBpbnRlcmlvciUyMGJpY3ljbGVzJTIwZm9yJTIwcmVudHxlbnwxfDB8fHwxNzg1NzgzNTMyfDA",
  },
  "event-hero": {
    kind: "unsplash",
    url: "https://images.unsplash.com/photo-1519226612673-73c0234437ef?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8NHx8d2VkZGluZyUyMHRlbnQlMjBzdHJpbmclMjBsaWdodHMlMjBldmVuaW5nfGVufDF8MHx8fDE3ODU3ODI5MDh8MA&ixlib=rb-4.1.0&q=80&w=1080",
    authorName: "Photos by Lanty",
    authorUrl: "https://unsplash.com/@photos_by_lanty?utm_source=avably&utm_medium=referral",
    downloadLocation: "https://api.unsplash.com/photos/dcb2pog89fQ/download?ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8NHx8d2VkZGluZyUyMHRlbnQlMjBzdHJpbmclMjBsaWdodHMlMjBldmVuaW5nfGVufDF8MHx8fDE3ODU3ODI5MDh8MA",
  },
  "event-gallery-1": {
    kind: "unsplash",
    url: "https://images.unsplash.com/photo-1511795409834-ef04bbd61622?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8MXx8YmFucXVldCUyMHRhYmxlJTIwc2V0dGluZyUyMGV2ZW50fGVufDF8MHx8fDE3ODU3ODI5MDl8MA&ixlib=rb-4.1.0&q=80&w=1080",
    authorName: "CHUTTERSNAP",
    authorUrl: "https://unsplash.com/@chuttersnap?utm_source=avably&utm_medium=referral",
    downloadLocation: "https://api.unsplash.com/photos/aEnH4hJ_Mrs/download?ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8MXx8YmFucXVldCUyMHRhYmxlJTIwc2V0dGluZyUyMGV2ZW50fGVufDF8MHx8fDE3ODU3ODI5MDl8MA",
  },
  "event-gallery-2": {
    kind: "unsplash",
    url: "https://images.unsplash.com/photo-1664369820391-dd2cbfe9320b?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8Nnx8cGFydHklMjBtYXJxdWVlJTIwZGFuY2UlMjBmbG9vcnxlbnwxfDB8fHwxNzg1NzgyOTEwfDA&ixlib=rb-4.1.0&q=80&w=1080",
    authorName: "Edward Howell",
    authorUrl: "https://unsplash.com/@edwardhowellphotography?utm_source=avably&utm_medium=referral",
    downloadLocation: "https://api.unsplash.com/photos/z80bSH93Wk4/download?ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8Nnx8cGFydHklMjBtYXJxdWVlJTIwZGFuY2UlMjBmbG9vcnxlbnwxfDB8fHwxNzg1NzgyOTEwfDA",
  },
  "event-gallery-3": {
    kind: "unsplash",
    url: "https://images.unsplash.com/photo-1782567533046-5836e95216b7?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8MXx8b3V0ZG9vciUyMGNlcmVtb255JTIwY2hhaXJzfGVufDF8MHx8fDE3ODU3ODI5MTB8MA&ixlib=rb-4.1.0&q=80&w=1080",
    authorName: "jason hu",
    authorUrl: "https://unsplash.com/@hujason?utm_source=avably&utm_medium=referral",
    downloadLocation: "https://api.unsplash.com/photos/9SpwaoeIe1U/download?ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8MXx8b3V0ZG9vciUyMGNlcmVtb255JTIwY2hhaXJzfGVufDF8MHx8fDE3ODU3ODI5MTB8MA",
  },
  "photo-hero": {
    kind: "unsplash",
    url: "https://images.unsplash.com/photo-1727451139462-cd34008cd50b?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8NHx8Y2luZW1hJTIwY2FtZXJhJTIwc3R1ZGlvJTIwbGlnaHRpbmclMjBkYXJrfGVufDF8MHx8fDE3ODU3ODI5MTF8MA&ixlib=rb-4.1.0&q=80&w=1080",
    authorName: "Joshua Wann",
    authorUrl: "https://unsplash.com/@joshuawann?utm_source=avably&utm_medium=referral",
    downloadLocation: "https://api.unsplash.com/photos/nue6Esmpk3M/download?ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8NHx8Y2luZW1hJTIwY2FtZXJhJTIwc3R1ZGlvJTIwbGlnaHRpbmclMjBkYXJrfGVufDF8MHx8fDE3ODU3ODI5MTF8MA",
  },
  "photo-studio": {
    kind: "unsplash",
    url: "https://images.unsplash.com/photo-1611558245524-aff4541a18d2?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8OHx8cGhvdG9ncmFwaHklMjBzdHVkaW8lMjBsaWdodGluZyUyMGVxdWlwbWVudHxlbnwxfDB8fHwxNzg1NzgyOTEyfDA&ixlib=rb-4.1.0&q=80&w=1080",
    authorName: "Aditya Wardhana",
    authorUrl: "https://unsplash.com/@wardhanaaditya?utm_source=avably&utm_medium=referral",
    downloadLocation: "https://api.unsplash.com/photos/ckF9dDIWS70/download?ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8OHx8cGhvdG9ncmFwaHklMjBzdHVkaW8lMjBsaWdodGluZyUyMGVxdWlwbWVudHxlbnwxfDB8fHwxNzg1NzgyOTEyfDA",
  },
  "lean-hero": {
    kind: "unsplash",
    url: "https://images.unsplash.com/photo-1767362218883-d6ee7f73234f?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8Mnx8d29ya3Nob3AlMjB0b29scyUyMGRheWxpZ2h0JTIwbWluaW1hbHxlbnwxfDB8fHwxNzg1NzgyOTEyfDA&ixlib=rb-4.1.0&q=80&w=1080",
    authorName: "Thamy N.",
    authorUrl: "https://unsplash.com/@thamyn?utm_source=avably&utm_medium=referral",
    downloadLocation: "https://api.unsplash.com/photos/VPcrHS7TTCs/download?ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8Mnx8d29ya3Nob3AlMjB0b29scyUyMGRheWxpZ2h0JTIwbWluaW1hbHxlbnwxfDB8fHwxNzg1NzgyOTEyfDA",
  },
  "lean-workshop": {
    kind: "unsplash",
    url: "https://images.unsplash.com/photo-1661446600373-125cfeadf275?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8Mnx8Y3JhZnRzbWFuJTIwd29ya2JlbmNoJTIwd2FybSUyMGxpZ2h0fGVufDF8MHx8fDE3ODU3ODI5MTN8MA&ixlib=rb-4.1.0&q=80&w=1080",
    authorName: "Alex Gruber",
    authorUrl: "https://unsplash.com/@alex_gruber?utm_source=avably&utm_medium=referral",
    downloadLocation: "https://api.unsplash.com/photos/96-ZnaO4NfI/download?ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8Mnx8Y3JhZnRzbWFuJTIwd29ya2JlbmNoJTIwd2FybSUyMGxpZ2h0fGVufDF8MHx8fDE3ODU3ODI5MTN8MA",
  },
  "catalog-hero": {
    kind: "unsplash",
    url: "https://images.unsplash.com/photo-1644079446600-219068676743?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8MXx8d2FyZWhvdXNlJTIwc2hlbHZlcyUyMG9yZ2FuaXNlZCUyMGVxdWlwbWVudHxlbnwxfDB8fHwxNzg1NzgyOTE0fDA&ixlib=rb-4.1.0&q=80&w=1080",
    authorName: "Lance Chang",
    authorUrl: "https://unsplash.com/@carmendis?utm_source=avably&utm_medium=referral",
    downloadLocation: "https://api.unsplash.com/photos/h3pVxOIpnzk/download?ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8MXx8d2FyZWhvdXNlJTIwc2hlbHZlcyUyMG9yZ2FuaXNlZCUyMGVxdWlwbWVudHxlbnwxfDB8fHwxNzg1NzgyOTE0fDA",
  },
  "catalog-delivery": {
    kind: "unsplash",
    url: "https://images.unsplash.com/photo-1755604755875-47342801c3dd?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8N3x8ZGVsaXZlcnklMjB2YW4lMjBsb2FkaW5nJTIwZGF5bGlnaHR8ZW58MXwwfHx8MTc4NTc4MjkxNHww&ixlib=rb-4.1.0&q=80&w=1080",
    authorName: "Johnny Ho",
    authorUrl: "https://unsplash.com/@johnnyho_ho?utm_source=avably&utm_medium=referral",
    downloadLocation: "https://api.unsplash.com/photos/-megUSP6-0c/download?ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8N3x8ZGVsaXZlcnklMjB2YW4lMjBsb2FkaW5nJTIwZGF5bGlnaHR8ZW58MXwwfHx8MTc4NTc4MjkxNHww",
  },
};

/**
 * Kadr slotu w postaci, w jakiej wchodzi do treści sekcji. Zwraca `undefined`
 * dla slotu bez kadru — sekcja renderuje wtedy kafel zastępczy w tym samym
 * pudełku, więc brak kuracji nie zmienia układu strony ani o jednostkę.
 */
export function starterPhoto(slot: StarterPhotoSlot): ImageSource | undefined {
  const photo = STARTER_PHOTOS[slot];
  if (!photo) return undefined;
  // Parsujemy PRZY ODCZYCIE, a nie tylko w teście: wpis bez kompletu atrybucji
  // ma nie dojechać do strony najemcy nawet wtedy, gdy ktoś ominie kontrakt.
  const parsed = imageSourceSchema.safeParse(photo);
  return parsed.success ? parsed.data : undefined;
}
