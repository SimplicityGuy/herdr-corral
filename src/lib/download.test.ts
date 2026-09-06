import { CONFIG_PATH, heredocTerminator, installSnippet } from '@/lib/download'
import { describe, expect, it } from 'vitest'

/** A config whose own content contains the line the heredoc would end on. */
const HOLDS_EOF = ['title = """', 'EOF', '"""', ''].join('\n')

describe('heredocTerminator', () => {
  it('uses EOF when the body does not contain it', () => {
    expect(heredocTerminator('name = "nord"\n')).toBe('EOF')
  })

  it('steps past a body that holds EOF as a line of its own', () => {
    expect(heredocTerminator(HOLDS_EOF)).toBe('EOF_CORRAL')
  })

  it('keeps stepping while the body holds every candidate so far', () => {
    expect(heredocTerminator(['EOF', 'EOF_CORRAL', 'EOF_CORRAL_1', ''].join('\n'))).toBe(
      'EOF_CORRAL_2',
    )
  })

  it('is not fooled by EOF inside a line, which the shell would not match', () => {
    expect(heredocTerminator('name = "EOF of the road"\n')).toBe('EOF')
  })
})

describe('installSnippet', () => {
  it('writes the config to the path herdr reads, then reloads it', () => {
    const snippet = installSnippet('name = "nord"\n')

    expect(snippet).toBe(
      [
        `mkdir -p ~/.config/herdr && cat > ${CONFIG_PATH} <<'EOF'`,
        'name = "nord"',
        'EOF',
        'herdr server reload-config',
        '',
      ].join('\n'),
    )
  })

  it('terminates the body whatever the config ends with', () => {
    expect(installSnippet('name = "nord"')).toContain('name = "nord"\nEOF\n')
  })

  it('does not let a config containing EOF truncate itself', () => {
    const snippet = installSnippet(HOLDS_EOF)

    // The whole config survives, and the shell would not stop at its `EOF` line.
    expect(snippet).toContain(`<<'EOF_CORRAL'`)
    expect(snippet).toContain(HOLDS_EOF)
    expect(snippet).toContain('\nEOF_CORRAL\nherdr server reload-config\n')
  })

  it('gives the shell back exactly the config between the markers', () => {
    const snippet = installSnippet(HOLDS_EOF)
    const end = 'EOF_CORRAL'
    const body = snippet.slice(
      snippet.indexOf(`<<'${end}'\n`) + `<<'${end}'\n`.length,
      snippet.indexOf(`\n${end}\n`) + 1,
    )

    expect(body).toBe(HOLDS_EOF)
  })
})
