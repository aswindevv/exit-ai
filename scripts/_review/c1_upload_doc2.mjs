import { svc, j } from './lib.mjs'
import { readFileSync } from 'node:fs'
const CASE='36148438-4dc0-4741-a37f-d8ddc74713ad'
const db=svc()
const { data: c } = await db.from('exit_cases').select('employee_id').eq('id',CASE).single()
if (c.employee_id!=='Emp031') throw new Error('WRONG CASE')
const src = process.argv[2], type = process.argv[3]
const path = `${CASE}/${type}-${Date.now()}.png`
const { error: upErr } = await db.storage.from('exit-documents').upload(path, readFileSync(src), { contentType:'image/png' })
if (upErr) throw new Error('upload: '+upErr.message)
const { data: row, error } = await db.from('case_documents').insert({ case_id: CASE, doc_type: type, file_path: path, status:'submitted' }).select().single()
if (error) throw new Error('insert: '+error.message)
console.log('row:', j(row))
