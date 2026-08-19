import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const TEST_USER_ID = '94b2edc8-5376-4233-87b4-e650c0d97b92'

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function testBatchRollback() {
  console.log('Testing Atomic Batch Import Rollback...')

  await supabase.from('transactions').delete().eq('user_id', TEST_USER_ID)
  await supabase.from('cash_movements').delete().eq('user_id', TEST_USER_ID)

  const dirtyBatch = [
    { date: '2024-01-01', ticker: 'AMD', operation: 'COMPRA', quantity: 1, price: 100 },
    { date: '2024-01-02', ticker: 'MMM', operation: 'COMPRA', quantity: 1, price: 100 },
    { date: '2024-13-45', ticker: 'AAPL', operation: 'COMPRA', quantity: 1, price: 100 }
  ]

  console.log('Sending test batch with invalid row (2 valid, 1 invalid)...')
  
  const { data, error } = await supabase.rpc('import_transactions_atomic', {
    p_user_id: TEST_USER_ID,
    p_transactions: dirtyBatch
  })

  if (error || (data && data[0]?.success === false)) {
    console.log('Received expected error:', error?.message || data[0]?.error_details[0]?.error)
  } else {
    console.error('Batch should have failed but succeeded')
    process.exit(1)
  }

  const { data: txs } = await supabase.from('transactions').select('id').eq('user_id', TEST_USER_ID)
  
  if (txs && txs.length === 0) {
    console.log('Rollback successful: 0 transactions committed.')
  } else {
    console.error(`Rollback failed: ${txs?.length} transactions saved unexpectedly.`)
    process.exit(1)
  }
}

testBatchRollback()

