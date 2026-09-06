/**
 * A unified diff of two texts — what the export dialog's "changed hunks" tab shows.
 *
 * The dialog has the original file and the file corral would write, and the honest
 * answer to "what am I about to change?" is the hunks between them, not a list of
 * key paths. The diagnostics line's key count answers "how much", this answers
 * "what", and both are read from the same two strings the download would use.
 *
 * The script is a longest-common-subsequence walk, which is the diff a person
 * expects: an untouched line is context wherever it moved to, and a changed line
 * reads as one removal followed by one addition. Two things keep it cheap enough
 * to run on every render of the tab. The common prefix and suffix are trimmed
 * first, so a one-line edit in a 500-line file compares a handful of lines; and
 * the table is bounded, so a pathological pair — a loaded file against a config
 * generated from the defaults, which share almost nothing — falls back to "all of
 * it went, all of this arrived" rather than allocating a matrix nobody wants.
 *
 * A trailing newline is kept as a final empty line rather than dropped, so a file
 * that gained or lost one shows it instead of silently matching.
 */

/** What a line is doing in the diff. */
export type DiffKind = 'context' | 'add' | 'remove'

/** One line of the diff, numbered in whichever sides contain it. */
export interface DiffLine {
  readonly kind: DiffKind
  /** One-based line number in the original, or `null` for an added line. */
  readonly before: number | null
  /** One-based line number in the export, or `null` for a removed line. */
  readonly after: number | null
  readonly text: string
}

/** A run of changes with its surrounding context, as `@@ -a,b +c,d @@` frames it. */
export interface DiffHunk {
  readonly beforeStart: number
  readonly beforeCount: number
  readonly afterStart: number
  readonly afterCount: number
  readonly lines: readonly DiffLine[]
}

/** Lines of context shown either side of a change, as `diff -u` uses. */
export const DEFAULT_CONTEXT = 3

/**
 * The largest comparison table the line diff will build.
 *
 * A million cells is a 1000×1000 block of genuinely unrelated lines, which is far
 * past anything an edited config produces once the shared prefix and suffix are
 * gone. Past it the pair is reported as one wholesale replacement — still true,
 * just less specific — because the alternative is a matrix that grows with the
 * square of a file the user is allowed to make a megabyte of.
 */
export const MAX_CELLS = 1_000_000

/** Split text into lines, keeping a trailing newline as a final empty line. */
export function splitLines(text: string): string[] {
  return text === '' ? [] : text.split('\n')
}

/** How many lines at the front of both arrays are identical. */
function commonPrefix(a: readonly string[], b: readonly string[]): number {
  const limit = Math.min(a.length, b.length)
  let count = 0
  while (count < limit && a[count] === b[count]) count += 1
  return count
}

/** How many lines at the back of both arrays are identical, past `prefix`. */
function commonSuffix(a: readonly string[], b: readonly string[], prefix: number): number {
  const limit = Math.min(a.length, b.length) - prefix
  let count = 0
  while (count < limit && a[a.length - 1 - count] === b[b.length - 1 - count]) count += 1
  return count
}

/** The edit script for two blocks that share no prefix or suffix. */
function middleScript(a: readonly string[], b: readonly string[]): DiffKind[] {
  const n = a.length
  const m = b.length
  if (n === 0 || m === 0 || n * m > MAX_CELLS) {
    return [...Array.from<DiffKind>({ length: n }).fill('remove'), ...Array.from<DiffKind>({ length: m }).fill('add')]
  }
  // `table[i][j]` is the length of the longest common subsequence of `a[i:]` and
  // `b[j:]`, so the walk below can read forward and never has to reverse a path.
  const width = m + 1
  const table = new Uint32Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
    }
  }
  const script: DiffKind[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      script.push('context')
      i += 1
      j += 1
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      script.push('remove')
      i += 1
    } else {
      script.push('add')
      j += 1
    }
  }
  while (i < n) {
    script.push('remove')
    i += 1
  }
  while (j < m) {
    script.push('add')
    j += 1
  }
  return script
}

/**
 * Every line of both texts, in order, each marked with what it is doing.
 *
 * Exported because the diff is easier to test as a flat script than as hunks, and
 * because a caller that wants the whole file annotated rather than the changed
 * parts wants exactly this.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = splitLines(before)
  const b = splitLines(after)
  const prefix = commonPrefix(a, b)
  const suffix = commonSuffix(a, b, prefix)
  const script: DiffKind[] = [
    ...Array.from<DiffKind>({ length: prefix }).fill('context'),
    ...middleScript(a.slice(prefix, a.length - suffix), b.slice(prefix, b.length - suffix)),
    ...Array.from<DiffKind>({ length: suffix }).fill('context'),
  ]
  const lines: DiffLine[] = []
  let beforeAt = 0
  let afterAt = 0
  for (const kind of script) {
    if (kind === 'add') {
      afterAt += 1
      lines.push({ kind, before: null, after: afterAt, text: b[afterAt - 1] })
      continue
    }
    if (kind === 'remove') {
      beforeAt += 1
      lines.push({ kind, before: beforeAt, after: null, text: a[beforeAt - 1] })
      continue
    }
    beforeAt += 1
    afterAt += 1
    lines.push({ kind, before: beforeAt, after: afterAt, text: a[beforeAt - 1] })
  }
  return lines
}

/** Group the change indices into ranges that carry `context` lines either side. */
function hunkRanges(
  lines: readonly DiffLine[],
  context: number,
): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = []
  for (const [index, line] of lines.entries()) {
    if (line.kind === 'context') continue
    const start = Math.max(0, index - context)
    const end = Math.min(lines.length - 1, index + context)
    const last = ranges.at(-1)
    // Two changes whose context touches or overlaps belong in one hunk, which is
    // what keeps a pair of edits three lines apart from printing the same context
    // twice under two headers.
    if (last !== undefined && start <= last.end + 1) last.end = Math.max(last.end, end)
    else ranges.push({ start, end })
  }
  return ranges
}

/**
 * The changed parts of `before → after`, with context, as unified-diff hunks.
 *
 * An empty array means the two texts are identical — the dialog says so in words
 * rather than drawing an empty frame.
 */
export function unifiedHunks(
  before: string,
  after: string,
  context: number = DEFAULT_CONTEXT,
): DiffHunk[] {
  const lines = diffLines(before, after)
  return hunkRanges(lines, context).map((range) => {
    const slice = lines.slice(range.start, range.end + 1)
    const kept = slice.filter((line) => line.kind !== 'add')
    const added = slice.filter((line) => line.kind !== 'remove')
    return {
      beforeStart: kept[0]?.before ?? 0,
      beforeCount: kept.length,
      afterStart: added[0]?.after ?? 0,
      afterCount: added.length,
      lines: slice,
    }
  })
}

/** The `@@ -a,b +c,d @@` header a hunk is labelled with. */
export function hunkHeader(hunk: DiffHunk): string {
  return `@@ -${hunk.beforeStart},${hunk.beforeCount} +${hunk.afterStart},${hunk.afterCount} @@`
}

/** The marker column `diff -u` puts in front of a line. */
export function lineMarker(kind: DiffKind): string {
  return kind === 'add' ? '+' : kind === 'remove' ? '-' : ' '
}

/** The hunks as the text `diff -u` would print, for copying out of the dialog. */
export function formatUnified(hunks: readonly DiffHunk[]): string {
  return hunks
    .map((hunk) =>
      [hunkHeader(hunk), ...hunk.lines.map((line) => `${lineMarker(line.kind)}${line.text}`)].join(
        '\n',
      ),
    )
    .join('\n')
}
