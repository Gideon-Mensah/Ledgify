// Local disposable PostgreSQL/Redis only. Real forms and the Django locmem email worker.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const base=process.env.IDENTITY_APP_URL||'http://127.0.0.1:5187';
const cdp=process.env.IDENTITY_CDP_URL||'http://127.0.0.1:9343';
for(const value of [base,cdp,process.env.DATABASE_URL,process.env.DJANGO_CACHE_URL])assert.ok(value&&['127.0.0.1','localhost'].includes(new URL(value).hostname),'Disposable localhost services required');
const out=process.env.IDENTITY_ARTIFACT_DIR||'/tmp/ledgify-phase5/browser';fs.mkdirSync(out,{recursive:true});
const tabs=await(await fetch(cdp+'/json')).json();const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}));
let id=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}};
const send=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value;};
const wait=async expression=>{for(let i=0;i<150;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out waiting for page condition. Visible content: '+await evaluate('document.body.innerText.slice(0,1300)'));};
async function navigate(path){await send('Page.navigate',{url:base+path});await wait(`location.origin===${JSON.stringify(base)}&&document.readyState==='complete'`);}
async function click(text){const expr=`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled)`;await wait(`Boolean(${expr})`);await evaluate(`(${expr}).click()`);}
async function set(selector,value){await wait(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);await evaluate(`{const el=document.querySelector(${JSON.stringify(selector)});const proto=el instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}`);}
async function check(selector){await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);}
async function labelled(label){await evaluate(`Array.from(document.querySelectorAll('label')).find(l=>l.textContent.includes(${JSON.stringify(label)})).querySelector('input[type=checkbox]').click()`);}
const results=[];async function snapshot(name){assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'Horizontal overflow: '+name);const image=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(out+'/'+name+'.png',Buffer.from(image.data,'base64'));results.push({check:name,result:'PASS'});}
const python=process.cwd()+'/accounting-backend/venv/bin/python';
function emailLink(email, legacy=false){
 const source=`import os,sys,json,re\nos.environ.setdefault('DJANGO_SETTINGS_MODULE','config.settings')\nimport django\ndjango.setup()\nfrom django.conf import settings\nassert settings.DEBUG and settings.EMAIL_BACKEND=='django.core.mail.backends.locmem.EmailBackend'\nfrom apps.accounts.identity import deliver_identity_emails\nfrom django.core import mail\nif sys.argv[2]=='legacy':\n from apps.accounts.models import PolicyAcceptance,User\n actor=User.objects.get(email=sys.argv[1]);assert actor.email.startswith('phase5-browser-') and not actor.is_email_verified\n PolicyAcceptance.objects.filter(user=actor).delete()\ndeliver_identity_emails()\nm=[m for m in mail.outbox if sys.argv[1] in m.to][-1]\nprint(json.dumps(re.search(r'http[^\\s]+#token=[^\\s]+',m.body).group(0)))`;
 return JSON.parse(execFileSync(python,['-c',source,email,legacy?'legacy':'new'],{cwd:process.cwd()+'/accounting-backend',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},encoding:'utf8'}));
}
const password='SyntheticBrowserPass!9382';const run=Date.now();let ownerEmail;
await send('Page.enable');await send('Runtime.enable');
for(const width of [1440,1024,768,390]){
 const email=`phase5-browser-${run}-${width}@example.test`;
 if(width===1440)ownerEmail=email;
 await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390});
 await navigate('/register');await evaluate('localStorage.clear();sessionStorage.clear()');await navigate('/register');
 await wait('Boolean(document.querySelector("input[name=first_name]"))');
 assert.equal(await evaluate('document.querySelector("input[name=marketing_consent]").checked'),false);
 for(const [name,value] of Object.entries({first_name:'Synthetic',last_name:'Browser',email,password,confirm_password:password}))await set(`input[name=${name}]`,value);
 await check('input[name=terms_accepted]');await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});assert.notEqual(await evaluate('document.activeElement.tagName'),'BODY');await snapshot(width+'-registration');await click('Create account');await wait('document.body.innerText.includes("Check your email")');
 const verification=emailLink(email,width===1024);await navigate(verification.slice(base.length));
 await wait('location.hash===""&&document.body.innerText.includes("Verify your email")');
 assert.equal(await evaluate('JSON.stringify(localStorage).includes("#token=")'),false);
 await snapshot(width+'-verification');await click('Verify email');await wait('document.body.innerText.includes("Email verified")');
 await navigate('/login');await set('input[type=email]',email);await set('input[type=password]',password);await click('Sign in');await wait('Boolean(document.querySelector(".onboarding-card form"))');
 for(let step=0;step<8;step++){
  await wait(`document.querySelector('.onboarding-card h2')?.textContent===${JSON.stringify(['Welcome','Business identity','Country and regional settings','Financial year','Chart of Accounts','Tax structure','Opening data','Review and create'][step])}`);
  if(step===0&&width===1024){await wait('document.querySelector(".onboarding-card").innerText.includes("before creating this organisation")');await labelled('I agree to the');}
  if(step>0)await wait('document.activeElement===document.querySelector(".onboarding-card h2")');
  if(step===1){
   for(const [name,value] of Object.entries({legal_name:`Synthetic ${width} Business`,business_type:'Sole trader',email,phone:width===390?'+44 7700 900000':'+233 24 000 0000',address_line_1:'Synthetic test address',city:width===390?'London':'Accra'}))await set(`input[name=${name}]`,value);
   await click('Save progress');await wait('document.body.innerText.includes("Setup progress saved.")');await navigate('/onboarding');await wait('document.querySelector("input[name=legal_name]")?.value.includes("Synthetic")');
  }
  if(step===2){await click('Back');await wait('Boolean(document.querySelector("input[name=legal_name]"))');assert.equal(await evaluate('document.querySelector("input[name=legal_name]").value'),`Synthetic ${width} Business`);await click('Continue');await wait('Boolean(document.querySelector("input[name=country_code]"))');if(width===390)await set('input[name=country_code]','GB');await labelled('I have reviewed');}
  if(step===5){
   if(width===390)assert.equal(await evaluate('document.querySelector(".onboarding-card").innerText.includes("VAT registered")'),false);
   assert.equal(await evaluate('Array.from(document.querySelectorAll("label")).find(l=>l.textContent.includes("Activate this reviewed")).querySelector("input").checked'),false);
  }
  if(step===7)await labelled('I confirm these details');
  await snapshot(width+'-onboarding-'+step);
  if(step<7)await click('Continue');
 }
 await click('Create organisation');await wait('location.pathname==="/welcome"');await wait('document.body.innerText.includes("Add customers")');await snapshot(width+'-welcome');
 const state=await evaluate('JSON.parse(localStorage.getItem("ledgify.auth"))');assert.equal(state.selectedOrganisation.base_currency,width===390?'GBP':'GHS');assert.equal(state.selectedOrganisation.legal_name,`Synthetic ${width} Business`);
}
// Existing verified international user accepts the desktop organisation invitation.
await navigate('/login');await evaluate('localStorage.clear()');await navigate('/login');await set('input[type=email]',ownerEmail);await set('input[type=password]',password);await click('Sign in');await wait('location.pathname==="/"');
await navigate('/settings/users');await wait('Boolean(document.querySelector(".access-invitations"))');
await set('.access-invitations input[type=email]',`phase5-browser-${run}-390@example.test`);
await click('Send invitation');await wait('document.body.innerText.includes("Request accepted. Email status")');
const invitation=emailLink(`phase5-browser-${run}-390@example.test`);
await snapshot('390-invitation-created');await evaluate('localStorage.clear()');await navigate(invitation.slice(base.length));
await wait('location.hash===""&&Boolean(document.querySelector("input[type=email]"))');await set('input[type=email]',`phase5-browser-${run}-390@example.test`);await set('input[type=password]',password);await click('Sign in and review invitation');await wait('document.body.innerText.includes("Confirm acceptance")');await snapshot('390-invitation-review');await click('Confirm acceptance');await wait('location.pathname==="/"');await wait('document.body.innerText.includes("Synthetic 1440 Business")');await snapshot('390-invitation-accepted-organisation-switch');
fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify({passed:results.length,failed:0,skipped:0,artifacts:out}));ws.close();
