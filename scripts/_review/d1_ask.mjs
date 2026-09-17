import { anonAs, employee, svc, j } from './lib.mjs'

const QS = [
  ['Q1 policy notice period', 'What is the minimum notice period I must serve when I resign?'],
  ['Q2 policy settlement',    'How long does the final settlement take after my last working day?'],
  ['Q3 general work',         'How do I write a good handover document for my replacement?'],
  ['Q4 offtopic',             "What's a good pasta recipe?"],
  ['Q5 greeting',             'hi'],
]

const emp = employee('Emp022')
const { client, userId } = await anonAs(emp.email, emp.password)
console.log('signed in as', emp.email, userId)

for (const [label, question] of QS) {
  const t0 = Date.now()
  const { data, error } = await client.functions.invoke('ask', { body: { question } })
  const ms = Date.now() - t0
  console.log('\n===== ' + label + ' (' + ms + ' ms) =====')
  console.log('Q: ' + question)
  if (error) {
    console.log('ERROR ' + error.message)
    try { console.log('body:', await error.context?.text()) } catch {}
  } else {
    console.log(j(data))
  }
}

// exit_docs readable by anon?
console.log('\n===== exit_docs via ANON (signed-in employee) =====')
const r = await client.from('exit_docs').select('id', { count: 'exact', head: false }).limit(3)
console.log('data=', JSON.stringify(r.data), 'error=', r.error ? r.error.message + ' / code=' + r.error.code : null)

console.log('\n===== exit_docs via SERVICE (inventory) =====')
const db = svc()
const { count } = await db.from('exit_docs').select('*', { count: 'exact', head: true })
console.log('total chunks:', count)
const { data: all } = await db.from('exit_docs').select('source, section').limit(2000)
const bySource = {}
for (const row of all) bySource[row.source] = (bySource[row.source] || 0) + 1
console.log('by source:', JSON.stringify(bySource))
console.log('distinct sections:', new Set(all.map(a => a.section)).size)
