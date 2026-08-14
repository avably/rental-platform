/**
 * Bramki screenów LP. Obrazy są częścią dowodu produktu, więc sam poprawny
 * adres nie wystarcza: stary plik pod tą samą nazwą ma palić test.
 */
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import en from "../messages/en.json";
import pl from "../messages/pl.json";

const root = path.resolve(__dirname, "..");

const UJECIA = {
  kalendarz: { width: 1528, height: 764 },
  kaucje: { width: 1528, height: 764 },
  kurier: { width: 1528, height: 764 },
  kreator: { width: 1528, height: 764 },
  koszyk: { width: 1528, height: 764 },
  pulpit: { width: 1312, height: 874 },
  rejestracja: { width: 906, height: 679 },
  katalog: { width: 906, height: 679 },
  zamowienia: { width: 906, height: 679 },
} as const;

/**
 * Sumy kontrolne WYCOFANYCH plików — każdy powrót do któregokolwiek z nich
 * pali suitę. Lista ROŚNIE z każdą wymianą ujęć; gdyby zostawała tylko przy
 * pierwszym pokoleniu, broniłaby wyłącznie makiet, a dokładnie ta wersja,
 * którą ostatnio uznaliśmy za wadliwą, mogłaby wrócić bez śladu.
 *
 * Pokolenie 1 (do PR #322): makiety z szablonu.
 * Pokolenie 2 (PR #322, aneks ADR-184): prawdziwe zrzuty, ale w kadrach
 *   ucinających etykiety w połowie słowa („ZEDAŻ" zamiast „SPRZEDAŻ").
 */
const STARE_SUMY = new Set([
  // pokolenie 1 — makiety z szablonu
  "5f1af0025b0cbf37131f6cbaf633c7642f2642aaefffe025b59cba73c5dc877a",
  "5fff7dbe1170420cbc0f6ee4041446690e4a2b25cedfb81ab1b7b958755de7cb",
  "dbaa08892a350fdedba2de07d5e83af826d89986dded4a9b256313bd400e8f5e",
  "b988650cb2c92db1efa50c92fe9692e0a7cc0b6e310c1723d226044731fc6a7f",
  "1630be91aad1e8b46666ed66c46aeb2676eaa906dbbfbb08407c7008463d7e37",
  "d590d46fbbe9aa66155f6b49fdf5d42827386e411155c6604eac2e1d66a17953",
  "2641fa78b23eda0ed0004d9bafa74fd72552895b0451305f26a14e900686f235",
  "b4c2c488868a1a0048628f75eab74b0acf96d58e3f62cd815f741655c7b5ca05",
  "2c305a33f0e79bf0f30dad54794219bc067d34d634bd1d6cfea899c05cc23f8f",
  "b16e05b9f6f86889b1462a875b76f33a4841334043e6648bea9da3aa4bf100fc",
  "4acee801e0cb2efae812903d9b9301d93c991d2b4a5da8a0c84dc7443fd6c151",
  "c067ca0638c28cb51f393a7fc27cf5de877f96cc519a1b053fc4485f499c983c",
  "ba42953b7efafef3b4475b9c44c72064a7abce2af045fdc6c8120cc8abec1186",
  "082c0a38c6ca758a04f90395650adb4233961a38b1c29dec32cec12f3052a717",
  "90302791388fc11907fd24abc38db08a928f1218670c775fb1d8a7ce0116aca3",
  "0200569e8649644a52c2d4c41dcd2515875b7ea00380e97db262e4c29b68a059",
  "e5e3c3d59c1b940f65496e989e000afee2bec2742bfc961afe1336e0df11eee4",
  "3b1e6be647b2079f5244aebf8f4425dc92fd819df9d05bad5c8d5dfe709f310a",
  // pokolenie 2 — zrzuty z PR #322, kadry ucinające etykiety
  "f91ca36d5d345a9b2f83edcc4af5d6a6b314f9fbc133bcb36f1d4452f853a610", // pl/kalendarz
  "183a1cec3d4f1cec5440c670d7473cee1ffa6aca6615121b17ba1af8d1781e2e", // pl/kaucje
  "4bbc306b53e9e5f56d117d625db6b884483f1905afb985ae240783221d00b228", // pl/kurier
  "6116258fb0cd064035611d137dc750153a653705056e7ce0d439a6913d58840f", // pl/kreator
  "0b860838667f189ac185f0d3d9d0d12c469d394bd49df2f876263fa915e8395d", // pl/koszyk
  "b400f29bb9335bb5b3a22b247b8ae42a03d85fd83848c546a7bf2532895180a9", // pl/pulpit
  "11308a4e1ddfde64ca671a0000a22e51b8b6222c2a858eef5fd2f3bbbcbde145", // pl/rejestracja
  "d76e72b8a2d2337cc3a9b07548648bf7d0f899a35ae079630822d9be12771419", // pl/katalog
  "d30ed380d896d6441c80e695c5d2aaced27328bd11f68c10a0b26d11ab5405de", // pl/zamowienia
  "e672b24a30a8fc1ebc9f65ead2e370ce099ffa473ef422cb5edd40a91fb01021", // en/kalendarz
  "36a0cc985f722200212c8d260dbd34d72b0db77c9be02f4e689ecbe80a21142b", // en/kaucje
  "67357a7ddb8f2f5f9aa4f5b0a7fcf2c78e4dadcbe98a7957220ea78f715deb91", // en/kurier
  "a0a7e038c4b1a421bf4c68baff28f427c5c8983ae34d3b342906f53a4e81d261", // en/kreator
  "0e0c0cb88695abd0a5152677dd4202e7d06d53cf12589b9e7edba6b6d2485e33", // en/koszyk
  "9e3037543928901f4792c3a54a1008442027fb89d383cc73b966c116000b7e1d", // en/pulpit
  "cfae069f8c89e6c9404a9ae07809c19c6f0c12e5decf293ca0cbd216e09f2b81", // en/rejestracja
  "20f98dfba3f01b7c0558c464d272d94da84f3632e7c7a442ec841f53442c8592", // en/katalog
  "159679d507a897c8a0fea643d1d3be539638dd4605bf8192dae632c8bdebf42e", // en/zamowienia
]);

