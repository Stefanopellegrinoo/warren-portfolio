import { describe, it, expect } from 'vitest'
import { parseThemePref, isRedesigned, resolveTheme, THEME_BOOT_SCRIPT, THEME_STORAGE_KEY } from '../theme'

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

describe('isRedesigned', () => {
  it('covers every page of the app and the login', () => {
    for (const p of ['/dashboard', '/trading', '/history', '/statistics', '/ons/mi-cartera', '/strategies/1', '/cashflow', '/auth/login']) {
      expect(isRedesigned(p), p).toBe(true)
    }
  })

  it('matches redesigned routes and their subpaths only', () => {
    expect(isRedesigned('/dashboard')).toBe(true)
    expect(isRedesigned('/dashboard/x')).toBe(true)
    expect(isRedesigned('/not-a-page')).toBe(false)
    expect(isRedesigned('/dashboardx')).toBe(false)
  })

  it('includes the trading chart, so it follows the chosen theme', () => {
    expect(isRedesigned('/trading')).toBe(true)
    expect(resolveTheme('light', '/trading')).toBe('light')
  })
})

describe('resolveTheme', () => {
  it('applies the preference on redesigned routes, null meaning follow the system', () => {
    expect(resolveTheme('light', '/dashboard')).toBe('light')
    expect(resolveTheme('dark', '/dashboard')).toBe('dark')
    expect(resolveTheme('system', '/dashboard')).toBeNull()
  })

  it('forces dark on pages that still use the old style', () => {
    expect(resolveTheme('light', '/not-a-page')).toBe('dark')
    expect(resolveTheme('system', '/not-a-page/x')).toBe('dark')
  })
})

describe('THEME_BOOT_SCRIPT', () => {
  it('reads the stored preference defensively and knows the redesigned routes', () => {
    expect(THEME_BOOT_SCRIPT).toContain(THEME_STORAGE_KEY)
    expect(THEME_BOOT_SCRIPT).toContain('try')
    expect(THEME_BOOT_SCRIPT).toContain('"/dashboard"')
  })
})
