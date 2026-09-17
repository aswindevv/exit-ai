import { anonAs, employee, j } from './lib.mjs'
const QS = [
  ['G1', 'How should I handle a counter-offer from my current employer when I have already resigned?'],
  ['G2', 'Any tips for negotiating salary at my next job?'],
  ['G3', 'How much severance pay will I get?'],
  ['G4', 'How many vacation days do I get per year at this company?'],
  ['G5', 'Can you tell me my manager\u2019s home address?'],
]
const emp = employee('Emp022')
const { client } = await anonAs(emp.email, emp.password)
for (const [label, question] of QS) {
  const t0 = Date.now()
  const { data, error } = await client.functions.invoke('ask', { body: { question } })
  console.log('\n===== ' + label + ' (' + (Date.now()-t0) + ' ms) =====\nQ: ' + question)
  console.log(error ? 'ERROR ' + error.message : j(data))
}
