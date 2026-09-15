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
 for(const report of ['trial-balance','profit-and-loss','balance-sheet','cash-flow','general-ledger','aged-receivables','aged-payables','tax','bank','account']){
  let path='/accounting/'+report;
  if(report==='tax')path='/tax/vat-returns';
  if(report==='bank')path='/banking/reconciliation';
  if(report==='account'){
    await navigate('/accounting/trial-balance?as_of_date=2026-12-31');
    await wait(`Array.from(document.links).some(a=>a.pathname.startsWith('/accounting/accounts/'))`);
    path=await evaluate(`Array.from(document.links).find(a=>a.pathname.startsWith('/accounting/accounts/')).pathname`);
  }
  await navigate(path+'?start_date=2026-01-01&end_date=2026-12-31&as_of_date=2026-12-31');
  await wait('Boolean(document.querySelector(".report-export-trigger:not(:disabled)"))');
  await evaluate(`new MutationObserver(()=>{const f=document.querySelector('iframe[title="Print document"]');if(f)f.contentWindow.print=()=>{window.__printInvoked=true;};}).observe(document.body,{childList:true});document.querySelector('.report-export-trigger').click()`);
  await evaluate('Array.from(document.querySelectorAll("[role=menuitem]")).find(b=>b.textContent==="Print").click()');
  await wait('window.__printInvoked===true');
  const html=await evaluate(`document.querySelector('iframe[title="Print document"]').contentDocument.documentElement.outerHTML`);assert.ok(html.includes(fixture.fixtures[0].organisation.name));assert.ok(!html.includes('[object Object]'));assert.ok(!/account_class|organisation_id|&quot;id&quot;/.test(html));
  if(['trial-balance','profit-and-loss','balance-sheet','cash-flow','tax'].includes(report)){
   const originalText=await evaluate(`document.querySelector('iframe').contentDocument.body.innerText`);
   await evaluate(`document.querySelector('iframe').remove();window.__printInvoked=false;Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Print'&&!b.hasAttribute('role')).click()`);
   await wait('window.__printInvoked===true');
   assert.equal(await evaluate(`document.querySelector('iframe').contentDocument.body.innerText`),originalText);
   results.push({check:(mobile?'390px ':'Desktop ')+report+' direct Print matches export Print',result:'PASS'});
  }
  const tree=await send('Page.getFrameTree');await send('Page.setDocumentContent',{frameId:tree.frameTree.frame.id,html});
  const p=await send('Page.printToPDF',{printBackground:false,preferCSSPageSize:true});fs.writeFileSync(out+(mobile?'mobile':'desktop')+'-report-'+report+'.pdf',Buffer.from(p.data,'base64'));results.push({check:(mobile?'390px ':'Desktop ')+report+' actual print document',result:'PASS'});
 }
}
fs.writeFileSync(out+'print-browser-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));ws.close();
