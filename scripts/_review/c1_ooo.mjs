import { svc, j } from './lib.mjs'
const db=svc()
const val = process.argv[2]==='true'
const { data } = await db.from('profiles').update({out_of_office: val}).eq('email','siva@company.com').select('email,full_name,out_of_office')
console.log('SIVA out_of_office ->', j(data))
