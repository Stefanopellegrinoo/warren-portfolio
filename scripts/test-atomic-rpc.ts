import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase environment variables. Check .env.local')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

const TEST_USER_ID = '94b2edc8-5376-4233-87b4-e650c0d97b92'

async function runTests() {
  console.log('🚀 Starting Atomic Transaction RPC Tests (v3.2)...')
  console.log(`👤 Using TEST user: ${TEST_USER_ID}`)

  // 1. CLEANUP (Solo para el usuario de TEST)
  console.log('\n🧹 Cleaning up test data for TEST_USER...')
  const TICKER = 'AMD'
  
  // Borramos transacciones y posiciones de prueba
  await supabase.from('transactions').delete().eq('user_id', TEST_USER_ID).eq('ticker', TICKER)
  await supabase.from('positions').delete().eq('user_id', TEST_USER_ID).eq('ticker', TICKER)
  await supabase.from('cash_movements').delete().eq('user_id', TEST_USER_ID).eq('ticker', TICKER)
  
  // Reseteamos el saldo a un valor conocido para el test
  const { error: resetErr } = await supabase.from('cash_balance').upsert({ 
    user_id: TEST_USER_ID, 
    balance: 10000, 
    updated_at: new Date().toISOString(), 
    version: 1 
  }, { onConflict: 'user_id' })
  
  if (resetErr) console.error('⚠️ Error resetting balance:', resetErr.message)


  try {
    // 🧪 TEST 1: Simple Buy
    console.log('\n🧪 TEST 1: Simple Buy (10 @ $150, $5 comm)...')
    const { error: e1 } = await supabase.rpc('process_transaction_atomic', {
      p_date: new Date().toISOString().split('T')[0],
      p_ticker: TICKER,
      p_operation: 'COMPRA',
      p_quantity: 10,
      p_price: 150,
      p_commission: 5,
      p_asset_type: 'ACCION',
      p_user_id: TEST_USER_ID,
      p_notes: null,
      p_moneda: 'USD'
    })

    if (e1) throw e1
    console.log('✅ RPC call successful')

    const { data: pos1 } = await supabase.from('positions').select('*').eq('user_id', TEST_USER_ID).eq('ticker', TICKER).single()
    if (!pos1) throw new Error('Position not found')
    console.log(`   Position: Qty=${pos1.quantity}, AvgCost=${pos1.avg_cost}, TotalInv=${pos1.total_invested}`)
    
    if (Number(pos1.quantity) !== 10) throw new Error(`Wrong quantity: ${pos1.quantity}`)
    if (Number(pos1.avg_cost) !== 150.5) throw new Error(`Wrong avg cost: ${pos1.avg_cost}`)

    const { data: cash1 } = await supabase.from('cash_balance').select('balance').eq('user_id', TEST_USER_ID).single()
    if (!cash1) throw new Error('Cash balance not found')
    console.log(`   Cash Balance: $${cash1.balance}`)
    if (Number(cash1.balance) !== 8495) throw new Error(`Wrong cash balance: ${cash1.balance}`)


    // 🧪 TEST 2: Partial Sell
    console.log('\n🧪 TEST 2: Partial Sell (4 @ $200, $2 comm)...')
    const { error: e2 } = await supabase.rpc('process_transaction_atomic', {
      p_date: new Date().toISOString().split('T')[0],
      p_ticker: TICKER,
      p_operation: 'VENTA',
      p_quantity: 4,
      p_price: 200,
      p_commission: 2,
      p_asset_type: 'ACCION',
      p_user_id: TEST_USER_ID,
      p_notes: null,
      p_moneda: 'USD'
    })

    if (e2) throw e2
    
    const { data: pos2 } = await supabase.from('positions').select('*').eq('user_id', TEST_USER_ID).eq('ticker', TICKER).single()
    if (!pos2) throw new Error('Position not found after sell')
    console.log(`   Position: Qty=${pos2.quantity}, AvgCost=${pos2.avg_cost}`)
    if (Number(pos2.quantity) !== 6) throw new Error(`Wrong quantity: ${pos2.quantity}`)
    if (Number(pos2.avg_cost) !== 150.5) throw new Error('Avg cost changed during sell!')

    const { data: cash2 } = await supabase.from('cash_balance').select('balance').eq('user_id', TEST_USER_ID).single()
    if (!cash2) throw new Error('Cash balance not found after sell')
    console.log(`   Cash Balance: $${cash2.balance}`)
    if (Number(cash2.balance) !== 9293) throw new Error(`Wrong cash balance: ${cash2.balance}`)

    // ✅ NUEVA VALIDACIÓN: Verificar closed_trades
    console.log('   Verifying closed_trades entry...')
    const { data: ct2 } = await supabase
      .from('closed_trades')
      .select('*')
      .eq('user_id', TEST_USER_ID)
      .eq('ticker', TICKER)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    
    if (!ct2) throw new Error('Closed trade record NOT FOUND')
    console.log(`   Closed Trade: Qty=${ct2.quantity}, PnL=$${ct2.pnl}, PnL%=${(ct2.pnl_pct * 100).toFixed(2)}%`)
    
    if (Number(ct2.quantity) !== 4) throw new Error(`Wrong closed quantity: ${ct2.quantity}`)
    // PnL expected: (200 - 150.5) * 4 - 2 (commission) = 196
    if (Math.abs(Number(ct2.pnl) - 196) > 0.1) throw new Error(`Wrong PnL: ${ct2.pnl} (expected ~196)`)


    // 🧪 TEST 3: Insufficient Position
    console.log('\n🧪 TEST 3: Insufficient Position Error...')
    const { error: e3 } = await supabase.rpc('process_transaction_atomic', {
      p_date: new Date().toISOString().split('T')[0],
      p_ticker: TICKER,
      p_operation: 'VENTA',
      p_quantity: 100,
      p_price: 200,
      p_user_id: TEST_USER_ID
    })
    
    if (e3) {
      console.log(`✅ Received expected error: ${e3.message}`)
    } else {
      throw new Error('Should have failed with insufficient position!')
    }


    // 🧪 TEST 4: Concurrency
    console.log('\n🧪 TEST 4: Concurrency Simulation...')
    console.log('   Firing 2 simultaneous buys...')
    const results = await Promise.all([
        supabase.rpc('process_transaction_atomic', {
            p_date: new Date().toISOString().split('T')[0],
            p_ticker: TICKER,
            p_operation: 'COMPRA',
            p_quantity: 1,
            p_price: 100,
            p_user_id: TEST_USER_ID
        }),
        supabase.rpc('process_transaction_atomic', {
            p_date: new Date().toISOString().split('T')[0],
            p_ticker: TICKER,
            p_operation: 'COMPRA',
            p_quantity: 1,
            p_price: 100,
            p_user_id: TEST_USER_ID
        })
    ])

    const errors = results.filter(r => r.error)
    if (errors.length > 0) {
        console.log(`   One call failed/waited (race condition): ${errors[0].error?.message}`)
    } else {
        console.log('   Both calls succeeded (Locking handled it)')
    }

    const { data: finalPos } = await supabase.from('positions').select('*').eq('user_id', TEST_USER_ID).eq('ticker', TICKER).single()
    if (!finalPos) throw new Error('Final position not found')
    console.log(`   Final Position Qty: ${finalPos.quantity} (Version: ${finalPos.version})`)


    console.log('\n✨ ALL ATOMIC TESTS PASSED SUCCESSFULLY! ✨')

  } catch (err: any) {
    console.error('\n❌ TEST FAILED!')
    console.error(err.message || err)
    process.exit(1)
  }
}

runTests()
