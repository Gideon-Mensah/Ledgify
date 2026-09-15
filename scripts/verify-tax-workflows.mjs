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
for(const mobile of [false,true]){
 await send('Emulation.setDeviceMetricsOverride',{width:mobile?390:1440,height:mobile?844:1100,deviceScaleFactor:1,mobile});
 await navigate('/tax/settings');await wait('document.body.innerText.includes("Current and scheduled profiles")');
 for(const tab of ['Profile','Dashboard','Codes & versions','Returns','History']){
  await click(tab);await new Promise(r=>setTimeout(r,150));await valid((mobile?'390px ':'Desktop ')+tab);
  const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(out+(mobile?'mobile-':'desktop-')+tab.replaceAll(' ','-')+'.png',Buffer.from(shot.data,'base64'));
 }
}
await click('Codes & versions');
const preset=await evaluate('Array.from(document.querySelectorAll("label")).find(l=>l.textContent.startsWith("Verified preset")).querySelector("select").options[1].value');
await setField('Verified preset',preset);await setField('Existing statutory code',fixture.fixtures[0].code);await setField('Adopt from','2027-01-01');await click('Review preset adoption');await wait('document.body.innerText.includes("Current and published structures")');await valid('390px authoritative preset comparison');
await click('Contact accountant');await wait('document.body.innerText.includes("Contact your accountant through your usual channel")');
await setField('Code',fixture.fixtures[0].code);await click('Create new version');await setField('Effective from','2027-01-01');await setField('Official source/reference','Synthetic browser verification only');await setField('Reason / transition note','Synthetic prospective change review');await setField('rate','16');await click('Compare calculations on 1,000');await wait('document.body.innerText.includes("1210.00")');await valid('390px future-version old/new calculation');await click('Save version for approval');await wait('document.body.innerText.includes("New version saved")');await valid('Future override saved as unactivated draft');
await click('Returns');await setField('Period start','2026-02-01');await setField('Period end','2026-02-28');await click('Preview VAT workpaper');await wait('document.body.innerText.includes("Reconciled")');await valid('390px VAT workpaper preview');
await click('Create this tax period');await wait('Array.from(document.querySelectorAll("button")).some(b=>b.textContent==="Prepare draft"&&!b.disabled)');await click('Prepare draft');await wait('document.body.innerText.includes("VAT · revision 1 · DRAFT")');await click('Review return');await setField('Reason','Synthetic browser workpaper review');await click('Confirm');await wait('document.body.innerText.includes("VAT · revision 1 · REVIEWED")');await valid('Return preparation and review through rendered controls');
await navigate('/sales/invoices/new');await wait('document.body.innerText.includes("Document lines")');
await setField('Number','BROWSER-TAX-'+Date.now());await setField('Customer',fixture.fixtures[0].customer);await setField('Description','Browser-reviewed Ghana supply');await setField('Unit price','1000');await setField('Account',fixture.fixtures[0].revenue);await setField('Confirm tax classification',fixture.fixtures[0].code);await click('Calculate tax preview');await wait('document.body.innerText.includes("1200.00")');await valid('Mobile invoice authoritative common-base preview');await click('Save draft');await wait('Boolean(document.querySelector(".trusted-document"))');await valid('Mobile invoice draft save');
await navigate('/sales/invoices/'+fixture.fixtures[0].invoice);await wait('Boolean(document.querySelector(".trusted-document"))');
const pdf=await send('Page.printToPDF',{printBackground:false,preferCSSPageSize:true});fs.writeFileSync(out+'ghana-tax-invoice.pdf',Buffer.from(pdf.data,'base64'));await valid('Posted invoice print layout');
await click('Email');await wait('Boolean(document.querySelector("[role=dialog] input[type=email]"))');await evaluate('document.querySelector("[role=dialog] form").requestSubmit()');await wait('document.body.innerText.includes("Accepted for delivery")');results.push({check:'Tax invoice email accepted by local in-memory backend',result:'PASS'});
await evaluate(`{const a=JSON.parse(localStorage.getItem('ledgify.auth'));a.selectedOrganisation=${JSON.stringify(fixture.fixtures[1].organisation)};localStorage.setItem('ledgify.auth',JSON.stringify(a));}`);
await navigate('/tax/settings');await wait('document.body.innerText.includes("Bristol tax browser")');assert.equal(await evaluate('/Ghana|GRA|E-VAT/.test(document.querySelector(".jurisdiction-tax").innerText)'),false);results.push({check:'International profile has no Ghana/GRA branding',result:'PASS'});
await navigate('/ai');await new Promise(r=>setTimeout(r,400));assert.equal(await evaluate('Boolean(document.querySelector(".ai-assistant-page"))'),false);results.push({check:'Unfinished AI inaccessible through direct route',result:'PASS'});
fs.writeFileSync(out+'browser-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));ws.close();
