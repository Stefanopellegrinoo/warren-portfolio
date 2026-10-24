export type ThemePref = 'light' | 'dark' | 'system'

export const THEME_STORAGE_KEY = 'warren-theme'

export function parseThemePref(raw: string | null): ThemePref {
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system'
}

/** The value for `<html data-theme>`, or null to follow the operating system. */
export function resolveTheme(pref: ThemePref): 'light' | 'dark' | null {
  return pref === 'system' ? null : pref
}

// Runs before first paint so the page never flashes the wrong theme.
export const THEME_BOOT_SCRIPT = `(function(){try{
var t=null;try{t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})}catch(e){}
if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;else delete document.documentElement.dataset.theme;
}catch(e){}})();`
