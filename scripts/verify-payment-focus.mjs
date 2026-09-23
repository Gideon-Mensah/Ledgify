// Synthetic API responses only: no payment is posted to a real backend.
import assert from 'node:assert/strict';
const base=process.env.APP_URL||'http://127.0.0.1:5187',cdp=process.env.CDP_URL||'http://127.0.0.1:9343';
for(const url of [base,cdp])assert.ok(['localhost','127.0.0.1'].includes(new URL(url).hostname));
async function connect(url){const ws=new WebSocket(url);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let id=0;const calls=new Map();let onEvent=()=>{};ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=calls.get(m.id);calls.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}else onEvent(m);};return {ws,send:(method,params={})=>new Promise((resolve,reject)=>{calls.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));}),events:fn=>onEvent=fn};}
const version=await(await fetch(cdp+'/json/version')).json(),browser=await connect(version.webSocketDebuggerUrl);const {browserContextId}=await browser.send('Target.createBrowserContext');const {targetId}=await browser.send('Target.createTarget',{url:'about:blank',browserContextId});const page=await connect(`ws://${new URL(cdp).host}/devtools/page/${targetId}`);const send=page.send;
const org={id:'focus-org',name:'Focus test organisation',base_currency:'GHS',role:'owner'}, user={id:'focus-user',email:'focus@example.test',is_email_verified:true};
const permissions=['view_sales','create_invoice','create_customer_payment','export_reports'];
const payments=[],errors=[];let releasePayment;let receivedPayment;
const invoice={id:'focus-invoice',invoice_number:'ABS-PO-001',status:'approved',customer:{id:'focus-customer',name:'Accra Business Solutions Ltd',email:'customer@example.test'},currency:'GHS',issue_date:'2026-09-22',due_date:'2026-10-22',subtotal:'5000.00',tax_total:'0.00',total:'5000.00',amount_due:'5000.00',amount_paid:'0.00',amount_credited:'0.00',lines:[]};
const contract={kind:'invoice',version:'synthetic',title:'Invoice',number:invoice.invoice_number,status:'approved',currency:'GHS',currency_basis:'transaction',date:invoice.issue_date,due_date:invoice.due_date,organisation:{...org,address:[]},party:{name:invoice.customer.name,address:[]},rows:[['Office supplies','10','500','0','0','5000']],totals:[['Total','5000'],['Amount due','5000']]};
page.events(async m=>{
 if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);
 if(m.method==='Fetch.requestPaused'){
  const {requestId,request}=m.params;const path=new URL(request.url).pathname.split('/api/v1/')[1];let data=[];
  if(path==='auth/me/')data=user;else if(path==='organisations/')data=[org];else if(path?.endsWith('/my-permissions/'))data={permissions};
  else if(path==='invoices/focus-invoice/')data=invoice;else if(path==='documents/invoice/focus-invoice/')data=contract;
  else if(path==='accounts/')data=[{id:'bank',code:'1000',name:'Bank Current Account',account_type:'asset',account_class:'bank',status:'active',currency:'GHS'}];
  else if(path==='customer-payments/'&&request.method==='POST'){receivedPayment=JSON.parse(request.postData);payments.push(receivedPayment);await new Promise(resolve=>{releasePayment=resolve;});data={id:'test-payment',...receivedPayment};}
  await send('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:base},{name:'Access-Control-Allow-Headers',value:'*'},{name:'Access-Control-Allow-Methods',value:'GET,POST,OPTIONS'}],body:Buffer.from(JSON.stringify(data)).toString('base64')});
 }
});
const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
const wait=async expr=>{for(let i=0;i<100;i++){if(await ev(expr))return;await new Promise(r=>setTimeout(r,50));}throw Error('Timeout '+expr);};
const settle=()=>ev('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
const key=async(key,extra={})=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key,...extra});await send('Input.dispatchKeyEvent',{type:'keyUp',key,...extra});await settle();};
const focused=selector=>ev(`document.activeElement===document.querySelector(${JSON.stringify(selector)})`);
const type=async(selector,text)=>{await ev(`document.querySelector(${JSON.stringify(selector)}).focus()`);for(const char of text){await send('Input.insertText',{text:char});await settle();assert.ok(await focused(selector),'Lost focus while typing '+selector);}};
try {
 await send('Page.enable');await send('Runtime.enable');await send('Fetch.enable',{patterns:[{urlPattern:'*/api/v1/*'}]});
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`if(location.origin===${JSON.stringify(base)})localStorage.setItem('ledgify.auth',${JSON.stringify(JSON.stringify({accessToken:'synthetic',user,organisations:[org],selectedOrganisation:org,permissions}))})`});
 await send('Page.navigate',{url:base+'/sales/invoices/focus-invoice'});await wait('Boolean(document.querySelector(".source-document-page"))');
 await ev(`window.__opener=Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Record payment');window.__opener.focus();window.__opener.click()`);
 await wait('document.querySelector("#bankAccountId")?.value==="bank"');await settle();
 await ev('window.__dialog=document.querySelector("[role=dialog]");window.__notes=document.querySelector("#paymentNotes");undefined');
 if(process.env.EXPECT_BUG){await ev('window.__notes.focus()');await send('Input.insertText',{text:'F'});await settle();console.log(JSON.stringify(await ev('({sameDialog:window.__dialog===document.querySelector("[role=dialog]"),sameNotes:window.__notes===document.querySelector("#paymentNotes"),focus:document.activeElement.className})')));}
 else {
  assert.ok(await focused('#paymentAmount'),'Initial focus must be Payment Amount');
  await type('#paymentNotes','Full payment received by bank transfer');
  assert.equal(await ev('document.querySelector("#paymentNotes").value'),'Full payment received by bank transfer');
  assert.equal(await ev('window.__dialog===document.querySelector("[role=dialog]") && window.__notes===document.querySelector("#paymentNotes")'),true);
  await key('Enter');await type('#paymentNotes','Second line');await key('ArrowLeft');await key('Backspace');await key('Delete');await key('Shift',{modifiers:8});assert.ok(await focused('#paymentNotes'));
  await key('a',{modifiers:4,commands:['selectAll']});await send('Input.insertText',{text:'Full payment received by bank transfer'});await settle();assert.ok(await focused('#paymentNotes'));
  await type('#paymentReference','-REF');assert.equal(await ev('document.querySelector("#paymentReference").value'),'ABS-PO-001-REF');
  for(const selector of ['#paymentAmount','#paymentDate','#bankAccountId','#paymentMethod']){await ev(`document.querySelector('${selector}').focus()`);await key(selector==='#paymentDate'?'ArrowUp':selector==='#paymentAmount'?'ArrowRight':'ArrowDown');if(selector==='#bankAccountId'||selector==='#paymentMethod')await key('Enter');assert.ok(await focused(selector));}
  await ev('document.querySelector("#paymentAmount").focus()');await key('a',{modifiers:4,commands:['selectAll']});await send('Input.insertText',{text:'5000'});await settle();assert.ok(await focused('#paymentAmount'));
  // Check forward and reverse focus containment across the whole form.
  for(let i=0;i<18;i++){await key('Tab');assert.equal(await ev('document.querySelector("[role=dialog]").contains(document.activeElement)'),true);}
  for(let i=0;i<18;i++){await key('Tab',{modifiers:8});assert.equal(await ev('document.querySelector("[role=dialog]").contains(document.activeElement)'),true);}
  await ev('document.querySelector("#paymentNotes").focus()');await key('Escape');await wait('!document.querySelector("[role=dialog]")');assert.equal(await ev('document.activeElement===window.__opener'),true);
  await ev('window.__opener.click()');await wait('document.querySelector("#bankAccountId")?.value==="bank"');await settle();assert.ok(await focused('#paymentAmount'));
  await type('#paymentNotes','Full payment');await ev('document.querySelector("#record-payment-form").requestSubmit()');
  for(let i=0;i<100&&!receivedPayment;i++)await new Promise(r=>setTimeout(r,30));
  assert.ok(receivedPayment);assert.equal(receivedPayment.amount,'5000.00');assert.equal(receivedPayment.notes,'Full payment');assert.equal(receivedPayment.reference,'ABS-PO-001');assert.equal(receivedPayment.bank_account_id,'bank');assert.equal(receivedPayment.currency,'GHS');
  // Latest callback must still honour the in-flight submission guard.
  await key('Escape');assert.equal(await ev('Boolean(document.querySelector("#record-payment-form"))'),true);releasePayment();await wait('!document.querySelector("#record-payment-form")');assert.equal(payments.length,1);
  // Another consumer of the same Modal: Email invoice.
  await ev(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Email').click()`);await wait('Boolean(document.querySelector("[role=dialog] textarea"))');await type('[role=dialog] textarea','A shared modal focus regression');await key('Escape');await wait('!document.querySelector("[role=dialog]")');
  await ev('window.__opener.click()');await wait('Boolean(document.querySelector("#paymentNotes"))');await ev('document.querySelector(".modal-close-button").click()');await wait('!document.querySelector("[role=dialog]")');
  assert.deepEqual(errors,[]);console.log('PASS: initial focus, per-character Notes/reference focus, stable DOM, editing keys, Tab/Shift+Tab, Escape/restore, guarded submission and shared Email modal. One synthetic payment accepted; no backend mutation.');
 }
} finally {if(releasePayment)releasePayment();await browser.send('Target.disposeBrowserContext',{browserContextId});page.ws.close();browser.ws.close();}
