/**
 * Bramka numeracji ADR (ADR-187) — `scripts/audit-adr-duplikaty.mjs`.
 *
 * Dwie warstwy, bo żadna sama nie wystarcza:
 *   1. DOWÓD BEHAWIORALNY — bramka wołana tak, jak woła ją CI (proces, argv,
 *      kod wyjścia). Skan pliku ma ślepą plamę: literał polecenia przeniesiony
 *      w inne miejsce nadal „jest w pliku", a bramka może nie robić nic.
 *   2. KONTRAKT WPIĘCIA — polecenie musi siedzieć w jobie `zakres`, a `zakres`
 *      musi biec BEZWARUNKOWO. Wpięcie w job `ci` byłoby martwym polem:
 *      `ci` jest pomijany dla zmian docs-only, czyli dokładnie tam, gdzie
 *      pilnowany plik bywa jedyną zmianą w PR-ze.
 *
 * Każda fikstura ma ADR-007 w DWÓCH egzemplarzach, bo taki jest zastany stan
 * `main` i taki opisuje wyjątek bramki — fikstura bez tego byłaby czerwona
 * z powodu martwego wyjątku, a nie z powodu badanej wady.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(process.cwd(), "../..");
const bramka = resolve(repositoryRoot, "scripts/audit-adr-duplikaty.mjs");
const zywaDokumentacja = resolve(repositoryRoot, "docs/dokumentacja/index.html");
const workflow = readFileSync(resolve(repositoryRoot, ".github/workflows/ci.yml"), "utf8");

/** Blok dziennika decyzji w kształcie, którego pilnuje wzorzec liczenia. */
function blok(numer: string, tytul = "decyzja"): string {
  return `<div class="log"><p class="h"><b>${numer}</b> · ${tytul}</p><p>treść.</p></div>`;
}

/** Fikstura: zastany duplikat ADR-007 plus podane bloki. */
function fikstura(...bloki: string[]): string {
  return [
    "<html><body>",
    blok("ADR-007", "Kanoniczne tokeny"),
    blok("ADR-007", "Custom claims z JWT"),
    ...bloki,
    "</body></html>",
  ].join("\n");
}

/** Uruchomienie bramki na treści zapisanej do pliku tymczasowego. */
function uruchom(tresc: string): { status: number; stdout: string; stderr: string } {
  const plik = join(mkdtempSync(join(tmpdir(), "avably-adr-")), "index.html");
  writeFileSync(plik, tresc, "utf8");
  return uruchomNa(plik);
}

function uruchomNa(sciezka: string): { status: number; stdout: string; stderr: string } {
  const wynik = spawnSync(process.execPath, [bramka, sciezka], { encoding: "utf8" });
  return { status: wynik.status ?? -1, stdout: wynik.stdout, stderr: wynik.stderr };
}

/** Klucze pierwszego poziomu joba (`    nazwa:`), bez kluczy kroków. */
function kluczeJoba(nazwa: string): string[] {
  const linie = workflow.split("\n");
  const start = linie.findIndex((linia) => linia === `  ${nazwa}:`);
  if (start === -1) return [];
  const reszta = linie.slice(start + 1);
  const koniec = reszta.findIndex((linia) => /^ {2}[A-Za-z][\w-]*:$/.test(linia));
  return (koniec === -1 ? reszta : reszta.slice(0, koniec))
    .map((linia) => /^ {4}([A-Za-z][\w-]*):/.exec(linia)?.[1])
    .filter((klucz): klucz is string => Boolean(klucz));
}

/** Blok YAML pojedynczego joba (od `  nazwa:` do następnego joba). */
function blokJoba(nazwa: string): string {
  const linie = workflow.split("\n");
  const start = linie.findIndex((linia) => linia === `  ${nazwa}:`);
  if (start === -1) return "";
  const reszta = linie.slice(start + 1);
  const koniec = reszta.findIndex((linia) => /^ {2}[A-Za-z][\w-]*:$/.test(linia));
  return (koniec === -1 ? reszta : reszta.slice(0, koniec)).join("\n");
}

