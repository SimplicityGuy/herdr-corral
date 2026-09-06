/**
 * Typed accessors over the generated schema.
 *
 * Everything the editor knows about herdr's settings comes from three generated
 * artifacts in this directory, and nothing here hand-codes a setting:
 *
 *   - `reference.json`      — `pnpm gen:reference` (from herdr.dev)
 *   - `default-config.toml` — `herdr --default-config > src/schema/default-config.toml`
 *   - `themes.json`         — palettes lifted from herdr's tagged source
 *
 * A herdr upgrade is a regenerate-and-diff, never an edit.
 */
import defaultConfigTomlRaw from './default-config.toml?raw'
import referenceJson from './reference.json'
import themesJson from './themes.json'
import type {
  ReferenceDefault,
  ReferenceDocument,
  ReferenceEntry,
  ReferenceSection,
  ThemeDefinition,
  ThemePalette,
  ThemesDocument,
} from './types.ts'

export type {
  ReferenceDefault,
  ReferenceDocument,
  ReferenceEntry,
  ReferenceSection,
  ThemeDefinition,
  ThemePalette,
  ThemesDocument,
}

export const reference = referenceJson as unknown as ReferenceDocument
export const themes = themesJson as unknown as ThemesDocument

/** The annotated config herdr itself prints, verbatim. */
export const defaultConfigToml: string = defaultConfigTomlRaw

/** herdr release these artifacts describe. */
export const herdrVersion: string | null = reference.herdrVersion

const entriesByKey = new Map<string, ReferenceEntry>(
  reference.entries.map((entry) => [entry.key, entry]),
)

const entriesBySection = new Map<string, ReferenceEntry[]>()
for (const entry of reference.entries) {
  const bucket = entriesBySection.get(entry.section)
  if (bucket) bucket.push(entry)
  else entriesBySection.set(entry.section, [entry])
}

/** Every setting key, in the reference page's own order. */
export function allKeys(): readonly string[] {
  return reference.entries.map((entry) => entry.key)
}

export function allEntries(): readonly ReferenceEntry[] {
  return reference.entries
}

export function byKey(key: string): ReferenceEntry | undefined {
  return entriesByKey.get(key)
}

/** The sections the reference groups settings into, in page order. */
export function sections(): readonly ReferenceSection[] {
  return reference.sections
}

/** Settings in one section, in page order. Unknown ids give an empty list. */
export function bySection(sectionId: string): readonly ReferenceEntry[] {
  return entriesBySection.get(sectionId) ?? []
}

/** The documented default, or `undefined` for a key herdr does not document. */
export function defaultOf(key: string): ReferenceDefault | undefined {
  return entriesByKey.get(key)?.default
}

export function typeOf(key: string): string | undefined {
  return entriesByKey.get(key)?.type
}

/** Accepted values for an enum (and for `ui.tab_bar_right`'s entry types). */
export function enumOptions(key: string): readonly string[] {
  return entriesByKey.get(key)?.options ?? []
}

export function isKeybinding(key: string): boolean {
  return entriesByKey.get(key)?.type === 'keybinding'
}

/** The entry types `ui.tab_bar_right` accepts. */
export function tabBarEntryTypes(): readonly string[] {
  return enumOptions('ui.tab_bar_right')
}

/**
 * Comment prose that immediately precedes each table header in the annotated
 * default config, keyed by table. herdr documents a few lists only there.
 */
function prosePerTable(toml: string): Map<string, string> {
  const prose = new Map<string, string>()
  let buffer: string[] = []
  for (const line of toml.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') {
      buffer = []
      continue
    }
    const uncommented = trimmed.startsWith('#') ? trimmed.replace(/^#\s?/, '') : trimmed
    const header = /^\[\[?([A-Za-z0-9_.-]+)\]\]?$/.exec(uncommented)
    if (header) {
      prose.set(header[1], buffer.join(' '))
      buffer = []
      continue
    }
    if (trimmed.startsWith('#')) buffer.push(uncommented)
    else buffer = []
  }
  return prose
}

const TABLE_PROSE = prosePerTable(defaultConfigToml)

/**
 * The built-in row tokens for the agents or spaces sidebar.
 *
 * The reference page does not list these; herdr documents them in the prose
 * above `[ui.sidebar.agents]` / `[ui.sidebar.spaces]` in its default config
 * ("Built-ins are a, b, and c."), so they are read from there rather than
 * transcribed. `schema.test.ts` pins the result, so a herdr release that
 * changes the wording or the list fails loudly.
 */
export function sidebarTokenBuiltins(kind: 'agents' | 'spaces'): readonly string[] {
  const found = /Built-ins are ([^.]+)\./.exec(TABLE_PROSE.get(`ui.sidebar.${kind}`) ?? '')
  if (!found) return []
  return found[1]
    .split(/,\s*|\s+and\s+/)
    .map((token) => token.trim().replace(/^and\s+/, ''))
    .filter((token) => /^[a-z0-9_]+$/.test(token))
}

/** Built-in theme names, in herdr's own declaration order. */
export function themeNames(): readonly string[] {
  return Object.keys(themes.themes)
}

/** The 19 color tokens `[theme.custom]` can override, in declaration order. */
export function themeTokens(): readonly string[] {
  return themes.tokens
}

/** A built-in theme's palette, or `undefined` for an unknown name. */
export function paletteOf(name: string): ThemePalette | undefined {
  return themes.themes[name]?.colors
}
