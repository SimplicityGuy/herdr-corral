/**
 * Regenerates `src/schema/reference.json` from herdr's published config reference.
 *
 *   pnpm gen:reference                    # fetch the live page (the default)
 *   pnpm gen:reference --offline          # parse the committed fixture instead
 *   pnpm gen:reference --update-fixture   # fetch, and refresh the fixture too
 *
 * The schema is generated, never hand-edited: a herdr upgrade is a re-run and a
 * diff. Output is deterministic, so a run against an unchanged page leaves the
 * working tree clean.
 *
 * The fixture is only rewritten on demand, because the page carries build-hash
 * noise that would otherwise dirty the tree on every run.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseConfigReference } from './parse-reference.ts'

const SOURCE_URL = 'https://herdr.dev/docs/config-reference/'
const ROOT = path.resolve(import.meta.dirname, '..')
const FIXTURE = path.join(ROOT, 'scripts', 'fixtures', 'config-reference.html')
const OUTPUT = path.join(ROOT, 'src', 'schema', 'reference.json')

async function fetchReference(): Promise<string> {
  const response = await fetch(SOURCE_URL, { headers: { accept: 'text/html' } })
  if (!response.ok) {
    throw new Error(`GET ${SOURCE_URL} failed: ${response.status} ${response.statusText}`)
  }
  return response.text()
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2))
  const offline = args.has('--offline')
  const updateFixture = args.has('--update-fixture')

  const unknown = [...args].filter((a) => a !== '--offline' && a !== '--update-fixture')
  if (unknown.length > 0) throw new Error(`unknown argument(s): ${unknown.join(', ')}`)
  if (offline && updateFixture) throw new Error('--offline cannot be combined with --update-fixture')

  const html = offline ? await readFile(FIXTURE, 'utf8') : await fetchReference()
  console.log(`read ${html.length} bytes from ${offline ? FIXTURE : SOURCE_URL}`)

  const document = parseConfigReference(html, SOURCE_URL)

  if (updateFixture) {
    await mkdir(path.dirname(FIXTURE), { recursive: true })
    await writeFile(FIXTURE, html)
    console.log(`wrote ${path.relative(ROOT, FIXTURE)}`)
  }

  await mkdir(path.dirname(OUTPUT), { recursive: true })
  await writeFile(OUTPUT, `${JSON.stringify(document, null, 2)}\n`)

  const enums = document.entries.filter((e) => e.type === 'enum').length
  console.log(
    `wrote ${path.relative(ROOT, OUTPUT)}: ${document.entries.length} entries ` +
      `across ${document.sections.length} sections (${enums} enums), herdr ${document.herdrVersion}`,
  )
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
