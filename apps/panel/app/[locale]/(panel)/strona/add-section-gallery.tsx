"use client";

/**
 * Galeria „Dodaj sekcję" (kreator A2, ADR-082) — modal z kafelkiem KAŻDEGO typu
 * (nazwa, jednozdaniowy opis, ikona). Zamknięta lista (11+ typów), bez
 * wyszukiwarki. Kliknięcie kafla woła `onAdd(type)` i zamyka modal; wstawienie
 * na pozycji (koniec albo „poniżej") ogarnia wołający. Ten sam komponent służy
 * przyciskowi na górze i akcji „dodaj poniżej" w wierszu sekcji (trigger jako prop).
 */
import { SECTION_TYPES, type SectionType } from "@avably/core/site";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@avably/ui";
import {
  AlignLeft,
  HelpCircle,
  Images,
  LayoutGrid,
  type LucideIcon,
  Mail,
  MapPin,
  Megaphone,
  MousePointerClick,
  Quote,
  Sparkles,
  Tag,
  Truck,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";

/** Ikona kafla per typ sekcji (miniatura galerii „Dodaj sekcję"). */
const SECTION_TYPE_ICONS: Record<SectionType, LucideIcon> = {
  hero: Megaphone,
  products: LayoutGrid,
  pricing: Tag,
  faq: HelpCircle,
  contact: Mail,
  freeform: AlignLeft,
  testimonials: Quote,
  gallery: Images,
  usp: Sparkles,
  cta: MousePointerClick,
  directions: MapPin,
  delivery: Truck,
};

export function AddSectionDialog({
  trigger,
  onAdd,
  disabled,
}: {
  trigger: ReactNode;
  onAdd: (type: SectionType) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("site");
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("sections.add")}</DialogTitle>
          <DialogDescription>{t("sections.addModalDescription")}</DialogDescription>
        </DialogHeader>
        <ul data-add-section-gallery className="grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2">
          {SECTION_TYPES.map((type) => {
            const Icon = SECTION_TYPE_ICONS[type];
            return (
              <li key={type}>
                <button
                  type="button"
                  data-add-section-tile={type}
                  disabled={disabled}
                  className="border-border hover:border-foreground focus-visible:border-foreground focus-visible:outline-accent dark:focus-visible:outline-ring flex w-full cursor-pointer items-start gap-3 rounded-lg border p-3 text-left outline-none transition-colors focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => {
                    onAdd(type);
                    setOpen(false);
                  }}
                >
                  <span className="text-muted-foreground mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border">
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{t(`sectionTypes.${type}`)}</span>
                    <span className="text-muted-foreground block text-[13px] leading-[18px]">
                      {t(`sectionTypeDescriptions.${type}`)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
