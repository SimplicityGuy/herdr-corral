/**
 * vitest setup: jest-dom matchers, cleanup, and the browser APIs jsdom does not
 * implement that the vendored Radix and cmdk components call on mount or on
 * pointer interaction.
 *
 * Every stub is inert. `ResizeObserver` exists so cmdk's list can register one;
 * it never fires, which is right, because nothing in a jsdom test resizes.
 * `scrollIntoView` is what cmdk calls to keep the selected item visible, and
 * jsdom has no scrolling to do. The pointer-capture trio is what Radix's
 * `Select` calls when a trigger is pressed (`hasPointerCapture`) and released
 * (`setPointerCapture` / `releasePointerCapture`) — jsdom has no pointer
 * capture at all, so "not captured" and "no-op" are the right answers. Stubbing
 * them here rather than per test keeps the component tests about the components.
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
  Element.prototype.hasPointerCapture ??= function hasPointerCapture(): boolean {
    return false
  }
  Element.prototype.setPointerCapture ??= function setPointerCapture(): void {}
  Element.prototype.releasePointerCapture ??= function releasePointerCapture(): void {}
})

afterEach(() => {
  cleanup()
})
