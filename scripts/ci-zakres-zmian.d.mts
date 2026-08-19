/**
 * Typy klasyfikatora zakresu zmian CI (dla bramki w apps/panel/test).
 * Implementacja: ci-zakres-zmian.mjs (Node bez transpilacji — stąd .mjs).
 */
export declare const DOCS_DIRECTORY: string;
export declare const ROOT_MARKDOWN: RegExp;
export declare const CODE_READ_DIRECTORIES: readonly string[];
export declare const CODE_READ_FILES: readonly string[];
export declare const PER_JOB_SKIPPABLE: readonly ["wp-plugin", "rls", "e2e"];
export declare const WP_PLUGIN_DIRECTORY: string;
export declare const DB_PACKAGE_DIRECTORY: string;
export declare function isWellFormedPath(path: unknown): boolean;
export declare function isDocumentationOnlyPath(path: unknown): boolean;
export declare function isWpAdjacentPanelPath(path: string): boolean;
export declare function jobsAffectedByPath(path: string): ("wp-plugin" | "rls" | "e2e")[];
export type PerJobVerdict = Record<"wp-plugin" | "rls" | "e2e", boolean>;
export declare function classifyChangedPaths(paths: unknown): {
  skipHeavyJobs: boolean;
  reason: string;
  blockingPaths: string[];
  skipJobs: PerJobVerdict;
};
export declare function verdictOutputLines(verdict: {
  skipHeavyJobs: boolean;
  skipJobs: PerJobVerdict;
}): string[];
export declare function parsePathList(
  input: unknown,
  options?: { zeroSeparated?: boolean },
): string[];
