import { describe, expect, it } from "vitest";

import {
  decodeXmlEntities,
  extractDecodedResult,
  extractSoapEnvelope,
  extractTag,
  isSoapFault,
} from "./xml";

/**
 * Odpowiedzi wklejone DOSŁOWNIE z ręcznej sondy środowiska testowego GUS
 * (2026-08-24, `wyszukiwarkaregontest.stat.gov.pl`, klucz publiczny
 * `abcde12345abcde12345`) — nie są zmyślone, to realny kształt na drucie
 * (multipart/MTOM, podwójnie zakodowany XML w `XxxResult`).
 */
const MTOM_LOGIN_RESPONSE = `
--uuid:24d21355-8fac-405f-b6f1-24d72afdab80+id=118661
Content-ID: <http://tempuri.org/0>
Content-Transfer-Encoding: 8bit
Content-Type: application/xop+xml;charset=utf-8;type="application/soap+xml"

<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:a="http://www.w3.org/2005/08/addressing"><s:Header><a:Action s:mustUnderstand="1">http://CIS/BIR/PUBL/2014/07/IUslugaBIRzewnPubl/ZalogujResponse</a:Action></s:Header><s:Body><ZalogujResponse xmlns="http://CIS/BIR/PUBL/2014/07"><ZalogujResult>856hn4vd246c5kcwv4cd</ZalogujResult></ZalogujResponse></s:Body></s:Envelope>
--uuid:24d21355-8fac-405f-b6f1-24d72afdab80+id=118661--`;

const MTOM_SEARCH_RESPONSE = `
--uuid:24d21355-8fac-405f-b6f1-24d72afdab80+id=119378
Content-ID: <http://tempuri.org/0>
Content-Transfer-Encoding: 8bit
Content-Type: application/xop+xml;charset=utf-8;type="application/soap+xml"

<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:a="http://www.w3.org/2005/08/addressing"><s:Header><a:Action s:mustUnderstand="1">http://CIS/BIR/PUBL/2014/07/IUslugaBIRzewnPubl/DaneSzukajPodmiotyResponse</a:Action></s:Header><s:Body><DaneSzukajPodmiotyResponse xmlns="http://CIS/BIR/PUBL/2014/07"><DaneSzukajPodmiotyResult>&lt;root&gt;&#xD;
  &lt;dane&gt;&#xD;
    &lt;Regon&gt;610188201&lt;/Regon&gt;&#xD;
    &lt;Nip&gt;7740001454&lt;/Nip&gt;&#xD;
    &lt;StatusNip /&gt;&#xD;
    &lt;Nazwa&gt;POLSKI KONCERN NAFTOWY ORLEN SPÓŁKA AKCYJNA&lt;/Nazwa&gt;&#xD;
    &lt;Typ&gt;P&lt;/Typ&gt;&#xD;
    &lt;SilosID&gt;6&lt;/SilosID&gt;&#xD;
  &lt;/dane&gt;&#xD;
&lt;/root&gt;</DaneSzukajPodmiotyResult></DaneSzukajPodmiotyResponse></s:Body></s:Envelope>
--uuid:24d21355-8fac-405f-b6f1-24d72afdab80+id=119378--`;

const MTOM_INVALID_SID_RESPONSE = `
--uuid:24d21355-8fac-405f-b6f1-24d72afdab80+id=120950
Content-ID: <http://tempuri.org/0>
Content-Transfer-Encoding: 8bit
Content-Type: application/xop+xml;charset=utf-8;type="application/soap+xml"

<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:a="http://www.w3.org/2005/08/addressing"><s:Header><a:Action s:mustUnderstand="1">http://CIS/BIR/PUBL/2014/07/IUslugaBIRzewnPubl/DaneSzukajPodmiotyResponse</a:Action></s:Header><s:Body><DaneSzukajPodmiotyResponse xmlns="http://CIS/BIR/PUBL/2014/07"><DaneSzukajPodmiotyResult/></DaneSzukajPodmiotyResponse></s:Body></s:Envelope>
--uuid:24d21355-8fac-405f-b6f1-24d72afdab80+id=120950--`;

