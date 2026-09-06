/**
 * Parser for herdr's published config reference.
 *
 * Pure string in, structured data out — no network, no filesystem — so the same
 * function backs `pnpm gen:reference` and its unit test against the committed
 * fixture. `gen-reference.ts` owns fetching and writing.
 *
 * The page is Astro-rendered and machine-generated: every setting is one
 * `<li class="config-reference-row">` inside a `<section>` headed by an
 * `<h2 class="config-reference-title" id="ref-*">`. The parser matches those
 * shapes and throws with a specific message the moment one stops holding, so a
 * site redesign fails the regeneration rather than silently emptying the schema.
 */
import { parse as parseToml } from 'smol-toml'

import type {
  ReferenceDefault,
  ReferenceDocument,
  ReferenceEntry,
  ReferenceSection,
} from '../src/schema/types.ts'

/** Below this the page is assumed broken rather than merely changed. */
export const MIN_ENTRIES = 150

const SECTION_TITLE_RE =
  /<h2\b[^>]*class="[^"]*\bconfig-reference-title\b[^"]*"[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/h2>/g
const ROW_RE = /<li\b[^>]*class="[^"]*\bconfig-reference-row\b[^"]*"[^>]*>([\s\S]*?)<\/li>/g
const KEY_RE = /<code\b[^>]*class="[^"]*\bconfig-reference-key\b[^"]*"[^>]*>([\s\S]*?)<\/code>/
const TYPE_RE = /<span\b[^>]*class="[^"]*\bconfig-reference-type\b[^"]*"[^>]*>([\s\S]*?)<\/span>/
const DEFAULT_RE =
  /<span\b[^>]*class="[^"]*\bconfig-reference-default\b[^"]*"[^>]*>([\s\S]*?)<\/span>/
const DESC_RE = /<p\b[^>]*class="[^"]*\bconfig-reference-desc\b[^"]*"[^>]*>([\s\S]*?)<\/p>/
const VALUES_RE =
  /<span\b[^>]*class="[^"]*\bconfig-reference-values\b[^"]*"[^>]*>([\s\S]*?)<\/span>/
const CODE_RE = /<code\b[^>]*>([\s\S]*?)<\/code>/g
const VERSION_RE = /<option\b[^>]*selected[^>]*>\s*Latest\s+([0-9][^<\s]*)\s*<\/option>/

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

/** Decode the entity set an HTML escaper emits; leave anything else alone. */
export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1] === 'x' || body[1] === 'X'
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[body.toLowerCase()] ?? whole
  })
}

function text(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
}

function codes(html: string): string[] {
  return [...html.matchAll(CODE_RE)].map((m) => text(m[1]))
}

/**
 * Turn the printed default into a JSON value.
 *
 * The page mostly prints a TOML literal, but three shapes need tolerance, and
 * each is handled explicitly rather than guessed at:
 *   - `unset` — the setting has no default at all.
 *   - `"stable" ("preview" for Windows preview builds)` — a literal plus prose.
 *   - `compact`, `auto` — an enum default the page forgot to quote.
 * Anything else that will not parse throws, so a new shape is noticed.
 */
export function parseDefault(
  literal: string,
  options: string[],
  key: string,
): { value: ReferenceDefault; note?: string } {
  if (literal === 'unset') return { value: null }

  const tryToml = (source: string): ReferenceDefault | undefined => {
    try {
      return parseToml(`value = ${source}`).value as ReferenceDefault
    } catch {
      return undefined
    }
  }

  const whole = tryToml(literal)
  if (whole !== undefined) return { value: whole }

  const withNote = /^(.+?)\s*(\(.*\))$/.exec(literal)
  if (withNote) {
    const head = tryToml(withNote[1])
    if (head !== undefined) return { value: head, note: withNote[2] }
  }

  if (options.includes(literal)) return { value: literal }

  throw new Error(`${key}: cannot parse default ${JSON.stringify(literal)}`)
}

function parseRow(row: string, section: string): ReferenceEntry {
  const keyMatch = KEY_RE.exec(row)
  if (!keyMatch) throw new Error(`row without a config-reference-key: ${row.slice(0, 120)}`)
  const key = text(keyMatch[1])

  const typeMatch = TYPE_RE.exec(row)
  if (!typeMatch) throw new Error(`${key}: no config-reference-type`)
  const type = text(typeMatch[1])

  const defaultMatch = DEFAULT_RE.exec(row)
  if (!defaultMatch) throw new Error(`${key}: no config-reference-default`)
  const defaultCodes = codes(defaultMatch[1])
  if (defaultCodes.length !== 1) {
    throw new Error(`${key}: expected one default literal, got ${defaultCodes.length}`)
  }
  const literal = defaultCodes[0]

  const descMatch = DESC_RE.exec(row)
  if (!descMatch) throw new Error(`${key}: no config-reference-desc`)
  const valuesMatch = VALUES_RE.exec(descMatch[1])
  const options = valuesMatch ? codes(valuesMatch[1]) : []
  const description = text(descMatch[1].replace(VALUES_RE, ''))

  if (!key) throw new Error('empty key')
  if (!type) throw new Error(`${key}: empty type`)
  if (!description) throw new Error(`${key}: empty description`)

  const parsed = parseDefault(literal, options, key)
  const entry: ReferenceEntry = {
    key,
    section,
    type,
    default: parsed.value,
    defaultLiteral: literal === 'unset' ? null : literal,
    description,
    options,
  }
  if (parsed.note !== undefined) entry.defaultNote = parsed.note
  return entry
}

/**
 * Parse the config-reference page.
 *
 * Entries keep the page's own order — sections in the order the page lists
 * them, keys in the order within a section — which is both deterministic for a
 * given input and the grouping the editor wants to show. Re-running the
 * generator against an unchanged page therefore reproduces the file byte for
 * byte.
 */
export function parseConfigReference(html: string, source: string): ReferenceDocument {
  const titles = [...html.matchAll(SECTION_TITLE_RE)].map((m) => ({
    index: m.index,
    id: m[1],
    title: text(m[2]),
  }))
  if (titles.length === 0) {
    throw new Error('no h2.config-reference-title found — the reference page layout changed')
  }

  const sections: ReferenceSection[] = titles.map(({ id, title }) => ({ id, title }))
  const entries: ReferenceEntry[] = []

  for (const match of html.matchAll(ROW_RE)) {
    let section: string | undefined
    for (const title of titles) {
      if (title.index < match.index) section = title.id
      else break
    }
    if (!section) {
      throw new Error(`config-reference-row at ${match.index} precedes every section heading`)
    }
    entries.push(parseRow(match[1], section))
  }

  const seen = new Set<string>()
  for (const entry of entries) {
    if (seen.has(entry.key)) throw new Error(`duplicate key ${entry.key}`)
    seen.add(entry.key)
  }

  if (entries.length < MIN_ENTRIES) {
    throw new Error(
      `only ${entries.length} config-reference-row entries (expected at least ${MIN_ENTRIES}) — ` +
        'the reference page layout probably changed',
    )
  }

  const version = VERSION_RE.exec(html)
  return {
    source,
    herdrVersion: version ? version[1] : null,
    sections,
    entries,
  }
}
