/**
 * corral is a static page that never talks to anything (ADR-0001).
 *
 * That claim is on the landing screen, in the README and in the reason people
 * are willing to drop a config full of machine names into it, so it is checked
 * rather than asserted: no source file under `src/` may reach the network. The
 * grep is deliberately blunt — a name is enough to fail — because the point is to
 * make a network call impossible to add absent-mindedly, and anything that really
 * needs one can argue for an exception here in the open.
 *
 * `scripts/` is excluded on purpose: `gen-reference.ts` fetches herdr.dev at build
 * time, which is a generator run by a developer, not something the shipped bundle
 * does. The test lives here rather than under `src/` for the same reason it is
 * excluded — it reads the repository off disk, which is Node's job, and `src/`
 * compiles for the browser.
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Ways a browser starts a request, by name.
 *
 * A dynamic `import()` is deliberately not on the list. Vite resolves one into a
 * chunk of the app served from its own origin — the same category as the font
 * subset, not a call home — and the string also appears in type positions like
 * `typeof import('@/lib/diff')`, where a blunt grep cannot tell the two apart. The
 * runtime half of the claim is covered where it can be seen: the e2e spec watches
 * the wire while a file goes in and comes out, and fails on any off-origin request
 * or any fetch at all.
 */
const NETWORK_CALLS = ['fetch(', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'navigator.sendBeacon']

const SOURCE_ROOT = path.resolve(import.meta.dirname, '../src')

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : []
  })
}

describe('nothing in src/ reaches the network', () => {
  const files = sourceFiles(SOURCE_ROOT)

  it('finds the sources to check, so an empty sweep cannot pass', () => {
    expect(files.length).toBeGreaterThan(30)
  })

  it.each(NETWORK_CALLS)('never calls %s', (call) => {
    const offenders = files.filter((file) => readFileSync(file, 'utf8').includes(call))

    expect(offenders.map((file) => path.relative(SOURCE_ROOT, file))).toEqual([])
  })
})
