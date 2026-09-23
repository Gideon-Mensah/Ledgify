// Real local API + isolated browser context. Use a separately seeded disposable DB.
// Fixture JSON contains synthetic credentials; never point this at a customer environment.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const base=process.env.APP_URL||'http://127.0.0.1:5190', cdp=process.env.CDP_URL||'http://127.0.0.1:9343';
const out=process.env.STATEMENT_FIXTURES||'/tmp/ledgify-statement-browser';
for(const url of [base,cdp])assert.ok(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const fixture=JSON.parse(fs.readFileSync(out+'/fixture.json','utf8'));
async function connect(url){const ws=new WebSocket(url);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let id=0;const calls=new Map();let onEvent=()=>{};ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=calls.get(m.id);calls.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}else onEvent(m);};return {ws,send:(method,params={})=>new Promise((resolve,reject)=>{calls.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));}),events:fn=>onEvent=fn};}
const version=await(await fetch(cdp+'/json/version')).json(),browser=await connect(version.webSocketDebuggerUrl);
const {browserContextId}=await browser.send('Target.createBrowserContext');
const {targetId}=await browser.send('Target.createTarget',{url:'about:blank',browserContextId});
const page=await connect(`ws://${new URL(cdp).host}/devtools/page/${targetId}`),send=page.send;
const errors=[],results=[];
page.events(m=>{if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params.args.map(a=>a.value).join(' '));});
const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
const wait=async expression=>{for(let i=0;i<200;i++){if(await ev(expression))return;await new Promise(r=>setTimeout(r,50));}throw Error('Timeout: '+expression+'; '+await ev('document.body.innerText.slice(-1500)'));};
const click=async text=>{await ev(`(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!button||button.disabled)throw Error('Button unavailable: '+${JSON.stringify(text)});button.click();})()`);};
const select=async(selector,value)=>{await ev(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}));})()`);};
const idle=()=>wait('!document.querySelector(".statement-live")?.textContent');
const upload=async name=>{const {root}=await send('DOM.getDocument');const {nodeId}=await send('DOM.querySelector',{nodeId:root.nodeId,selector:'input[type=file]'});await send('DOM.setFileInputFiles',{nodeId,files:[out+'/'+name]});};
const snapshot=async name=>{await ev('document.activeElement?.blur();window.scrollTo(0,0)');const {data}=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(out+'/'+name+'.png',Buffer.from(data,'base64'));assert.ok(await ev('document.documentElement.scrollWidth<=innerWidth+1'),'Document overflow '+name);};
const newImport=async bank=>{await send('Page.navigate',{url:base+'/banking/import'});await wait(`[...document.querySelectorAll('#statement-bank option')].some(o=>o.value===${JSON.stringify(bank)})`);await idle();await select('#statement-bank',bank);};
try{
 await send('Page.enable');await send('Runtime.enable');await send('DOM.enable');await send('Network.enable');
 const storage={accessToken:fixture.accessToken,refreshToken:fixture.refreshToken,user:fixture.user,organisations:fixture.organisations,selectedOrganisation:fixture.selectedOrganisation,permissions:[]};
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`if(location.origin===${JSON.stringify(base)}&&!localStorage.getItem('ledgify.auth'))localStorage.setItem('ledgify.auth',${JSON.stringify(JSON.stringify(storage))})`});
 await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:out,browserContextId});
 for(const width of [1440,1024,768,390]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
  await newImport(fixture.banks[0].id);await snapshot(width+'-upload');
  await upload('statement.csv');
  await ev('document.querySelector("input[type=file]").focus()');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  assert.ok(await ev('document.activeElement.textContent.includes("Detect columns")'),'Keyboard reaches primary action');
  await click('Detect columns');await wait('Boolean(document.querySelector("#map-transaction_date"))');await idle();
  assert.equal(await ev('document.querySelector("#map-description").value'),'Narrative');
  await snapshot(width+'-mapping');await click('Validate and preview');await wait('Boolean(document.querySelector("#statement-filter"))');await idle();
  assert.match(await ev('document.querySelector(".statement-summary").innerText'),/7/);
  assert.match(await ev('document.querySelector(".statement-panel table").innerText'),/Date is ambiguous/);
  assert.match(await ev('document.querySelector(".statement-panel table").innerText'),/Currency USD does not match this GHS/);
  await snapshot(width+'-review');
  await select('#statement-filter','rejected');await idle();assert.equal(await ev('document.querySelectorAll(".statement-table-scroll tbody tr").length'),3);
  await click('Fix mapping');await wait('Boolean(document.querySelector("#statement-date"))');await select('#statement-date','%d/%m/%Y');await click('Validate and preview');await wait('Boolean(document.querySelector("#statement-filter"))');await idle();
  assert.match(await ev('document.querySelector(".statement-summary").innerText'),/2\nReady/);
  if(width===390){
   await click('Continue to import 2 transactions');assert.equal(await ev('[...document.querySelectorAll("button")].find(b=>b.textContent==="Import 2 transactions").disabled'),true);
   await ev('document.querySelector(".statement-confirm input").click()');await click('Import 2 transactions');await wait('document.body.innerText.includes("Bank statement imported")');await idle();
   await snapshot('390-success');
   assert.ok(await ev(`document.querySelector('a[href="/banking/reconciliation?bank_account=${fixture.banks[0].id}"]')!==null`));
   await ev(`document.querySelector('a[href="/banking/transactions?bank_account=${fixture.banks[0].id}"]').click()`);await wait('Boolean(document.querySelector(".bank-transactions-workspace"))');
   assert.ok(await ev(`[...document.querySelectorAll('select')].some(s=>s.value==='${fixture.banks[0].id}')`),'Transactions preserve selected bank');
   await send('Page.navigate',{url:base+'/banking/reconciliation?bank_account='+fixture.banks[0].id});
   await wait(`document.querySelector('h1')?.textContent==='Reconcile ${fixture.banks[0].name}'`);
   await wait('document.body.innerText.includes("Accra Business Solutions Ltd")');
   await snapshot('390-reconciliation');
  }
  results.push({width,upload:true,mapping:true,preview:true,filter:true,fixMapping:true,noPageOverflow:true});
 }
 await newImport(fixture.banks[0].id);await click('Download Ledgify CSV Template');await idle();
 for(let i=0;i<50&&!fs.existsSync(out+'/ledgify-bank-statement.csv');i++)await new Promise(r=>setTimeout(r,100));
 assert.equal(fs.readFileSync(out+'/ledgify-bank-statement.csv','utf8').replace(/^\ufeff/,'').trim(),fixture.schema.template_headers.join(','));
 await upload('large.csv');await click('Detect columns');await wait('Boolean(document.querySelector("#map-credit"))');await idle();await click('Validate and preview');await wait('Boolean(document.querySelector("#statement-filter"))');await idle();
 assert.equal(await ev('document.querySelectorAll(".statement-table-scroll tbody tr").length'),100);
 await click('Next');await idle();assert.match(await ev('document.querySelector(".statement-pagination").innerText'),/101–200 of 205/);await click('Next');await idle();assert.equal(await ev('document.querySelectorAll(".statement-table-scroll tbody tr").length'),5);await snapshot('390-large-page3');
 await select('#statement-bank',fixture.banks[1].id);assert.equal(await ev('document.querySelector("#statement-filter")'),null);
 await upload('amount.csv');await click('Detect columns');await wait('Boolean(document.querySelector("#statement-sign"))');await idle();
 assert.equal(await ev('document.querySelector("#statement-sign").value'),'');assert.equal(await ev('document.querySelector("#statement-sign").checkValidity()'),false);
 await select('#statement-sign','positive_in');await click('Validate and preview');await wait('Boolean(document.querySelector("#statement-filter"))');await idle();await click('Continue to import 2 transactions');await ev('document.querySelector(".statement-confirm input").click()');await click('Import 2 transactions');await wait('document.body.innerText.includes("Bank statement imported")');await idle();
 await click('Import another statement');await upload('statement.xlsx');await click('Detect columns');await wait('Boolean(document.querySelector("#map-transaction_type"))');await idle();await click('Validate and preview');await wait('Boolean(document.querySelector("#statement-filter"))');await idle();assert.match(await ev('document.querySelector(".statement-table-scroll").innerText'),/123.45/);
 // Switch organisations through the real application menu; scoped account state must reset.
 await ev('document.querySelector(".header-company-button").click()');await ev(`[...document.querySelectorAll('[role="menuitem"]')].find(el=>el.textContent.includes(${JSON.stringify(fixture.organisations[1].name)})).click()`);await wait('location.pathname==="/"');
 await newImport(fixture.banks[2].id);assert.equal(await ev('document.querySelector("#statement-filter")'),null);
 assert.ok(await ev('document.querySelector(".statement-account-details").innerText.includes("GBP")'));
 assert.ok(!(await ev('document.querySelector("#statement-bank").innerText')).includes('GHS'));
 await snapshot('390-organisation-gbp');
 assert.deepEqual(errors,[]);
 const report={results,realBackend:true,templateDownload:true,pagination205Rows:true,signedAmountChoice:true,xlsxPreview:true,reconciliationNavigation:true,keyboardUploadAction:true,accountSwitchClearsPreview:true,organisationIsolation:true,consoleErrors:errors,screenshotCount:fs.readdirSync(out).filter(f=>f.endsWith('.png')).length};
 fs.writeFileSync(out+'/results.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.send('Target.disposeBrowserContext',{browserContextId});page.ws.close();browser.ws.close();}
