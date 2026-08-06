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
  "construction-gallery-1",
  "construction-gallery-2",
  "construction-gallery-3",
  "construction-gallery-4",
  "construction-gallery-5",
  "bike-hero",
  "bike-location",
  "bike-gallery-1",
  "bike-gallery-2",
  "bike-gallery-3",
  "bike-gallery-4",
  "bike-gallery-5",
  "event-hero",
  "event-gallery-1",
  "event-gallery-2",
  "event-gallery-3",
  "event-gallery-4",
  "event-gallery-5",
  "event-gallery-6",
  "event-gallery-7",
  "event-gallery-8",
  "photo-hero",
  "photo-studio",
  "photo-gallery-1",
  "photo-gallery-2",
  "photo-gallery-3",
  "photo-gallery-4",
  "photo-gallery-5",
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
  "construction-gallery-1": "scaffolding building facade construction",
  "construction-gallery-2": "plate compactor worker asphalt",
  "construction-gallery-3": "portable generator construction site",
  "construction-gallery-4": "jackhammer breaker concrete worker",
  "construction-gallery-5": "aerial work platform boom lift site",
  "bike-hero": "mountain bike rider trail action",
  "bike-location": "bicycle workshop shop interior",
  "bike-gallery-1": "row of bicycles for rent rack",
  "bike-gallery-2": "cycling helmet gear equipment",
  "bike-gallery-3": "family cycling path summer",
  "bike-gallery-4": "electric bike city street",
  "bike-gallery-5": "bicycle wheel repair workshop hands",
  "event-hero": "outdoor wedding tent string lights evening",
  "event-gallery-1": "banquet table setting event",
  "event-gallery-2": "party marquee dance floor",
  "event-gallery-3": "event chairs rows outdoor ceremony",
  "event-gallery-4": "wedding reception fairy lights tent evening",
  "event-gallery-5": "catering buffet table event",
  "event-gallery-6": "stage lighting truss event",
  "event-gallery-7": "round tables white linen reception",
  "event-gallery-8": "garden party tent outdoor",
  "photo-hero": "film camera cinema lighting dark studio",
  "photo-studio": "photography studio softbox equipment",
  "photo-gallery-1": "cinema camera rig shoulder",
  "photo-gallery-2": "camera lenses collection dark",
  "photo-gallery-3": "film set lighting stands",
  "photo-gallery-4": "gimbal stabilizer camera operator",
  "photo-gallery-5": "photo studio backdrop seamless",
  "lean-hero": "warm minimal workshop tools daylight",
  "lean-workshop": "craftsman workbench warm light",
  "catalog-hero": "clean product shelves warehouse organised",
  "catalog-delivery": "delivery van loading parcels daylight",
};

