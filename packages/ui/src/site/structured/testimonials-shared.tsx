import type { TestimonialsStructuredItem } from "@avably/core/site";

import { cn } from "../../lib/cn";

/**
 * WSPÓLNY KAFEL OPINII (E6, aneks ADR-094).
 *
 * Siatka i karuzela różnią się KONTENEREM i niczym więcej: sama opinia to
 * w obu ta sama trójka (cytat, podpis, rola) i to samo drzewo dokumentu.
 * Wspólny kafel jest tu z tego samego powodu, co wspólny kafel galerii —
 * dwie kopie rozjechałyby się prędzej czy później, a rozjazd dotyczyłby
 * SEMANTYKI cytatu, nie odstępu.
 *
 * ==================== DLACZEGO `<figure>` I `<figcaption>` ====================
 *
 * `<blockquote>` niesie sam cytat; podpis pod nim NIE JEST jego częścią (autor
 * nie powiedział własnego nazwiska). Wsadzenie podpisu do środka cytatu jest
 * najczęstszym błędem w tym wzorcu i ma realny skutek: czytnik ekranu odczytuje
 * wtedy nazwisko jako część wypowiedzi. `<figure>` obejmuje oba, a
 * `<figcaption>` mówi, czyja to wypowiedź — i to jest zalecana postać tej pary.
 */
export function TestimonialCard({
  item,
  className,
  ...rest
}: {
  item: TestimonialsStructuredItem;
  className?: string;
} & Record<`data-${string}`, string | number | undefined>) {
  return (
    <figure {...rest} className={cn("site-card m-0 flex flex-col gap-4 p-5", className)}>
      <blockquote data-testimonial-quote className="site-title text-base font-normal break-words">
        {item.quote}
      </blockquote>
      {/*
        Podpis dosuwamy do DOŁU kafla (`mt-auto`): w rzędzie kafli o różnej
        długości cytatu podpisy stoją wtedy w jednej linii i rząd czyta się
        jak rząd, a nie jak trzy osobne bloki o przypadkowej wysokości.
      */}
      <figcaption className="mt-auto flex flex-col gap-0.5 text-sm">
        <span data-testimonial-author className="site-title font-medium">
          {item.author}
        </span>
        {item.role ? (
          <span data-testimonial-role className="site-text-muted">
            {item.role}
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}
