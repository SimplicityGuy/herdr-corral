/**
 * One reading of `validate()` for the whole shell.
 *
 * Three places want it at once — the tree marks bad rows, the diagnostics line
 * counts them, the popover shows the message for the key being edited — and
 * `validate()` walks 167 keys, so it must not run three times per keystroke.
 *
 * The cache key is the *identity of the effective map*, not a hash of it. The
 * config store already memoizes `effectiveAll()` on the identity of the edit map
 * that produced it, so an unrelated re-render hands back the same `Map` and hits
 * this cache, and an undo hands back a `Map` it built before and hits it too. A
 * `WeakMap` keeps that from becoming a leak: the entry dies with the map.
 *
 * The call itself is the one `validate.ts` documents:
 *
 * ```ts
 * validate(store.effectiveAll(), unknownKeysIn(store.explicit().keys()), store.explicit().keys())
 * ```
 *
 * Both `unknownKeys` and `userKeys` come from the *explicit* map rather than the
 * effective one, and for different reasons: a key is only "unknown" if the user's
 * file wrote it, and a keybinding only conflicts as the user's if the user set it.
 */
import type { ConfigValues } from '@/model/export'
import { type Diagnostic, unknownKeysIn, validate } from '@/model/validate'
import { useConfigStore } from '@/store/config'
import { useMemo } from 'react'

/** What the diagnostics line shows, counted once. */
export interface DiagnosticSummary {
  readonly errors: number
  readonly warnings: number
  /** The first warning in path order, whose text the line prints. */
  readonly firstWarning: Diagnostic | undefined
  readonly firstError: Diagnostic | undefined
}

const cache = new WeakMap<ConfigValues, readonly Diagnostic[]>()

/** Every diagnostic for this config, computed once per effective map. */
export function diagnosticsOf(
  effective: ConfigValues,
  explicit: ConfigValues,
): readonly Diagnostic[] {
  const cached = cache.get(effective)
  if (cached !== undefined) return cached
  const userKeys = [...explicit.keys()]
  const fresh = validate(effective, unknownKeysIn(userKeys), userKeys)
  cache.set(effective, fresh)
  return fresh
}

/** Count the diagnostics the way the line reports them. */
export function summarize(diagnostics: readonly Diagnostic[]): DiagnosticSummary {
  let errors = 0
  let warnings = 0
  let firstWarning: Diagnostic | undefined
  let firstError: Diagnostic | undefined
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === 'error') {
      errors += 1
      firstError ??= diagnostic
    } else {
      warnings += 1
      firstWarning ??= diagnostic
    }
  }
  return { errors, warnings, firstWarning, firstError }
}

/** The diagnostics at one path, and at the paths inside it. */
export function diagnosticsAt(
  diagnostics: readonly Diagnostic[],
  path: string,
): readonly Diagnostic[] {
  return diagnostics.filter(
    (diagnostic) =>
      diagnostic.path === path ||
      diagnostic.path.startsWith(`${path}.`) ||
      diagnostic.path.startsWith(`${path}[`),
  )
}

/**
 * The current diagnostics, recomputed only when the document changes.
 *
 * Both selectors hand back maps the store memoized on its edit map, so a render
 * caused by anything else — a section switch, a popover opening — sees the same
 * two references and the `useMemo` does not fire.
 */
export function useDiagnostics(): readonly Diagnostic[] {
  const effective = useConfigStore((state) => state.effectiveAll())
  const explicit = useConfigStore((state) => state.explicit())
  return useMemo(() => diagnosticsOf(effective, explicit), [effective, explicit])
}
