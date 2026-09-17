import { purgeCase, casesFor } from './lib.mjs'
const MAP = { Emp032:'e8cefe4f-0e53-43d1-b04c-22762bb73bae', Emp033:'a629a0cb-764a-467d-86b8-348af8ec7c61', Emp034:'ea09584c-4fa0-4f1c-932a-feb808150529' }
for (const [emp, id] of Object.entries(MAP)) {
  const r = await purgeCase(id, emp)
  console.log('PURGE', emp, id, JSON.stringify(r))
}
for (const emp of Object.keys(MAP)) console.log('casesFor', emp, JSON.stringify(await casesFor(emp)))
