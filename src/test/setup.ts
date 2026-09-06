/**
 * vitest setup: jest-dom matchers, cleanup, and the two browser APIs jsdom does
 * not implement that the vendored Radix and cmdk components call on mount.
 *
 * Both stubs are inert. `ResizeObserver` exists so cmdk's list can register one;
 * it never fires, which is right, because nothing in a jsdom test resizes.
 * `scrollIntoView` is what cmdk calls to keep the selected item visible, and
 * jsdom has no scrolling to do. Stubbing them here rather than per test keeps the
 * component tests about the components.
 */
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeAll } from 'vitest'

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  Element.prototype.scrollIntoView ??= function scrollIntoView(): void {}
})

afterEach(() => {
  cleanup()
})
