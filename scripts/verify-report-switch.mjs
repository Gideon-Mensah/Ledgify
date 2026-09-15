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
 for(const index of [1,0]){
  await navigate('/accounting/trial-balance?as_of_date=2026-12-31');await wait(`Boolean(document.querySelector('.header-company-button'))`);
  await evaluate(`document.querySelector('.header-company-button').click()`);
  const name=fixture.fixtures[index].organisation.name;
  await wait(`Array.from(document.querySelectorAll('.header-organisation-panel button')).some(b=>b.innerText.includes(${JSON.stringify(name)}))`);
  await evaluate(`Array.from(document.querySelectorAll('.header-organisation-panel button')).find(b=>b.innerText.includes(${JSON.stringify(name)})).click()`);
  await wait(`document.querySelector('.header-company-button').textContent.includes(${JSON.stringify(name)})`);
  await navigate('/accounting/trial-balance?as_of_date=2026-12-31');await wait(`Boolean(document.querySelector('.report-export-trigger:not(:disabled)'))`);
  await evaluate(`new MutationObserver(()=>{const f=document.querySelector('iframe');if(f)f.contentWindow.print=()=>{window.__printInvoked=true;};}).observe(document.body,{childList:true});document.querySelector('.report-export-trigger').click()`);
  await evaluate(`Array.from(document.querySelectorAll('[role=menuitem]')).find(b=>b.textContent==='Print').click()`);await wait('window.__printInvoked');
  const content=await evaluate(`document.querySelector('iframe').contentDocument.body.innerText`);
  assert.ok(content.includes(name));assert.ok(!content.includes(fixture.fixtures[1-index].organisation.name));assert.ok(content.includes(fixture.fixtures[index].organisation.base_currency));
  const html=await evaluate(`document.querySelector('iframe').contentDocument.documentElement.outerHTML`);const tree=await send('Page.getFrameTree');await send('Page.setDocumentContent',{frameId:tree.frameTree.frame.id,html});
  const p=await send('Page.printToPDF',{printBackground:false,preferCSSPageSize:true});fs.writeFileSync(out+`switch-${mobile?'mobile':'desktop'}-${index}.pdf`,Buffer.from(p.data,'base64'));
  results.push({check:`${mobile?'390px':'Desktop'} UI organisation switch ${index}`,result:'PASS'});
 }
}
fs.writeFileSync(out+'switch-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));ws.close();
