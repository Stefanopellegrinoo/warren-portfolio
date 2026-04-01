import { fetchData912Price } from './src/lib/data912-client'

async function test() {
  console.log('Testing CS50O (should be null):')
  const result1 = await fetchData912Price('CS50O')
  console.log(result1)

  console.log('\nTesting AERBD (should work):')
  const result2 = await fetchData912Price('AERBD')
  console.log(result2)
}

test().catch(console.error)
