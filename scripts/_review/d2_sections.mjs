import { svc } from './lib.mjs'
import fs from 'fs'
const db = svc()
const { data } = await db.from('exit_docs').select('source, section, content').limit(2000)
const indexed = new Set(data.map(d => d.section))
const file = fs.readFileSync('scripts/exit_policy.md','utf8')
const heads = [...file.matchAll(/^§([\d.]+)\s+(.+)$/gm)].map(m => ({num:m[1], title:m[2].trim()}))
console.log('headings in file:', heads.length, ' chunks in db:', data.length)
const missing = heads.filter(h => !indexed.has(h.title))
console.log('\nHEADINGS NOT PRESENT AS A CHUNK SECTION (' + missing.length + '):')
for (const m of missing) console.log('  §' + m.num + ' ' + m.title)
const extra = [...indexed].filter(s => !heads.some(h => h.title === s))
console.log('\nCHUNK SECTIONS WITH NO MATCHING HEADING (' + extra.length + '):')
for (const e of extra) console.log('  ' + e)
// show content of the 3 sections cited by Q3
for (const s of ['KT gaps and rework','Knowledge transfer (KT)','Handover of credentials and accounts','Resignation notice period','Final settlement']) {
  const row = data.find(d => d.section === s)
  console.log('\n--- [' + s + '] ---\n' + (row ? row.content.slice(0,600) : 'NOT INDEXED'))
}
