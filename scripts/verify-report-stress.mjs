// Run only with disposable seeded data and an in-memory Django email backend.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const base=process.env.DOCUMENT_APP_URL||'http://127.0.0.1:5183';
const cdp=process.env.DOCUMENT_CDP_URL||'http://127.0.0.1:9343';
for(const url of [base,cdp])assert.ok(['127.0.0.1','localhost'].includes(new URL(url).hostname),'Use disposable local services only.');
const fixture=JSON.parse(fs.readFileSync(process.env.DOCUMENT_FIXTURE_FILE||'/tmp/ledgify-phase3-browser-fixture.json','utf8'));
const tabs=await(await fetch(cdp+'/json')).json();const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
let id=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}};
const send=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
const wait=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out: '+expression+'\n'+await evaluate('document.body.innerText.slice(0,1800)'));};
await send('Page.enable');await send('Runtime.enable');await send('Page.navigate',{url:base});await wait(`location.origin === ${JSON.stringify(base)}`);
const auth={accessToken:fixture.accessToken,refreshToken:fixture.refreshToken,selectedOrganisation:fixture.fixtures[0].organisation,organisations:fixture.fixtures.map(x=>x.organisation),permissions:[]};
await evaluate(`localStorage.setItem('ledgify.auth',${JSON.stringify(JSON.stringify(auth))})`);
const out=(process.env.DOCUMENT_ARTIFACT_DIR||'/tmp/ledgify-phase3-artifacts').replace(/\/$/,'')+'/';fs.mkdirSync(out,{recursive:true});let results=[];
async function navigate(path){await send('Page.navigate',{url:base+path});}
async function invoiceReady(){await wait('Boolean(document.querySelector(".trusted-document"))');assert.equal(await evaluate('document.body.innerText.includes("Accounting Cloud Ltd")'),false);}
async function pdf(name){await send('Emulation.setEmulatedMedia',{media:'print'});const invisible=await evaluate('getComputedStyle(document.querySelector(".trusted-document")).visibility');assert.equal(invisible,'visible');const p=await send('Page.printToPDF',{printBackground:false,preferCSSPageSize:true});fs.writeFileSync(out+name+'.pdf',Buffer.from(p.data,'base64'));await send('Emulation.setEmulatedMedia',{media:''});}

await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:out});
const account={id:'8cb42a5b-f38a-4532-91aa-ef0ad03d3667',code:'1100',name:'Long customer account name with wrapping and international operations',account_type:'asset',metadata:{private:true}};
const samples=[
 ['large-trial','Trial Balance',[...Array.from({length:100},(_,i)=>({account:{...account,code:String(1100+i)},debit:'1000.10',credit:'0.00',net_balance:'1000.10'})),{section:'Totals',total_debit:'100010.00',total_credit:'0.00',difference:'100010.00'}]],
 ['comparative-pnl','Profit and Loss',[{section:'income',account,amount:'1000.00',comparative_amount:'900.00'},{section:'Totals',total_income:'1000.00',total_expenses:'0.00',net_profit:'1000.00'}]],
 ['mixed-aging','Aged Receivables',[{customer:{id:account.id,name:'International customer'},buckets:{current:'1200.00'},total_outstanding:'1200.00',invoices:[{invoice_number:'INV-GBP',currency:'GBP',amount_due:'100.00',base_amount_due:'1200.00'}]},{section:'Totals',buckets:{current:'1200.00'},total_outstanding:'1200.00'}]],
];
for(const [name,title,rows] of samples){
 await navigate('/accounting/trial-balance');await wait(`Boolean(document.querySelector('.report-export-trigger'))`);
 const metadata={currency:name==='comparative-pnl'?'GBP':'GHS',organisation:'Synthetic report inspection',identity:{name:'Synthetic report inspection',address:['Synthetic address']},base_currency:'GHS',transaction_currency:name==='mixed-aging'?'GBP':undefined};
 await evaluate(`window.__printInvoked=false;new MutationObserver(()=>{const f=document.querySelector('iframe');if(f)f.contentWindow.print=()=>{window.__printInvoked=true;};}).observe(document.body,{childList:true});`);
 await evaluate(`(async()=>{const {printReport}=await import('/src/utils/printReport.js');await printReport(${JSON.stringify(rows)},${JSON.stringify(title)},${JSON.stringify(metadata)});})()`);
 await wait('window.__printInvoked');
 const content=await evaluate(`document.querySelector('iframe').contentDocument.body.innerText`);
 assert.ok(!content.includes(account.id));assert.ok(!content.includes('[object Object]'));assert.ok(!content.includes('private'));
 const fits=await evaluate(`Array.from(document.querySelector('iframe').contentDocument.querySelectorAll('td')).every(td=>td.scrollWidth<=td.clientWidth+1)`);assert.ok(fits,name+' cell overflow');
 const html=await evaluate(`document.querySelector('iframe').contentDocument.documentElement.outerHTML`);
 await evaluate(`(async()=>{const {exportReport}=await import('/src/utils/reportExport.js');exportReport(${JSON.stringify(rows)},'pdf',${JSON.stringify(title)},${JSON.stringify(metadata)});})()`);
 await new Promise(r=>setTimeout(r,500));
 const tree=await send('Page.getFrameTree');await send('Page.setDocumentContent',{frameId:tree.frameTree.frame.id,html});
 const p=await send('Page.printToPDF',{printBackground:false,preferCSSPageSize:true});fs.writeFileSync(out+name+'-print.pdf',Buffer.from(p.data,'base64'));
 results.push({check:name,result:'PASS'});
}
fs.writeFileSync(out+'stress-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));ws.close();
