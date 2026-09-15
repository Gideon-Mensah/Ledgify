import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {documentActions} from '../src/utils/documentActions.js';import {documentIdentity} from '../src/utils/documentIdentity.js';
test('invoice and bill action/state/permission matrix blocks unsafe states and settlements',()=>{
 for(const kind of ['invoice','bill'])for(const state of ['draft','awaiting_approval','approved','sent','partly_paid','paid','void','written_off'])for(const allowed of [false,true]){
  const actions=documentActions(kind,{backendStatus:state,amountDue:'100',amountPaid:'0',amountCredited:'0'},()=>allowed);
  for(const action of Object.values(actions))assert.equal(action.visible,allowed);
  assert.equal(actions.edit.enabled,state==='draft');assert.equal(actions.approve.enabled,state==='draft');
  assert.equal(actions.email.enabled,kind==='invoice'&&['approved','sent','partly_paid','paid'].includes(state));
  if(['void','written_off','draft','awaiting_approval'].includes(state)){assert.equal(actions.reverse.enabled,false);assert.equal(actions.pay.enabled,false);}
 }
 for(const kind of ['invoice','bill'])for(const settlement of [{amountPaid:'1'},{amountCredited:'1'}])assert.equal(documentActions(kind,{status:'approved',...settlement},()=>true).reverse.enabled,false);
});
test('identity has no fictitious defaults and switches cleanly between organisations',()=>{
 const gh=documentIdentity({name:'Accra',base_currency:'GHS',ghana_post_gps:'GA-123',payment_instructions:'MoMo A'});const gb=documentIdentity({name:'Bristol',base_currency:'GBP'});
 assert.equal(gh.name,'Accra');assert.deepEqual(gh.address,['GA-123']);assert.equal(gb.payment_instructions,undefined);assert.deepEqual(gb.address,[]);assert.throws(()=>documentIdentity({}),/profile/);
});
test('print styles cannot globally hide another route and source journal reverse UI is manual only',async()=>{
 for(const file of ['journals','journalDetails','banking','liveReports']){const css=await readFile(`src/styles/${file}.css`,'utf8');assert.doesNotMatch(css,/body\s+\*\s*\{\s*visibility:\s*hidden/);}
 const page=await readFile('src/pages/accounting/JournalDetailsPage.jsx','utf8');assert.match(page,/journal.source_type === "manual" && journal.status === "posted"/);
 const doc=await readFile('src/components/documents/SourceDocumentPage.jsx','utf8');assert.doesNotMatch(doc,/localStorage|journal.*\/reverse/);assert.match(doc,/reversal_date:date/);
});

test('routed dependency graph reaches no browser-storage financial service',async()=>{
 const {resolve,dirname,extname}=await import('node:path');const {stat}=await import('node:fs/promises');const seen=new Set();
 async function visit(path){if(seen.has(path))return;seen.add(path);const source=await readFile(path,'utf8');if(source.includes('localStorage'))assert.ok(path.endsWith('/authStorage.js')||path.endsWith('/organisationCurrency.js'),path);
 for(const match of source.matchAll(/(?:from\s*|import\s*|import\()\s*['"]([^'"]+)['"]/g)){if(!match[1].startsWith('.'))continue;const base=resolve(dirname(path),match[1]);for(const candidate of [base,base+'.js',base+'.jsx',base+'/index.js']){if(!['.js','.jsx'].includes(extname(candidate)))continue;try{if((await stat(candidate)).isFile()){await visit(candidate);break;}}catch(error){if(!['ENOENT','ENOTDIR'].includes(error.code))throw error;}}}}
 await visit(resolve('src/main.jsx'));assert.ok(seen.size>50);
});

test('ledger presentation preserves exact supplied balances and includes each transaction',async()=>{
 const {ledgerDocumentRows}=await import('../src/utils/ledgerDocumentRows.js');
 const rows=ledgerDocumentRows([{account:{id:'private-id',code:'1100',name:'Receivables'},opening_balance:'9999999999999999.99',transactions:[{date:'2026-01-01',entry_number:'JE-1',description:'Service',debit:'0.01',credit:'0.00',running_balance:'10000000000000000.00'}],total_debit:'0.01',total_credit:'0.00',balance:'10000000000000000.00'}]);
 assert.equal(rows.length,3);assert.equal(rows[0].balance,'9999999999999999.99');assert.equal(rows[1].debit,'0.01');assert.equal(rows[2].balance,'10000000000000000.00');assert.ok(!JSON.stringify(rows).includes('private-id'));
});
