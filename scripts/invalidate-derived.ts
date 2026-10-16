/**
 * Drops every cached view of a user's history (derived:v1, history:v3, statistics:*, summary).
 * For the ledger edits that bypass the API — manual SQL, one-off scripts — which are otherwise
 * only bounded by the 15 minute derived TTL.
 *
 * Run with: npx tsx --env-file=.env scripts/invalidate-derived.ts <userId>
 */
import { invalidateUserCache, ensureRedisConnected } from '../src/lib/redis'

const userId = process.argv[2]
if (!userId) {
  console.error('Usage: npx tsx --env-file=.env scripts/invalidate-derived.ts <userId>')
  process.exit(1)
}

;(async () => {
  if (!(await ensureRedisConnected())) {
    console.error('Redis is not reachable; nothing invalidated.')
    process.exit(1)
  }
  await invalidateUserCache(userId)
  console.log(`Invalidated caches for ${userId}`)
  process.exit(0)
})()
