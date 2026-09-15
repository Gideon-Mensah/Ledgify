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
for(const mobile of [false,true]){
 await send('Emulation.setDeviceMetricsOverride',{width:mobile?390:1440,height:mobile?844:1100,deviceScaleFactor:1,mobile});
 await navigate('/sales/invoices/'+fixture.fixtures[0].invoice);await invoiceReady();
 const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(out+(mobile?'mobile':'desktop')+'.png',Buffer.from(shot.data,'base64'));
 assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth'),true);
 await pdf(mobile?'invoice-mobile':'invoice-desktop');results.push({check:mobile?'390px invoice':'desktop invoice',result:'PASS'});
}
// SPA navigation loads other modules without discarding their imported print CSS.
for(const path of ['/accounting/journals','/accounting/profit-and-loss','/banking/accounts']){
 await evaluate(`history.pushState({},'',${JSON.stringify(path)});dispatchEvent(new PopStateEvent('popstate'));`);await new Promise(r=>setTimeout(r,500));
 await evaluate(`history.pushState({},'','/sales/invoices/${fixture.fixtures[0].invoice}');dispatchEvent(new PopStateEvent('popstate'));`);await invoiceReady();await pdf('after-'+path.split('/').pop());results.push({check:'Print after '+path,result:'PASS'});
}
await navigate('/documents/customer-statement/'+fixture.fixtures[0].customer+'?end_date=2026-01-31');await invoiceReady();await pdf('statement');
// Genuine backend email request through the rendered modal; no external transport.
await navigate('/sales/invoices/'+fixture.fixtures[0].invoice);await invoiceReady();
await evaluate(`Array.from(document.querySelectorAll('button')).find(x=>x.textContent==='Email').click()`);await wait('Boolean(document.querySelector("[role=dialog] input[type=email]"))');
await evaluate(`document.querySelector('[role=dialog] form').requestSubmit()`);await wait('document.body.innerText.includes("Accepted for delivery")');results.push({check:'Email accepted by local in-memory backend',result:'PASS'});
// Switching stored selection and reloading exercises bootstrap scope and prevents cached identity leakage.
await evaluate(`{const a=JSON.parse(localStorage.getItem('ledgify.auth'));a.selectedOrganisation=${JSON.stringify(fixture.fixtures[1].organisation)};localStorage.setItem('ledgify.auth',JSON.stringify(a));}`);
await navigate('/sales/invoices/'+fixture.fixtures[1].invoice);await invoiceReady();assert.equal(await evaluate('document.querySelector(".trusted-document").innerText.includes("Accra Community")'),false);await pdf('gbp-invoice');results.push({check:'Organisation switch GHS to GBP identity',result:'PASS'});
await navigate('/accounting/consolidation');await wait('!location.pathname.includes("consolidation")');await navigate('/ai');await new Promise(r=>setTimeout(r,500));assert.equal(await evaluate('Boolean(document.querySelector(".ai-assistant-page"))'),false);
fs.writeFileSync(out+'browser-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));ws.close();