describe("decodeXmlEntities", () => {
  it("dekoduje encje w poprawnej kolejności (amp na końcu)", () => {
    expect(decodeXmlEntities("&lt;a&gt;Ala &amp; Kot&lt;/a&gt;")).toBe("<a>Ala & Kot</a>");
  });

  it("dekoduje CR (&#xD;) i encje dziesiętne", () => {
    expect(decodeXmlEntities("a&#xD;b&#10;c")).toBe("a\rb\nc");
  });
});

describe("extractSoapEnvelope", () => {
  it("wyciąga kopertę z odpowiedzi MTOM/multipart, ignorując opakowanie MIME", () => {
    const envelope = extractSoapEnvelope(MTOM_LOGIN_RESPONSE);
    expect(envelope).not.toBeNull();
    expect(envelope).toContain("<ZalogujResult>856hn4vd246c5kcwv4cd</ZalogujResult>");
    expect(envelope).toMatch(/^<s:Envelope/);
  });

  it("działa też na gołej kopercie SOAP (bez MIME)", () => {
    const plain = "<soap:Envelope><soap:Body>x</soap:Body></soap:Envelope>";
    expect(extractSoapEnvelope(plain)).toBe(plain);
  });

  it("zwraca null, gdy odpowiedź nie jest SOAP-em", () => {
    expect(extractSoapEnvelope("<html>błąd serwera</html>")).toBeNull();
  });
});

describe("extractTag", () => {
  it("wyciąga sid z odpowiedzi Zaloguj", () => {
    const envelope = extractSoapEnvelope(MTOM_LOGIN_RESPONSE)!;
    expect(extractTag(envelope, "ZalogujResult")).toBe("856hn4vd246c5kcwv4cd");
  });

  it("zwraca null dla znacznika samozamykającego", () => {
    expect(extractTag("<Foo><Bar /></Foo>", "Bar")).toBeNull();
  });

  it("zwraca null dla nieobecnego znacznika", () => {
    expect(extractTag("<Foo><Bar>x</Bar></Foo>", "Baz")).toBeNull();
  });
});

describe("isSoapFault", () => {
  it("wykrywa s:Fault", () => {
    expect(isSoapFault("<s:Envelope><s:Body><s:Fault>x</s:Fault></s:Body></s:Envelope>")).toBe(true);
  });

  it("nie zgłasza fałszywego alarmu na zwykłej odpowiedzi", () => {
    const envelope = extractSoapEnvelope(MTOM_SEARCH_RESPONSE)!;
    expect(isSoapFault(envelope)).toBe(false);
  });
});

describe("extractDecodedResult — podwójnie zakodowany XML GUS", () => {
  it("dekoduje DaneSzukajPodmiotyResult do wewnętrznego XML-a i pozwala wyciągnąć pola", () => {
    const envelope = extractSoapEnvelope(MTOM_SEARCH_RESPONSE)!;
    const inner = extractDecodedResult(envelope, "DaneSzukajPodmiotyResult");
    expect(inner).not.toBeNull();
    expect(extractTag(inner!, "Regon")).toBe("610188201");
    expect(extractTag(inner!, "Nip")).toBe("7740001454");
    expect(extractTag(inner!, "Nazwa")).toBe("POLSKI KONCERN NAFTOWY ORLEN SPÓŁKA AKCYJNA");
    expect(extractTag(inner!, "Typ")).toBe("P");
    expect(extractTag(inner!, "SilosID")).toBe("6");
    // Pole puste w GUS (samozamykający znacznik) — obecne w schemacie, brak wartości.
    expect(extractTag(inner!, "StatusNip")).toBeNull();
  });

  it("zwraca null, gdy XxxResult jest puste — sygnatura nieważnego/wygasłego sid", () => {
    const envelope = extractSoapEnvelope(MTOM_INVALID_SID_RESPONSE)!;
    expect(extractDecodedResult(envelope, "DaneSzukajPodmiotyResult")).toBeNull();
  });
});
