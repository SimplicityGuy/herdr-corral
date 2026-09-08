/**
 * The link to the repository — the GitHub mark and an invitation to star it.
 *
 * GitHub's own badge would show the live star count, and fetching that is the one
 * thing this app never does: ADR-0001 promises no network call at runtime, and
 * `scripts/no-network.test.ts` holds it to that. So the mark is an inline SVG
 * (GitHub's Octicon, MIT) and the count is left to the page the link opens. The
 * dress is the diagnostics line's: `subtext0` at rest, `text` on hover, the same
 * padding as the verbs beside it, and the `★` is a text glyph like the line's
 * `●` and `▲` rather than an icon in a second visual language.
 */
export const REPO_URL = 'https://github.com/SimplicityGuy/herdr-corral'
export const REPO_TEXT = 'star on github'

export function RepoLink({ className = '' }: { readonly className?: string }) {
  return (
    <a
      href={REPO_URL}
      target="_blank"
      rel="noopener noreferrer"
      title="SimplicityGuy/herdr-corral on GitHub"
      className={`flex shrink-0 items-center gap-[6px] whitespace-nowrap text-subtext0 hover:text-text ${className}`}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        width="14"
        height="14"
        fill="currentColor"
        className="shrink-0"
      >
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
      </svg>
      <span>{'★'} {REPO_TEXT}</span>
    </a>
  )
}
