// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FileField } from "./file-field";
import { Label } from "./label";

// Konwencja disabled całego zestawu (weto właściciela 2026-07-28, PR #135):
// wygaszenie kontrastu (opacity) + cursor not-allowed, NIGDY obrys kreskowany.
// FileField niesie stan na strefie (div, nie natywny disabled), więc mierzymy
// wariant aria-disabled tą samą prawdą, co states.test.tsx dla reszty kontrolek.
const DISABLED_CONVENTION = [
  "aria-disabled:opacity-50",
  "aria-disabled:cursor-not-allowed",
];
const DISABLED_FORBIDDEN = ["border-dashed", "border-current"];

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function pngFile(name = "photo.png"): File {
  // 1500 B, żeby rozmiar renderował się w kB (nie „0 kB").
  return new File([new Uint8Array(1500)], name, { type: "image/png" });
}
function tiny(name = "x.png"): File {
  return new File([PNG], name, { type: "image/png" });
}

function renderField(
  props: Partial<React.ComponentProps<typeof FileField>> = {},
) {
  return render(
    <form>
      <Label htmlFor="f">Plik zdjęcia</Label>
      <FileField
        id="f"
        name="file"
        accept="image/png"
        prompt="Przeciągnij plik albo kliknij…"
        hint="Formaty: PNG. Maksymalnie 5 MB."
        removeLabel="Usuń wybrany plik"
        {...props}
      />
    </form>,
  );
}

function zoneOf(container: HTMLElement): HTMLElement {
  const zone = container.querySelector<HTMLElement>('[data-slot="file-field"]');
  if (!zone) throw new Error("Brak strefy data-slot=\"file-field\"");
  return zone;
}

afterEach(cleanup);

describe("FileField — pole wgrywania plików Fazy 2", () => {
  it("stan pusty pokazuje zachętę i podpis, bez przycisku usuwania", () => {
    renderField();

    expect(screen.getByText("Przeciągnij plik albo kliknij…")).toBeInTheDocument();
    expect(screen.getByText("Formaty: PNG. Maksymalnie 5 MB.")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Usuń wybrany plik" }),
    ).not.toBeInTheDocument();

    const input = screen.getByLabelText("Plik zdjęcia") as HTMLInputElement;
    expect(input.type).toBe("file");
  });

  it("hint jest powiązany z inputem przez aria-describedby", () => {
    renderField();
    const input = screen.getByLabelText("Plik zdjęcia");
    const described = input.getAttribute("aria-describedby") ?? "";
    const hint = screen.getByText("Formaty: PNG. Maksymalnie 5 MB.");
    expect(described.split(/\s+/)).toContain(hint.id);
  });

  it("wybór pliku przez input USTAWIA plik w formularzu i woła onChange (regresja integracji)", () => {
    const onChange = vi.fn();
    const { container } = renderField({ onChange });
    const input = screen.getByLabelText("Plik zdjęcia") as HTMLInputElement;

    fireEvent.change(input, { target: { files: [pngFile()] } });

    expect(onChange).toHaveBeenCalledTimes(1);
    // Nazwa + rozmiar widoczne w stanie „wybrany".
    expect(screen.getByText(/photo\.png/)).toBeInTheDocument();
    expect(zoneOf(container).textContent).toMatch(/kB|MB/);
    // Plik siedzi w natywnym inpucie pod name="file" — to jest treść, którą
    // FormData wysyła w akcji serwerowej (wysyłka faktury).
    expect(input.name).toBe("file");
    expect(input.files?.[0]).toBeInstanceOf(File);
    expect(input.files?.[0]?.name).toBe("photo.png");
  });

  it("przeciągnięcie i upuszczenie pliku na strefę ustawia plik", () => {
    const onChange = vi.fn();
    const { container } = renderField({ onChange });
    const zone = zoneOf(container);

    fireEvent.dragOver(zone, { dataTransfer: { files: [pngFile("dropped.png")] } });
    expect(zone).toHaveAttribute("data-dragover", "true");

    fireEvent.drop(zone, { dataTransfer: { files: [pngFile("dropped.png")] } });

    expect(onChange).toHaveBeenCalled();
    expect(screen.getByText(/dropped\.png/)).toBeInTheDocument();
    expect(zone).toHaveAttribute("data-dragover", "false");
  });

  it("komunikat błędu walidacji renderuje się w role=\"alert\" i ustawia aria-invalid", () => {
    renderField({ error: "Dozwolone formaty zdjęć: JPEG, PNG, WebP, AVIF." });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Dozwolone formaty zdjęć: JPEG, PNG, WebP, AVIF.");
    const input = screen.getByLabelText("Plik zdjęcia");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby") ?? "").toContain(alert.id);
  });

  it("stan disabled: klik strefy NIE otwiera wyboru, input jest wyłączony", () => {
    const { container } = renderField({ disabled: true });
    const input = screen.getByLabelText("Plik zdjęcia") as HTMLInputElement;
    const clickSpy = vi.spyOn(input, "click");
    const zone = zoneOf(container);

    fireEvent.click(zone);

    expect(clickSpy).not.toHaveBeenCalled();
    expect(input).toBeDisabled();
    expect(zone).toHaveAttribute("aria-disabled", "true");
  });

  it("klik włączonej strefy otwiera natywny wybór pliku", () => {
    const { container } = renderField();
    const input = screen.getByLabelText("Plik zdjęcia") as HTMLInputElement;
    const clickSpy = vi.spyOn(input, "click");

    fireEvent.click(zoneOf(container));

    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("usunięcie wyboru czyści plik i wraca do stanu pustego", () => {
    const onChange = vi.fn();
    renderField({ onChange });
    const input = screen.getByLabelText("Plik zdjęcia") as HTMLInputElement;

    fireEvent.change(input, { target: { files: [pngFile()] } });
    expect(screen.getByText(/photo\.png/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Usuń wybrany plik" }));

    expect(screen.queryByText(/photo\.png/)).not.toBeInTheDocument();
    expect(screen.getByText("Przeciągnij plik albo kliknij…")).toBeInTheDocument();
    expect(input.files ?? []).toHaveLength(0);
    // onChange: raz przy wyborze, raz przy wyczyszczeniu.
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("input jest osiągalny klawiaturą (w kolejności tab, nie aria-hidden)", () => {
    renderField();
    const input = screen.getByLabelText("Plik zdjęcia");
    expect(input).not.toHaveAttribute("aria-hidden");
    expect(input).not.toHaveAttribute("tabindex", "-1");
  });

  it("strefa niesie wspólną konwencję disabled (wygaszenie + not-allowed), bez obrysu kreskowanego", () => {
    const { container } = renderField({ disabled: true });
    const zone = zoneOf(container);
    expect(zone).toHaveClass(...DISABLED_CONVENTION);
    for (const forbidden of DISABLED_FORBIDDEN) {
      expect(zone.className).not.toContain(forbidden);
    }
  });

  it("miniatura obrazu dostaje tekst alternatywny wskazujący plik", () => {
    renderField();
    const input = screen.getByLabelText("Plik zdjęcia") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [tiny("miniatura.png")] } });
    const preview = screen.queryByRole("img");
    if (preview) {
      expect(preview).toHaveAttribute("alt", expect.stringContaining("miniatura.png"));
    }
  });
});
