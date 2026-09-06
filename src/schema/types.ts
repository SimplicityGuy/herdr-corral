/**
 * Shapes of the generated schema data.
 *
 * Owned by the schema layer and shared with `scripts/gen-reference.ts`, so the
 * generator and the accessors cannot drift apart.
 */

export type ReferenceDefault =
  | string
  | number
  | boolean
  | null
  | ReferenceDefault[]
  | { [key: string]: ReferenceDefault }

export type ReferenceSection = {
  /** The reference page's `<h2>` anchor, e.g. `ref-ui`. */
  id: string
  title: string
}

export type ReferenceEntry = {
  /** Dotted TOML path, e.g. `ui.tab_bar_position`. */
  key: string
  /** Id of the section this setting belongs to. */
  section: string
  /** herdr's own type word: `boolean`, `enum`, `list of token rows`, … */
  type: string
  /** The default as a JSON value; `null` when herdr documents it as `unset`. */
  default: ReferenceDefault
  /** The default exactly as the reference prints it; `null` when unset. */
  defaultLiteral: string | null
  /** Prose the reference appends after the default literal, when there is any. */
  defaultNote?: string
  description: string
  /** Accepted values, for enums and for the entry types of `ui.tab_bar_right`. */
  options: string[]
}

export type ReferenceDocument = {
  source: string
  /** herdr release the reference documents. */
  herdrVersion: string | null
  sections: ReferenceSection[]
  entries: ReferenceEntry[]
}

/** One built-in theme: the 19 tokens `[theme.custom]` can override. */
export type ThemePalette = Record<string, string>

export type ThemeDefinition = {
  /** herdr's own doc comment for the palette. */
  description: string
  colors: ThemePalette
  /**
   * Set when a palette could not be read from herdr's source and was
   * reconstructed. Absent means every token is verbatim from the tagged source.
   */
  approximate?: boolean
}

export type ThemesDocument = {
  herdrVersion: string
  source: {
    repository: string
    tag: string
    commit: string
    palettes: string
    names: string
    tokens: string
  }
  /** Token names in herdr's declaration order. */
  tokens: string[]
  themes: Record<string, ThemeDefinition>
}
