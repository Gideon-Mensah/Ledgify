import fs from 'node:fs';
import assert from 'node:assert/strict';
// Run against a local Vite server and an isolated Chrome debugging profile.
// Every application API request is intercepted with synthetic fixtures.
const tabs=await (await fetch('http://127.0.0.1:9334/json')).json();
const ws=new WebSocket(tabs[0].webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
let id=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result)}};
const send=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))});
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
const fixture = () => {
 const orgs=['GHS','GBP','USD','EUR','CAD','BHD','XYZ'].map(code=>({id:code,name:`Currency Test ${code}`,base_currency:code,locale:'en-GB',country_code:code==='GHS'?'GH':'GB',role:'owner',timezone:'Europe/London',financial_year_start_month:1}));
 const chosen=orgs.find(o=>o.id===new URL(location.href).searchParams.get('testCurrency'))||orgs[0];
 localStorage.setItem('ledgify.auth',JSON.stringify({accessToken:'isolated-test',refreshToken:null,user:{id:1,email:'test@example.invalid',first_name:'Test'},organisations:orgs,selectedOrganisation:chosen,permissions:[]}));
 const originalFetch=window.fetch;window.fetch=async(input,options={})=>{
  const url=new URL(typeof input==='string'?input:input.url,location.href);
  if(!url.pathname.includes('/api/v1/'))return originalFetch(input,options);
  const p=url.pathname.split('/api/v1/')[1];const code=options.headers?.['X-Organisation-ID']||JSON.parse(localStorage.getItem('ledgify.auth')).selectedOrganisation.id;
  const account={id:'account',code:'4000',name:'Test Account',account_type:'revenue',account_class:'sales',normal_balance:'credit',currency:code,status:'active'};
  const contact={id:'contact',name:'Test Contact',currency:code,email:'test@example.invalid',account_number:'C1',status:'active',is_customer:true,is_supplier:true,payment_terms:'30 days'};
  const line={id:'line',description:'Currency test',quantity:'1',unit_price:'1000.00',discount_amount:'0.00',tax_rate:'0',tax_amount:'0.00',line_total:'1000.00',revenue_account:account,expense_account:account};
  const doc={id:'document',invoice_number:`INV-${code}`,bill_number:`BILL-${code}`,customer:contact,supplier:contact,issue_date:'2026-09-01',due_date:'2026-09-30',currency:new URL(location.href).searchParams.get('transactionCurrency')||'',subtotal:'1000.00',tax_total:'0.00',total:'1000.00',amount_paid:'0.00',amount_due:'1000.00',amount_credited:'0.00',status:'draft',lines:[line],payments:[]};
  const totals={income:[],expenses:[],assets:[],liabilities:[],equity:[],operating:[],investing:[],financing:[],unclassified:[],rows:[],total_income:1000,total_expenses:0,net_profit:1000,total_assets:1000,total_liabilities:0,total_equity:1000,total_liabilities_and_equity:1000,total_debit:1000,total_credit:1000,total_operating:1000,total_investing:0,total_financing:0,total_unclassified:0,net_cash_flow:1000,opening_cash:0,closing_cash:1000,difference:0,balanced:true,currency:code};
  let data=[];
  if(p==='auth/me/')data={id:1,email:'test@example.invalid',first_name:'Test'};
  else if(p==='organisations/')data=orgs;
  else if(p.includes('my-permissions'))data={permissions:['view_accounting','view_sales','view_purchases','view_banking','view_reports','manage_invoices','manage_bills','manage_opening_balances','view_opening_balances','view_journals','create_journals']};
  else if(/^invoices\/$|^bills\/$/.test(p))data=[doc];
  else if(/^invoices\/document\/$|^bills\/document\/$/.test(p))data=doc;
  else if(p.startsWith('contacts'))data=p==='contacts/'?[contact]:contact;
  else if(p.includes('currencies'))data=orgs.map(o=>({code:o.id,name:o.id}));
  else if(p==='accounts/')data=[account];
  else if(p==='bank-accounts/')data=[{...account,id:'bank',name:'Test Bank',ledger_account:account,book_balance:'1000.00',statement_balance:'1000.00',opening_balance:'0.00',reconciliation_difference:'0.00',unreconciled_count:0}];
  else if(p.startsWith('reports/general-ledger'))data=[{account,total_debit:1000,total_credit:0,balance:1000,transactions:[]}];
  else if(p.startsWith('reports/'))data=totals;
  else if(p.startsWith('finance/'))data={opening_balance:1000,closing_balance:2000,total_outstanding:1000,buckets:{current:1000},transactions:[{date:'2026-09-01',debit:1000,credit:0,running_balance:2000}]};
  else if(p==='journals/')data=[{id:'journal',entry_number:'JE-1',date:'2026-09-01',status:'posted',description:'Currency regression',organisation:{base_currency:code},lines:[{id:'debit',account,debit:1000,credit:0},{id:'credit',account,debit:0,credit:1000}]}];
  else if(p.includes('journals/register'))data={results:[{id:'journal',entry_number:'JE-1',date:'2026-09-01',status:'posted',description:'Currency regression',lines:[{id:'debit',account,debit:1000,credit:0},{id:'credit',account,debit:0,credit:1000}]}],count:1,totals:{debit:1000,credit:1000},ledger_totals:{debit:1000,credit:1000},facets:{sources:[],accounts:[]}};
  else if(p==='opening-balances/')data=[{id:'opening',status:'draft',opening_date:'2026-09-01',reference:'OPENING',description:'Test',lines:[{account,debit:1000,credit:0}]}];
  return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
 };
};
await send('Page.enable');await send('Runtime.enable');
await send('Page.addScriptToEvaluateOnNewDocument',{source:`(${fixture})()`});
const routes=['/','/sales/invoices','/sales/invoices/new','/sales/invoices/document','/purchases/bills','/purchases/bills/new','/purchases/bills/document','/banking/accounts','/accounting/journals','/accounting/opening-balances','/accounting/general-ledger','/accounting/trial-balance','/accounting/profit-and-loss','/accounting/balance-sheet','/accounting/cash-flow','/contacts/customers/contact/statement','/purchases/suppliers/contact/statement'];
const results=[];
for(const code of ['GHS','GBP','USD','EUR'])for(const route of routes){
 await send('Page.navigate',{url:`http://127.0.0.1:5173${route}?testCurrency=${code}`});
 await new Promise(r=>setTimeout(r,350));
 let body=await evaluate('document.body.innerText');
 for(let i=0;i<15&&(!body||/Loading your session|Loading…/.test(body));i++){await new Promise(r=>setTimeout(r,100));body=await evaluate('document.body.innerText')}
 const main=await evaluate('document.querySelector("main")?.innerText || document.body.innerText');
 results.push({code,route,pound:main.includes('£'),money:/1,000/.test(main),error:/Something went wrong|Unexpected error/.test(main),text:main.slice(-900)});
 if(code!=='GBP')assert.ok(!main.includes('£'),`${code} ${route} displayed pounds`);
 assert.ok(!/Something went wrong|Unexpected error/.test(main), `${code} ${route} crashed`);
 if(route.endsWith('/new')) { const selected = await evaluate(`[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value==='GBP'))?.value`); assert.equal(selected, code); }
 if(route.endsWith('/document') || /accounting\/(trial-balance|profit-and-loss|balance-sheet|cash-flow)$/.test(route)) { await send('Emulation.setEmulatedMedia',{media:'print'}); const printed = await evaluate('document.querySelector("main").innerText'); if(code!=='GBP')assert.ok(!printed.includes('£')); await send('Emulation.setEmulatedMedia',{media:''}); }
}
fs.writeFileSync('/tmp/ledgify-browser-results.json',JSON.stringify(results,null,2));
console.log(JSON.stringify(results.map(({text,...r})=>r),null,2));
await send('Page.navigate',{url:'http://127.0.0.1:5173/sales/invoices?testCurrency=GHS'});await new Promise(r=>setTimeout(r,500));
await evaluate('document.querySelector(".header-company-button").click()');
await evaluate('[...document.querySelectorAll("[role=menuitem]")].find(x=>x.innerText.includes("Currency Test USD")).click()');
await new Promise(r=>setTimeout(r,500));
const switched=await evaluate('document.querySelector("main").innerText');assert.ok(switched.includes('USD')||switched.includes('US$')||switched.includes('$'));assert.ok(!switched.includes('INV-GHS'));
console.log('Organisation switch: PASS');
await send('Page.navigate',{url:'http://127.0.0.1:5173/sales/invoices/document?testCurrency=GHS&transactionCurrency=GBP'});
await new Promise(r=>setTimeout(r,600));
assert.ok((await evaluate('document.querySelector("main").innerText')).includes('£1,000.00'));
console.log('Explicit GBP invoice in GHS organisation: PASS');
for(const code of ['CAD','BHD','XYZ']) {
 await send('Page.navigate',{url:`http://127.0.0.1:5173/sales/invoices/new?testCurrency=${code}`}); await new Promise(r=>setTimeout(r,600));
 assert.equal(await evaluate('document.querySelector("select[name=currency]").value'), code);
 assert.ok(!(await evaluate('document.querySelector("main").innerText')).includes('£'));
}
console.log('Unlisted and invalid currency form selections: PASS');
ws.close();
