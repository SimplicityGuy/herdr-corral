import { defineConfig, devices } from '@playwright/test'

/**
 * The preview server's port.
 *
 * A worktree is not the only checkout on this machine — several agents run the
 * suite at once — and a hard-coded port makes the second run either fail to bind
 * or, worse, quietly test the *first* worktree's `dist/`. `PLAYWRIGHT_PORT`
 * gives each run its own port, and `--strictPort` makes a collision an error
 * rather than a silent hop to the next free one.
 */
const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 4173)
const BASE_URL = `http://localhost:${PORT}`

/**
 * e2e runs against the built app in `dist/`, not the dev server, so what CI
 * exercises is what Cloudflare Pages will serve.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm build && pnpm preview --port ${PORT} --strictPort`,
    url: BASE_URL,
    // Reusing a server someone else started is a convenience for the default
    // port on a developer's machine and a trap everywhere else: in CI it would
    // hide a broken build, and an explicit `PLAYWRIGHT_PORT` is a request for
    // *this* worktree's `dist/`, which a foreign server is not.
    reuseExistingServer: !process.env.CI && !process.env.PLAYWRIGHT_PORT,
    timeout: 120_000,
  },
})
