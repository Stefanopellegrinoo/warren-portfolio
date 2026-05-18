export const SIGNAL_COLORS = ['#FFCC00', '#FF8C00', '#9B59B6', '#00BFFF', '#00FF7F']

export function getSetupColor(setupId: string): string {
  let hash = 0
  for (let i = 0; i < setupId.length; i++) {
    hash = (hash * 31 + setupId.charCodeAt(i)) | 0
  }
  return SIGNAL_COLORS[Math.abs(hash) % SIGNAL_COLORS.length]
}
