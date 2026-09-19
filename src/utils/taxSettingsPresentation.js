// Display helpers only: these never change tax records, payloads or calculation rules.
const labels={LEDGIFY_VERIFIED_PRESET:'Ledgify-verified preset',GHANA_GRA:'Ghana – GRA Tax Structure',CUSTOM_INTERNATIONAL:'Custom / International',NO_TAX:'No Tax',ZERO:'Zero-rated',EXEMPT:'Exempt',OUT_SCOPE:'Out of scope',STANDARD:'Standard',PENDING_APPROVAL:'Pending approval',PENDING_VERIFICATION:'Pending verification',ORGANISATION_OVERRIDE:'Organisation-created rule',BOTH:'Sales and purchases',VAT_WHT:'VAT withholding',WHT:'Withholding Tax',PAYE:'PAYE'};
export const taxUiLabel=value=>labels[value]||(!value?'Not recorded':String(value).toLowerCase().replaceAll('_',' ').replace(/^./,c=>c.toUpperCase()).replace(/\b(vat|nhil|wht|gra|paye|ssnit|tin|cst|cit)\b/gi,c=>c.toUpperCase()).replace(/\bgetfund\b/gi,'GETFund'));
export const componentSummary=components=>(components||[]).map(c=>`${c.name||c.code} ${String(c.rate??'0').replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'')}${c.kind==='FIXED'?' per unit':'%'}`).join(' + ')||'No components';
export function filterTaxVersions(versions,codes,{search='',status='',classification='',activeOnly=false,ascending=false,selectedCode=''}){
 return versions.filter(v=>{const code=codes.find(c=>c.id===v.code);return (!selectedCode||v.code===selectedCode)&&(!status||(v.display_status||v.status)===status)&&(!classification||v.classification===classification)&&(!activeOnly||v.display_status==='ACTIVE')&&`${code?.code||''} ${code?.name||''} ${componentSummary(v.components)}`.toLowerCase().includes(search.toLowerCase());}).sort((a,b)=>(a.effective_from||'').localeCompare(b.effective_from||'')*(ascending?1:-1));
}
export function setupProgress(profiles,versions){
 const latest=[...profiles].sort((a,b)=>b.version-a.version)[0];
 const done=[Boolean(latest?.structure),Boolean(latest?.registration&&Object.keys(latest.registration).length),Boolean(latest?.registration&&Object.hasOwn(latest.registration,'obligations')),Boolean(latest?.reviewed_by||latest?.structure==='NO_TAX'),latest?.structure==='NO_TAX'||versions.some(v=>['APPROVED','ACTIVE'].includes(v.status)),latest?.status==='ACTIVE'];
 const labels=['Choose tax structure','Enter registrations','Select obligations','Map control accounts','Review tax rates','Approve and activate'];
 const steps=labels.map((label,i)=>({label,done:done[i]}));
 return {steps,current:done.indexOf(false),percent:Math.round(done.filter(Boolean).length/6*100)};
}
