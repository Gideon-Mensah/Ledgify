// Run after verify-tax-workflows.mjs against the same disposable fixtures.
// Run only with disposable seeded data and an in-memory Django email backend.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const base=process.env.DOCUMENT_APP_URL||'http://127.0.0.1:5184';
const cdp=process.env.DOCUMENT_CDP_URL||'http://127.0.0.1:9343';
for(const url of [base,cdp])assert.ok(['127.0.0.1','localhost'].includes(new URL(url).hostname),'Use disposable local services only.');
const fixture=JSON.parse(fs.readFileSync(process.env.DOCUMENT_FIXTURE_FILE||'/tmp/ledgify-tax-browser-fixture.json','utf8'));
const tabs=await(await fetch(cdp+'/json')).json();const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
let id=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}};
const send=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
const wait=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out: '+expression+'\n'+await evaluate('document.body.innerText.slice(0,1800)'));};
await send('Page.enable');await send('Runtime.enable');await send('Page.navigate',{url:base});await wait(`location.origin === ${JSON.stringify(base)}`);
const auth={accessToken:fixture.accessToken,refreshToken:fixture.refreshToken,selectedOrganisation:fixture.fixtures[0].organisation,organisations:fixture.fixtures.map(x=>x.organisation),permissions:[]};
await evaluate(`localStorage.setItem('ledgify.auth',${JSON.stringify(JSON.stringify(auth))})`);
const out=(process.env.DOCUMENT_ARTIFACT_DIR||'/tmp/ledgify-tax-artifacts').replace(/\/$/,'')+'/';fs.mkdirSync(out,{recursive:true});let results=[];
async function navigate(path){await send('Page.navigate',{url:base+path});}
async function click(text){await wait(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled)`);await evaluate(`{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b||b.disabled)throw Error('Unavailable button: '+${JSON.stringify(text)});b.click();}`);}
async function setField(label,value){await evaluate(`{const label=Array.from((document.querySelector('[role=dialog]')||document).querySelectorAll('label')).find(l=>l.childNodes[0]?.textContent.trim()===${JSON.stringify(label)});if(!label)throw Error('Missing label: '+${JSON.stringify(label)});const el=label.querySelector('input,select,textarea');const proto=el instanceof HTMLSelectElement?HTMLSelectElement.prototype:el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}`);}
async function valid(check){assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'Overflow: '+check);assert.equal(await evaluate('Boolean(document.querySelector(".tax-inline-error"))'),false,'Tax error: '+check);results.push({check,result:'PASS'});}
await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:out});
await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
await navigate('/tax/settings');await wait('document.body.innerText.includes("Current and scheduled profiles")');await click('Returns');await wait('/VAT · revision 1 · (REVIEWED|APPROVED|FILED)/.test(document.body.innerText)');
if(await evaluate('document.body.innerText.includes("VAT · revision 1 · REVIEWED")')){
await click('Download readable workpaper PDF');await wait('document.body.innerText.includes("Saved by the tax service")');
await click('Approve and lock snapshot');await setField('Reason','Synthetic approval through browser');await click('Confirm');await wait('document.body.innerText.includes("VAT · revision 1 · APPROVED")');
}
if(await evaluate('document.body.innerText.includes("VAT · revision 1 · APPROVED")')){
await click('Record actual filing acknowledgement');await setField('Reason','Synthetic manual filing confirmation');await setField('Actual filing acknowledgement','BROWSER-TEST-ACK');await click('Confirm');await wait('document.body.innerText.includes("VAT · revision 1 · FILED")');}
await valid('390px return approval and manual filing acknowledgement');
await evaluate('Array.from(document.querySelectorAll("summary")).find(e=>e.textContent==="Upload private filing evidence").click()');await setField('Actual acknowledgement','BROWSER-TEST-ACK');
const doc=await send('DOM.getDocument');const input=await send('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'input[type=file]'});await send('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[out+'ghana-tax-invoice.pdf']});await click('Upload evidence');await wait('document.body.innerText.includes("Filing acknowledgements and evidence")');await valid('Private PDF filing evidence upload');
await evaluate('Array.from(document.querySelectorAll("summary")).find(e=>e.textContent==="Record tax payment").click()');await setField('Payment date','2026-03-01');await setField('Signed bank amount (negative for refund)','200');await setField('Payment reference','BROWSER-TEST-REMITTANCE');await setField('Bank account',fixture.fixtures[0].bank);
const labels=await evaluate('Array.from(document.querySelectorAll("label")).filter(l=>l.textContent.includes("Remaining signed balance")).map(l=>({label:l.childNodes[0].textContent.trim(),amount:l.textContent.split("Remaining signed balance " )[1]}))');for(const {label,amount} of labels)await setField(label,amount);
await click('Record confirmed payment / refund');await wait('document.body.innerText.includes("VAT · revision 1 · PAID")');await valid('Reviewed control allocations settle filed return');
await evaluate('Array.from(document.querySelectorAll("summary")).find(e=>e.textContent==="Recorded payments and refunds").click()');await click('Correct recorded payment');await setField('Reversal date','2026-03-02');await setField('Correction reason','Synthetic recorded bank payment correction');await evaluate('Array.from(document.querySelectorAll("label")).find(l=>l.textContent.includes("I confirm reversal of this recorded payment")).querySelector("input").click()');await click('Reverse confirmed tax payment');await wait('document.body.innerText.includes("VAT · revision 1 · FILED")');await valid('390px audited remittance reversal restores filed/unsettled state');
await click('Prepare amendment');await setField('Reason','Synthetic amendment review');await click('Confirm');await wait('document.body.innerText.includes("VAT · revision 2 · DRAFT")');await valid('Separate amendment draft preserves original return');
const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(out+'mobile-return-settlement.png',Buffer.from(shot.data,'base64'));
fs.writeFileSync(out+'settlement-browser-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));ws.close();
