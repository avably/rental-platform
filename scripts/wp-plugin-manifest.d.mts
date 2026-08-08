/**
 * Typy manifestu doboru plików paczki wtyczki (dla bramki w apps/panel/test).
 * Implementacja: wp-plugin-manifest.mjs (Node bez transpilacji — stąd .mjs).
 */
export declare const RUNTIME_ALLOWLIST: readonly string[];
export declare const DEV_EXCLUSIONS: readonly string[];
export declare function patternToRegExp(pattern: string): RegExp;
export declare function matchesAny(path: string, patterns: readonly string[]): boolean;
