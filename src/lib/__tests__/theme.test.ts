import { describe, it, expect } from 'vitest'
import { parseThemePref, resolveTheme, THEME_BOOT_SCRIPT, THEME_STORAGE_KEY } from '../theme'

describe('parseThemePref', () => {
  it('accepts the three known preferences', () => {
    expect(parseThemePref('dark')).toBe('dark')
    expect(parseThemePref('light')).toBe('light')
    expect(parseThemePref('system')).toBe('system')
  })

  it('falls back to system for unknown or missing values', () => {
    expect(parseThemePref('banana')).toBe('system')
    expect(parseThemePref(null)).toBe('system')
  })
})

// odd/tasks/ux-base-global.md S4: every screen follows the chosen theme, including a 404 and the
// offline page (since 2026-10-22 there is no old-style page left to force into dark).
describe('resolveTheme', () => {
  it('maps the preference to data-theme, or null to follow the system', () => {
    expect(resolveTheme('light')).toBe('light')
    expect(resolveTheme('dark')).toBe('dark')
    expect(resolveTheme('system')).toBeNull()
  })
})

describe('THEME_BOOT_SCRIPT', () => {
  function boot(path: string, stored: string | null) {
    const dataset: Record<string, string> = {}
    const run = new Function('document', 'localStorage', 'location', THEME_BOOT_SCRIPT)
    run({ documentElement: { dataset } }, { getItem: () => stored }, { pathname: path })
    return dataset.theme
  }

  it('applies the stored theme on any path, an unknown one included', () => {
    expect(boot('/dashboard', 'light')).toBe('light')
    expect(boot('/no-existe', 'light')).toBe('light')
    expect(boot('/offline', 'dark')).toBe('dark')
  })

  it('follows the system when nothing valid is stored', () => {
    expect(boot('/no-existe', null)).toBeUndefined()
    expect(boot('/dashboard', 'banana')).toBeUndefined()
  })

  it('reads the stored preference defensively', () => {
    expect(THEME_BOOT_SCRIPT).toContain(THEME_STORAGE_KEY)
    expect(THEME_BOOT_SCRIPT).toContain('try')
  })
})