function wymiaryWebp(buffer: Buffer): { width: number; height: number } {
  expect(buffer.subarray(0, 4).toString("ascii")).toBe("RIFF");
  expect(buffer.subarray(8, 12).toString("ascii")).toBe("WEBP");
  const chunk = buffer.subarray(12, 16).toString("ascii");
  if (chunk === "VP8X") {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }
  if (chunk === "VP8 ") {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunk === "VP8L") {
    const bits = buffer.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  throw new Error(`Nieobsługiwany wariant WebP: ${chunk}`);
}

describe("aktualne screeny produktu na LP", () => {
  for (const [locale, messages] of [
    ["pl", pl],
    ["en", en],
  ] as const) {
    for (const [nazwa, kontrakt] of Object.entries(UJECIA)) {
      it(`${locale}/${nazwa}: świeży WebP o właściwej proporcji i z opisem`, () => {
        const src = messages.marketing.shots[nazwa as keyof typeof UJECIA];
        const alt = messages.marketing.shots[`${nazwa}Alt` as keyof typeof messages.marketing.shots];
        expect(src).toBe(`/produkt/${locale}/${nazwa}.webp`);
        expect(alt.length).toBeGreaterThanOrEqual(70);
        expect(alt).toMatch(/demonstr|demo/i);

        const buffer = readFileSync(path.join(root, "public", src));
        const suma = createHash("sha256").update(buffer).digest("hex");
        expect(STARE_SUMY.has(suma), `${locale}/${nazwa} nadal jest starym screenem`).toBe(false);

        const { width, height } = wymiaryWebp(buffer);
        expect(width, `${locale}/${nazwa}: szerokość`).toBe(kontrakt.width);
        expect(height, `${locale}/${nazwa}: wysokość`).toBe(kontrakt.height);
      });
    }
  }

  /**
   * Zrzuty produktu to największa pozycja wagowa landing page'u, a rosną
   * niepostrzeżenie: każda kolejna wymiana ujęć dokłada po kilka kilobajtów
   * na plik. Budżet 600 KB jest decyzją właściciela — bez bramki nikt nie
   * zauważy, kiedy zostanie przekroczony.
   */
  it("osiemnaście plików mieści się w budżecie wagowym LP", () => {
    let suma = 0;
    for (const locale of ["pl", "en"]) {
      for (const nazwa of Object.keys(UJECIA)) {
        suma += statSync(path.join(root, "public", "produkt", locale, `${nazwa}.webp`)).size;
      }
    }
    expect(suma, `suma wagi ujęć: ${(suma / 1024).toFixed(1)} KB`).toBeLessThanOrEqual(600 * 1024);
  });

  it("szablon zachowuje istniejące ramki i leniwe ładowanie dziewięciu ujęć", () => {
    const html = readFileSync(path.join(root, "marketing/home.html"), "utf8");
    expect(html.match(/class="zrzut-ui /g)).toHaveLength(9);
    expect(html.match(/loading="lazy"[^>]*class="zrzut-ui /g)).toHaveLength(9);
    expect(html.match(/class="tab-accordion-image"/g)).toHaveLength(5);
    expect(html.match(/class="momonetum-image zrzut-ramka-4-3"/g)).toHaveLength(3);
    expect(html.match(/class="cta-block-image zrzut-ramka-3-2"/g)).toHaveLength(1);
  });

  it("pięć zakładek mapuje grafiki dokładnie na etapy procesu", () => {
    const html = readFileSync(path.join(root, "marketing/home.html"), "utf8");
    const mapa = ["kreator", "koszyk", "kalendarz", "kurier", "kaucje"];

    for (const [index, nazwa] of mapa.entries()) {
      const tab = `Tab ${index + 1}`;
      const start = html.indexOf(`data-w-tab="${tab}"`, html.indexOf('class="tabs-content-features'));
      const end = html.indexOf(`data-w-tab="Tab ${index + 2}"`, start);
      const fragment = html.slice(start, end === -1 ? html.indexOf("</div>\n        </div>", start) : end);

      expect(start, `${tab}: brak panelu`).toBeGreaterThan(-1);
      expect(fragment).toContain(
        `<img src="{{shots.${nazwa}}}" alt="{{shots.${nazwa}Alt}}" loading="lazy" width="1528" height="764" class="zrzut-ui zrzut-ui-2-1">`,
      );
    }
  });
});
