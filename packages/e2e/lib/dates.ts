/** Data ISO (YYYY-MM-DD) przesunięta o `days` dni od dziś, w strefie lokalnej
 * procesu testów. Terminy zawsze w przyszłości — pole daty na stronie
 * produktu ma `min` = dziś. */
export function dateISO(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
