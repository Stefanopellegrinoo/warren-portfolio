export type ThemePref = 'light' | 'dark' | 'system'

export const THEME_STORAGE_KEY = 'warren-theme'

// Screens on the new design system follow the user's theme; any other path is
// forced to dark. Since 2026-10-22 every page of the app is on the new system.
export const REDESIGNED_PATHS: readonly string[] = [
  '/dashboard', '/trading', '/history', '/statistics', '/ons', '/strategies', '/cashflow', '/auth',
]

export function isRedesigned(pathname: string): boolean {
  return REDESIGNED_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))
}

export function parseThemePref(raw: string | null): ThemePref {
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system'
}

/** The value for `<html data-theme>`, or null to follow the operating system. */
export function resolveTheme(pref: ThemePref, pathname: string): 'light' | 'dark' | null {
  if (!isRedesigned(pathname)) return 'dark'
  return pref === 'system' ? null : pref
}

// Runs before first paint so the page never flashes the wrong theme.
export const THEME_BOOT_SCRIPT = `(function(){try{
var paths=${JSON.stringify(REDESIGNED_PATHS)},p=location.pathname,pref=null;
try{pref=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})}catch(e){}
var redesigned=paths.some(function(r){return p===r||p.indexOf(r+'/')===0});
var t=!redesigned?'dark':(pref==='light'||pref==='dark'?pref:null);
if(t)document.documentElement.dataset.theme=t;else delete document.documentElement.dataset.theme;
}catch(e){}})();`
