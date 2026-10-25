/** A page's localStorage, in memory: Node's own localStorage global shadows jsdom's in tests. */
export function memoryStorage() {
  const items = new Map<string, string>()
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => { items.set(key, String(value)) },
    removeItem: (key: string) => { items.delete(key) },
  }
}
