import { svc, j } from './lib.mjs'
import { readFileSync } from 'node:fs'
const CASE='36148438-4dc0-4741-a37f-d8ddc74713ad'
const db=svc()
const { data: c } = await db.from('exit_cases').select('employee_id').eq('id',CASE).single()
if (c.employee_id!=='Emp031') throw new Error('WRONG CASE')
const ts = Date.now()
const path = `${CASE}/NDA-${ts}.png`
const bytes = readFileSync('scripts/_review/tmp/nda_emp031.png')
const { data: up, error: upErr } = await db.storage.from('exit-documents').upload(path, bytes, { contentType:'image/png' })
if (upErr) throw new Error('upload: '+upErr.message)
console.log('uploaded:', j(up))
const { data: row, error } = await db.from('case_documents').insert({ case_id: CASE, doc_type:'NDA', file_path: path, status:'submitted' }).select().single()
if (error) throw new Error('insert: '+error.message)
console.log('case_documents row:', j(row))
