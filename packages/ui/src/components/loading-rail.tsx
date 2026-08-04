import * as React from "react";

import { cn } from "../lib/cn";

/**
 * Szyna ładowania — nośnik ruchu we wzorcu loading (delta do sekcji 07,
 * decyzja właściciela 2026-08-04).
 *
 * CO ZASTĄPIŁA: pasek zastępczy `Skeleton` malowany powierzchnią `secondary`.
 * Ekran ładowania przestał udawać treść (ściana szarych plam czytała się jak
 * usterka), więc geometria jest dziś PUSTA, a stan niesie para: ta szyna plus
 * widoczny komunikat `role="status"` obok niej.
 *
 * DLACZEGO JEDEN PRZEBIEG DO KOŃCA, A NIE PASEK POSTĘPU. Szyny typu NProgress
 * pełzną asymptotycznie i nigdy nie dobijają do końca — to jest udawany
 * postęp: nic nie mierzą, a przy zaciętym żądaniu kłamią, że „prawie gotowe".
 * Ta szyna jest POCIĄGNIĘCIEM PIÓRA, nie miernikiem: rysuje się raz w 900 ms i
 * zostaje kreską. Ile jeszcze potrwa, mówi tekst obok, a nie procent.
 *
 * Ruch jest SKOŃCZONY (jedna iteracja, `both`), więc twardy zakaz `extra-loops`
 * obowiązuje bez wyjątku. Limonka jedzie z nośnikiem: na jasnym tle
 * `signal-strong`, na ciemnym akcent — kontrakt `lime-without-carrier`.
 * Cała szyna jest dekoracją, więc siedzi poza drzewem dostępności.
 */
function LoadingRail({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="loading-rail"
      aria-hidden="true"
      className={cn("bg-secondary h-0.5 overflow-hidden rounded-full", className)}
      {...props}
    >
      <span className="animate-loading-rail bg-signal-strong dark:bg-accent-foreground block h-full origin-left" />
    </div>
  );
}

export { LoadingRail };
