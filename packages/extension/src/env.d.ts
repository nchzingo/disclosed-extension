/**
 * Ambient declarations for this package.
 *
 * `*.json` IS DECLARED AS `unknown` ON PURPOSE. The rules bundle is embedded
 * at build time as DATA (see lib/bundle.ts) and every field it carries is
 * validated before use — `parseRuleset` for the signatures, this package's own
 * parser for the cards. Typing the import from the file's own contents would
 * let today's bundle shape silently become the code's assumption about every
 * future bundle, and a bundle is exactly the kind of thing that must fail
 * loudly rather than misclassify quietly (packages/core/src/ruleset.ts).
 */
declare module '*.json' {
  const value: unknown;
  export default value;
}

interface ImportMetaEnv {
  /**
   * Base URL of the k-anonymity resolution API, injected at BUILD time.
   * Unset in every build this repo produces, which leaves the extension with
   * no host permission and no way to make a network request at all.
   */
  readonly WXT_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
