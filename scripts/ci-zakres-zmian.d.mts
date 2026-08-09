/**
 * Typy klasyfikatora zakresu zmian CI (dla bramki w apps/panel/test).
 * Implementacja: ci-zakres-zmian.mjs (Node bez transpilacji — stąd .mjs).
 */
export declare const DOCS_DIRECTORY: string;
export declare const ROOT_MARKDOWN: RegExp;
export declare const CODE_READ_DIRECTORIES: readonly string[];
export declare const CODE_READ_FILES: readonly string[];
export declare function isWellFormedPath(path: unknown): boolean;
export declare function isDocumentationOnlyPath(path: unknown): boolean;
export declare function classifyChangedPaths(paths: unknown): {
  skipHeavyJobs: boolean;
  reason: string;
  blockingPaths: string[];
};
export declare function parsePathList(
  input: unknown,
  options?: { zeroSeparated?: boolean },
): string[];
