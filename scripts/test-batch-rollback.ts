import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const TEST_USER_ID = '94b2edc8-5376-4233-87b4-e650c0d97b92'

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function testBatchRollback() {
  console.log('🚀 Testing Atomic Batch Import Rollback...')

  // 1. CLEANUP
  console.log('🧹 Cleaning up...')
  await supabase.from('transactions').delete().eq('user_id', TEST_USER_ID)
  await supabase.from('cash_movements').delete().eq('user_id', TEST_USER_ID)

  // 2. PREPARE DIRTY BATCH
  // The 3rd transaction is invalid (Invalid date format for Postgres)
  const dirtyBatch = [
    { date: '2024-01-01', ticker: 'AMD', operation: 'COMPRA', quantity: 1, price: 100 },
    { date: '2024-01-02', ticker: 'MMM', operation: 'COMPRA', quantity: 1, price: 100 },
    { date: '2024-13-45', ticker: 'AAPL', operation: 'COMPRA', quantity: 1, price: 100 } // ERROR AQUÍ
  ]

  console.log('📤 Sending dirty batch (2 valid, 1 invalid)...')
  
  const { data, error } = await supabase.rpc('import_transactions_atomic', {
    p_user_id: TEST_USER_ID,
    p_transactions: dirtyBatch
  })

  if (error || (data && data[0]?.success === false)) {
    console.log('✅ Received expected error:', error?.message || data[0]?.error_details[0]?.error)
  } else {
    console.error('❌ Batch should have failed but succeeded!')
    process.exit(1)
  }

  // 3. VERIFY ROLLBACK
  console.log('🔍 Verifying if any transaction was saved...')
  const { data: txs } = await supabase.from('transactions').select('id').eq('user_id', TEST_USER_ID)
  
  if (txs && txs.length === 0) {
    console.log('✨ ROLLBACK SUCCESSFUL: No transactions were saved! ✨')
  } else {
    console.error(`❌ ROLLBACK FAILED: ${txs?.length} transactions were saved despite the error!`)
    process.exit(1)
  }
}

testBatchRollback()
