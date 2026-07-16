import { createNavigation } from "next-intl/navigation";

import { routing } from "./routing";

/**
 * Nawigacja świadoma locale. Komponenty MUSZĄ importować `Link`/`redirect`
 * stąd, a nie z `next/link` — inaczej link gubi prefiks locale i wyrzuca
 * użytkownika na domyślny język.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