describe("bramka numeracji ADR — dowód behawioralny", () => {
  it("żywa dokumentacja repo przechodzi (kontrola pozytywna)", () => {
    const { status, stdout } = uruchomNa(zywaDokumentacja);
    expect(stdout).toMatch(/bloków: \d+/);
    // Zero bloków oznaczałoby, że kontrola pozytywna niczego nie dowodzi.
    expect(stdout).not.toMatch(/bloków: 0,/);
    expect(status).toBe(0);
  });

  it("czysta numeracja przechodzi", () => {
    const { status } = uruchom(fikstura(blok("ADR-186"), blok("ADR-187")));
    expect(status).toBe(0);
  });

  it("duplikat numeru pali bramkę i nazywa numer", () => {
    const { status, stderr } = uruchom(
      fikstura(blok("ADR-187", "pierwsza praca"), blok("ADR-187", "druga praca")),
    );
    expect(status).toBe(1);
    expect(stderr).toContain("ADR-187: 2 bloki pod tym samym numerem");
  });

  it("pusty zbiór pali bramkę — wzorzec, który nic nie znalazł, niczego nie dowodzi", () => {
    // Szablon zmieniony tak, jak zmieniłaby go przebudowa dokumentacji:
    // ten sam wpis, inna klasa kontenera. Bez tej kontroli bramka byłaby
    // zielona na KAŻDYM pliku, także pełnym duplikatów.
    const zmienionySzablon = fikstura(blok("ADR-187"), blok("ADR-187")).replaceAll(
      'class="log"',
      'class="dziennik"',
    );
    const { status, stderr } = uruchom(zmienionySzablon);
    expect(status).toBe(1);
    expect(stderr).toContain("ANI JEDNEGO bloku ADR");
  });

  it("częściowy rozjazd szablonu pali bramkę, choć zbiór nie jest pusty", () => {
    // Białe znaki w JEDNYM bloku: wzorzec ścisły przestaje go widzieć, więc
    // liczba z bramki cicho przestaje być liczbą wszystkich wpisów.
    const rozjazd = `${fikstura(blok("ADR-186"))}\n<div class="log">\n  <p class="h"><b>ADR-187</b></p></div>`;
    const { status, stderr } = uruchom(rozjazd);
    expect(status).toBe(1);
    expect(stderr).toContain("wzorzec ścisły widzi");
  });

  it("zastany ADR-007 jest wyjątkiem, ale wyłącznie na dwa egzemplarze", () => {
    expect(uruchom(fikstura(blok("ADR-186"))).status).toBe(0);

    const trzeci = uruchom(fikstura(blok("ADR-007", "trzeci"), blok("ADR-186")));
    expect(trzeci.status).toBe(1);
    expect(trzeci.stderr).toContain("Nowy duplikat na numerze objętym wyjątkiem");
  });

  it("wyjątek, który przestał opisywać plik, pali bramkę jako martwy", () => {
    const jedenSiedem = ["<html>", blok("ADR-007"), blok("ADR-186"), "</html>"].join("\n");
    const { status, stderr } = uruchom(jedenSiedem);
    expect(status).toBe(1);
    expect(stderr).toContain("usuń go z ZASTANE_DUPLIKATY");
  });

  it("brak pliku to porażka, nie cisza — bramka jest fail-closed", () => {
    const { status } = uruchomNa(join(tmpdir(), "avably-adr-nie-ma-takiego-pliku.html"));
    expect(status).toBe(1);
  });
});

describe("bramka numeracji ADR — kontrakt wpięcia", () => {
  it("polecenie stoi w jobie `zakres`, nie gdziekolwiek w pliku", () => {
    // Wpięcie w job `ci` (jak bramki designu z ADR-183) byłoby martwym polem:
    // `ci` jest pomijany dla zmian docs-only, a pilnowany plik JEST
    // dokumentacją w rozumieniu klasyfikatora ADR-117.
    expect(blokJoba("zakres")).toContain("node scripts/audit-adr-duplikaty.mjs");
  });

  it("job `zakres` biegnie bezwarunkowo — bramka bez warunku pominięcia", () => {
    const klucze = kluczeJoba("zakres");
    expect(klucze).toContain("steps");
    expect(klucze).not.toContain("needs");
    expect(klucze).not.toContain("if");
  });
});
