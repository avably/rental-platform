import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { parseInlineBold, parseParagraphs, SafeRichText } from "./rich-text";

describe("parseParagraphs", () => {
  it("dzieli tekst na akapity po pustej linii i linie po \\n", () => {
    expect(parseParagraphs("Ala\nma kota\n\nDrugi akapit")).toEqual([
      ["Ala", "ma kota"],
      ["Drugi akapit"],
    ]);
  });

  it("pomija puste bloki i białe znaki", () => {
    expect(parseParagraphs("\n\n  \n\nTreść\n\n")).toEqual([["Treść"]]);
  });
});

describe("parseInlineBold", () => {
  it("paruje ** w pogrubienie", () => {
    expect(parseInlineBold("zwykły **mocny** dalej")).toEqual([
      { text: "zwykły ", bold: false },
      { text: "mocny", bold: true },
      { text: " dalej", bold: false },
    ]);
  });

  it("niesparowana gwiazdka zostaje zwykłym tekstem (bez wiszącego bold)", () => {
    expect(parseInlineBold("cena **od")).toEqual([{ text: "cena **od", bold: false }]);
  });
});

describe("SafeRichText — bramka XSS", () => {
  it("renderuje treść jako tekst, nie jako HTML (znaczniki zostają dosłowne)", () => {
    const { container } = render(
      <SafeRichText body={'<img src=x onerror="alert(1)"> i <script>alert(2)</script>'} />,
    );
    // Żaden <img>/<script> z treści nie trafia do DOM — to escapowany tekst.
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText(/onerror/)).toBeInTheDocument();
  });

  it("pogrubia sparowane ** przez <strong>", () => {
    render(<SafeRichText body="to jest **ważne**" />);
    expect(screen.getByText("ważne").tagName).toBe("STRONG");
  });

  it("pusty tekst nie renderuje nic", () => {
    const { container } = render(<SafeRichText body={"   \n  \n "} />);
    expect(container.firstChild).toBeNull();
  });
});