/**
 * KADRY — pierwsza kuracja 2026-08-03 (hero i pasma), druga 2026-08-06 (E9:
 * galerie szablonów), obie przez API dostawcy, wartości WPROST z odpowiedzi
 * (adres, nazwisko autora, profil, wyzwalacz pobrania). Do linku profilu
 * doklejone są parametry atrybucji wymagane regulaminem — te same, które
 * dokłada picker w kreatorze (`withAttribution` w apps/panel/lib/unsplash.ts).
 *
 * Każdy kadr obejrzany w DWÓCH przycięciach: poziomym (desktop) i pionowym
 * 2:3 (auto-układ mobilny przy 390 px). Kadr, który po zwężeniu tracił temat,
 * nie wchodził — stąd np. rezygnacja z panoram budowy na rzecz maszyny
 * w pionie i wymiana zapytania dla warsztatu rowerowego. W E9 z tego samego
 * powodu wypadło zapytanie „wedding string lights marquee": dostawca czyta
 * „marquee" jako neon nad wejściem do kina, więc wracały szyldy, a nie namiot.
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
  "construction-gallery-1": {
    kind: "unsplash",
    url: "https://images.unsplash.com/photo-1504964670878-71b73cec0ce1?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8Mnx8c2NhZmZvbGRpbmclMjBidWlsZGluZyUyMGZhY2FkZSUyMGNvbnN0cnVjdGlvbnxlbnwxfDB8fHwxNzg2MDAzNTY4fDA&ixlib=rb-4.1.0&q=80&w=1080",
    authorName: "Reto Simonet",
    authorUrl: "https://unsplash.com/@reetoo?utm_source=avably&utm_medium=referral",
    downloadLocation: "https://api.unsplash.com/photos/WN9QRESOu5c/download?ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8Mnx8c2NhZmZvbGRpbmclMjBidWlsZGluZyUyMGZhY2FkZSUyMGNvbnN0cnVjdGlvbnxlbnwxfDB8fHwxNzg2MDAzNTY4fDA",
  },
  "construction-gallery-2": {
    kind: "unsplash",
    url: "https://images.unsplash.com/photo-1779384896076-51cbd33c36ac?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8NXx8cGxhdGUlMjBjb21wYWN0b3IlMjB3b3JrZXIlMjBhc3BoYWx0fGVufDF8MHx8fDE3ODYwMDM1Njh8MA&ixlib=rb-4.1.0&q=80&w=1080",
    authorName: "Evan Porter",
    authorUrl: "https://unsplash.com/@evanporter?utm_source=avably&utm_medium=referral",
    downloadLocation: "https://api.unsplash.com/photos/iomm8RoI-vU/download?ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8NXx8cGxhdGUlMjBjb21wYWN0b3IlMjB3b3JrZXIlMjBhc3BoYWx0fGVufDF8MHx8fDE3ODYwMDM1Njh8MA",
  },
  "construction-gallery-3": {
    kind: "unsplash",
    url: "https://images.unsplash.com/photo-1658260867231-535a1f7c98b9?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8MXx8cG9ydGFibGUlMjBnZW5lcmF0b3IlMjBjb25zdHJ1Y3Rpb24lMjBzaXRlfGVufDF8MHx8fDE3ODYwMDM1Njl8MA&ixlib=rb-4.1.0&q=80&w=1080",
    authorName: "Dima Solomin",
    authorUrl: "https://unsplash.com/@solomin_d?utm_source=avably&utm_medium=referral",
    downloadLocation: "https://api.unsplash.com/photos/8gXzLPWPu7E/download?ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8MXx8cG9ydGFibGUlMjBnZW5lcmF0b3IlMjBjb25zdHJ1Y3Rpb24lMjBzaXRlfGVufDF8MHx8fDE3ODYwMDM1Njl8MA",
  },
  "construction-gallery-4": {
    kind: "unsplash",
    url: "https://images.unsplash.com/photo-1685464197144-790d716b8649?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8MXx8amFja2hhbW1lciUyMGJyZWFrZXIlMjBjb25jcmV0ZSUyMHdvcmtlcnxlbnwxfDB8fHwxNzg2MDAzNTcwfDA&ixlib=rb-4.1.0&q=80&w=1080",
    authorName: "Mélyna Côté",
    authorUrl: "https://unsplash.com/@laptiteminimaliste?utm_source=avably&utm_medium=referral",
    downloadLocation: "https://api.unsplash.com/photos/NxwMP5V57Zg/download?ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8MXx8amFja2hhbW1lciUyMGJyZWFrZXIlMjBjb25jcmV0ZSUyMHdvcmtlcnxlbnwxfDB8fHwxNzg2MDAzNTcwfDA",
  },
  "construction-gallery-5": {
    kind: "unsplash",
    url: "https://images.unsplash.com/photo-1765435149256-56f3ea3db68f?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8MXx8YWVyaWFsJTIwd29yayUyMHBsYXRmb3JtJTIwYm9vbSUyMGxpZnQlMjBzaXRlfGVufDF8MHx8fDE3ODYwMDM2MDB8MA&ixlib=rb-4.1.0&q=80&w=1080",
    authorName: "Sergej *****",
    authorUrl: "https://unsplash.com/@skstrannik?utm_source=avably&utm_medium=referral",
    downloadLocation: "https://api.unsplash.com/photos/nYZBLnfgUmQ/download?ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8MXx8YWVyaWFsJTIwd29yayUyMHBsYXRmb3JtJTIwYm9vbSUyMGxpZnQlMjBzaXRlfGVufDF8MHx8fDE3ODYwMDM2MDB8MA",
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
  "bike-gallery-1": {
    kind: "unsplash",
    url: "https://images.unsplash.com/photo-1632070554458-395ad71242ed?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8NXx8cm93JTIwb2YlMjBiaWN5Y2xlcyUyMGZvciUyMHJlbnQlMjByYWNrfGVufDF8MHx8fDE3ODYwMDM1NzF8MA&ixlib=rb-4.1.0&q=80&w=1080",
    authorName: "Julio Lopez",
    authorUrl: "https://unsplash.com/@juliolopez?utm_source=avably&utm_medium=referral",
    downloadLocation: "https://api.unsplash.com/photos/wihH78E0d5Q/download?ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8NXx8cm93JTIwb2YlMjBiaWN5Y2xlcyUyMGZvciUyMHJlbnQlMjByYWNrfGVufDF8MHx8fDE3ODYwMDM1NzF8MA",
  },
  "bike-gallery-2": {
    kind: "unsplash",
    url: "https://images.unsplash.com/photo-1591511275477-88f079d88154?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8Mnx8Y3ljbGluZyUyMGhlbG1ldCUyMGdlYXIlMjBlcXVpcG1lbnR8ZW58MXwwfHx8MTc4NjAwMzU3Mnww&ixlib=rb-4.1.0&q=80&w=1080",
    authorName: "bady abbas",
    authorUrl: "https://unsplash.com/@bady?utm_source=avably&utm_medium=referral",
    downloadLocation: "https://api.unsplash.com/photos/wCopCzgH5xc/download?ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8Mnx8Y3ljbGluZyUyMGhlbG1ldCUyMGdlYXIlMjBlcXVpcG1lbnR8ZW58MXwwfHx8MTc4NjAwMzU3Mnww",
  },
  "bike-gallery-3": {
    kind: "unsplash",
    url: "https://images.unsplash.com/photo-1773521478765-3bfd7d398456?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8NXx8ZmFtaWx5JTIwY3ljbGluZyUyMHBhdGglMjBzdW1tZXJ8ZW58MXwwfHx8MTc4NjAwMzU3Mnww&ixlib=rb-4.1.0&q=80&w=1080",
    authorName: "Sven Eisenschmidt",
    authorUrl: "https://unsplash.com/@sveneisenschmidt?utm_source=avably&utm_medium=referral",
    downloadLocation: "https://api.unsplash.com/photos/EgyX7h-CO3s/download?ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8NXx8ZmFtaWx5JTIwY3ljbGluZyUyMHBhdGglMjBzdW1tZXJ8ZW58MXwwfHx8MTc4NjAwMzU3Mnww",
  },
  "bike-gallery-4": {
    kind: "unsplash",
    url: "https://images.unsplash.com/photo-1758764046093-7ea3e9850eba?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8NHx8ZWxlY3RyaWMlMjBiaWtlJTIwY2l0eSUyMHN0cmVldHxlbnwxfDB8fHwxNzg2MDAzNTczfDA&ixlib=rb-4.1.0&q=80&w=1080",
    authorName: "Hiboy",
    authorUrl: "https://unsplash.com/@hiboyofficial?utm_source=avably&utm_medium=referral",
    downloadLocation: "https://api.unsplash.com/photos/9D18SHig-LA/download?ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8NHx8ZWxlY3RyaWMlMjBiaWtlJTIwY2l0eSUyMHN0cmVldHxlbnwxfDB8fHwxNzg2MDAzNTczfDA",
  },
  "bike-gallery-5": {
    kind: "unsplash",
    url: "https://images.unsplash.com/photo-1673870861511-cc572623d271?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8M3x8YmljeWNsZSUyMHdoZWVsJTIwcmVwYWlyJTIwd29ya3Nob3AlMjBoYW5kc3xlbnwxfDB8fHwxNzg2MDAzNTczfDA&ixlib=rb-4.1.0&q=80&w=1080",
    authorName: "Anton Savinov",
    authorUrl: "https://unsplash.com/@tonchik?utm_source=avably&utm_medium=referral",
    downloadLocation: "https://api.unsplash.com/photos/EsAWJPsVPNI/download?ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8M3x8YmljeWNsZSUyMHdoZWVsJTIwcmVwYWlyJTIwd29ya3Nob3AlMjBoYW5kc3xlbnwxfDB8fHwxNzg2MDAzNTczfDA",
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
  "event-gallery-4": {
    kind: "unsplash",
    url: "https://images.unsplash.com/photo-1622081627652-bc2fcb2e67df?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8MXx8d2VkZGluZyUyMHJlY2VwdGlvbiUyMGZhaXJ5JTIwbGlnaHRzJTIwdGVudCUyMGV2ZW5pbmd8ZW58MXwwfHx8MTc4NjAwMzcwM3ww&ixlib=rb-4.1.0&q=80&w=1080",
    authorName: "Shannon Elizabeth",
    authorUrl: "https://unsplash.com/@shanliz?utm_source=avably&utm_medium=referral",
    downloadLocation: "https://api.unsplash.com/photos/XXIiDzhcFfw/download?ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8MXx8d2VkZGluZyUyMHJlY2VwdGlvbiUyMGZhaXJ5JTIwbGlnaHRzJTIwdGVudCUyMGV2ZW5pbmd8ZW58MXwwfHx8MTc4NjAwMzcwM3ww",
  },
  "event-gallery-5": {
    kind: "unsplash",
    url: "https://images.unsplash.com/photo-1576842546422-60562b9242ae?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8Mnx8Y2F0ZXJpbmclMjBidWZmZXQlMjB0YWJsZSUyMGV2ZW50fGVufDF8MHx8fDE3ODYwMDM1NzR8MA&ixlib=rb-4.1.0&q=80&w=1080",
    authorName: "Yukiko Kanada",
    authorUrl: "https://unsplash.com/@okikuy0930?utm_source=avably&utm_medium=referral",
    downloadLocation: "https://api.unsplash.com/photos/Ou4CQo6jzvU/download?ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8Mnx8Y2F0ZXJpbmclMjBidWZmZXQlMjB0YWJsZSUyMGV2ZW50fGVufDF8MHx8fDE3ODYwMDM1NzR8MA",
  },
  "event-gallery-6": {
    kind: "unsplash",
    url: "https://images.unsplash.com/photo-1727096857692-e9dadf2bc92e?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8MXx8c3RhZ2UlMjBsaWdodGluZyUyMHRydXNzJTIwZXZlbnR8ZW58MXwwfHx8MTc4NjAwMzU3NXww&ixlib=rb-4.1.0&q=80&w=1080",
    authorName: "Ambitious Studio* | Rick Barrett",
    authorUrl: "https://unsplash.com/@weareambitious?utm_source=avably&utm_medium=referral",
    downloadLocation: "https://api.unsplash.com/photos/Ugzhg8-tO3U/download?ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8MXx8c3RhZ2UlMjBsaWdodGluZyUyMHRydXNzJTIwZXZlbnR8ZW58MXwwfHx8MTc4NjAwMzU3NXww",
  },
  "event-gallery-7": {
    kind: "unsplash",
    url: "https://images.unsplash.com/photo-1677129661406-114c058df06c?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8NXx8cm91bmQlMjB0YWJsZXMlMjB3aGl0ZSUyMGxpbmVuJTIwcmVjZXB0aW9ufGVufDF8MHx8fDE3ODYwMDM1NzZ8MA&ixlib=rb-4.1.0&q=80&w=1080",
    authorName: "Quang Nguyen Vinh",
    authorUrl: "https://unsplash.com/@quangpraha?utm_source=avably&utm_medium=referral",
    downloadLocation: "https://api.unsplash.com/photos/lQXe3oNZ8YY/download?ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8NXx8cm91bmQlMjB0YWJsZXMlMjB3aGl0ZSUyMGxpbmVuJTIwcmVjZXB0aW9ufGVufDF8MHx8fDE3ODYwMDM1NzZ8MA",
  },
  "event-gallery-8": {
    kind: "unsplash",
    url: "https://images.unsplash.com/photo-1772127822525-7eda37383b9f?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8Nnx8Z2FyZGVuJTIwcGFydHklMjB0ZW50JTIwb3V0ZG9vcnxlbnwxfDB8fHwxNzg2MDAzNTc2fDA&ixlib=rb-4.1.0&q=80&w=1080",
    authorName: "Vidit Goswami",
    authorUrl: "https://unsplash.com/@viditgoswami?utm_source=avably&utm_medium=referral",
    downloadLocation: "https://api.unsplash.com/photos/Zi_NOBHIk9A/download?ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8Nnx8Z2FyZGVuJTIwcGFydHklMjB0ZW50JTIwb3V0ZG9vcnxlbnwxfDB8fHwxNzg2MDAzNTc2fDA",
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
  "photo-gallery-1": {
    kind: "unsplash",
    url: "https://images.unsplash.com/photo-1574304904744-2e6919c5a2a9?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8Nnx8Y2luZW1hJTIwY2FtZXJhJTIwcmlnJTIwc2hvdWxkZXJ8ZW58MXwwfHx8MTc4NjAwMzU3N3ww&ixlib=rb-4.1.0&q=80&w=1080",
    authorName: "Jakob Owens",
    authorUrl: "https://unsplash.com/@jakobowens1?utm_source=avably&utm_medium=referral",
    downloadLocation: "https://api.unsplash.com/photos/w3FkreIe4ho/download?ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8Nnx8Y2luZW1hJTIwY2FtZXJhJTIwcmlnJTIwc2hvdWxkZXJ8ZW58MXwwfHx8MTc4NjAwMzU3N3ww",
  },
  "photo-gallery-2": {
    kind: "unsplash",
    url: "https://images.unsplash.com/photo-1526063803516-3fd204f18b75?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8M3x8Y2FtZXJhJTIwbGVuc2VzJTIwY29sbGVjdGlvbiUyMGRhcmt8ZW58MXwwfHx8MTc4NjAwMzU3OHww&ixlib=rb-4.1.0&q=80&w=1080",
    authorName: "lucas Favre",
    authorUrl: "https://unsplash.com/@we_are_rising?utm_source=avably&utm_medium=referral",
    downloadLocation: "https://api.unsplash.com/photos/zae9zxwLbrA/download?ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8M3x8Y2FtZXJhJTIwbGVuc2VzJTIwY29sbGVjdGlvbiUyMGRhcmt8ZW58MXwwfHx8MTc4NjAwMzU3OHww",
  },
  "photo-gallery-3": {
    kind: "unsplash",
    url: "https://images.unsplash.com/photo-1637250096679-c10f2751def8?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8NXx8ZmlsbSUyMHNldCUyMGxpZ2h0aW5nJTIwc3RhbmRzfGVufDF8MHx8fDE3ODYwMDM1Nzl8MA&ixlib=rb-4.1.0&q=80&w=1080",
    authorName: "Jakob Owens",
    authorUrl: "https://unsplash.com/@jakobowens1?utm_source=avably&utm_medium=referral",
    downloadLocation: "https://api.unsplash.com/photos/ZSSuEANDxM0/download?ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8NXx8ZmlsbSUyMHNldCUyMGxpZ2h0aW5nJTIwc3RhbmRzfGVufDF8MHx8fDE3ODYwMDM1Nzl8MA",
  },
  "photo-gallery-4": {
    kind: "unsplash",
    url: "https://images.unsplash.com/photo-1623157072268-829727d352bd?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8Mnx8Z2ltYmFsJTIwc3RhYmlsaXplciUyMGNhbWVyYSUyMG9wZXJhdG9yfGVufDF8MHx8fDE3ODYwMDM1Nzl8MA&ixlib=rb-4.1.0&q=80&w=1080",
    authorName: "Rafa Sanfilippo",
    authorUrl: "https://unsplash.com/@rafasanfilippo?utm_source=avably&utm_medium=referral",
    downloadLocation: "https://api.unsplash.com/photos/Kq8qKbXAKFY/download?ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8Mnx8Z2ltYmFsJTIwc3RhYmlsaXplciUyMGNhbWVyYSUyMG9wZXJhdG9yfGVufDF8MHx8fDE3ODYwMDM1Nzl8MA",
  },
  "photo-gallery-5": {
    kind: "unsplash",
    url: "https://images.unsplash.com/photo-1648740678671-c37d78567ea8?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8Mnx8cGhvdG8lMjBzdHVkaW8lMjBiYWNrZHJvcCUyMHNlYW1sZXNzfGVufDF8MHx8fDE3ODYwMDM1ODB8MA&ixlib=rb-4.1.0&q=80&w=1080",
    authorName: "KOBU Agency",
    authorUrl: "https://unsplash.com/@kobuagency?utm_source=avably&utm_medium=referral",
    downloadLocation: "https://api.unsplash.com/photos/O8AtzoQcnY4/download?ixid=M3wxMDE1NzU1fDB8MXxzZWFyY2h8Mnx8cGhvdG8lMjBzdHVkaW8lMjBiYWNrZHJvcCUyMHNlYW1sZXNzfGVufDF8MHx8fDE3ODYwMDM1ODB8MA",
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
 * SLOTY, Z KTÓRYCH POWSTAJE PRESET GALERII STRUKTURALNEJ (E3, aneks ADR-094).
 *
 * Preset sekcji v3 ma pokazywać, CZYM galeria jest — czyli realnymi kadrami,
 * a nie trzema szarymi kaflami. Bierzemy je z tej samej kuracji, co szablony
 * startowe, zamiast wklejać drugi komplet adresów: wymiana kadru przy
 * najbliższej kuracji przestawia wtedy szablon i preset naraz, a atrybucja
 * zostaje JEDNA (warunek licencji, nie ozdoba).
 *
 * Kolejność slotów jest kolejnością wpisów w presecie.
 */
export const GALLERY_PRESET_SLOTS = [
  "event-gallery-1",
  "event-gallery-2",
  "event-gallery-3",
] as const satisfies readonly StarterPhotoSlot[];

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
