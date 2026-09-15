import test from "node:test";
import assert from "node:assert/strict";
import { createInvoicePdf } from "../src/utils/invoicePdf.js";
import { createBillPdf } from "../src/utils/billPdf.js";

test("invoice and bill downloads use scoped server PDF values, ignoring browser totals and identity",async()=>{
 const original=globalThis.fetch;let calls=[];
 Object.defineProperty(globalThis,"localStorage",{configurable:true,value:{getItem:()=>JSON.stringify({accessToken:"test",selectedOrganisation:{id:"org-a",base_currency:"GHS"}})}});
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return new Response('%PDF-'+('trusted GHS 120.00 '.repeat(10)),{headers:{'Content-Type':'application/pdf'}});};
 try {for(const create of [createInvoicePdf,createBillPdf]){const pdf=await create({id:"document-id",total:99999,currency:"GBP",company:{name:"Forged"}});assert.match(await pdf.text(),/trusted GHS 120.00/);}
 for(const call of calls){assert.equal(call.options.headers['X-Organisation-ID'],'org-a');assert.equal(call.options.method,'GET');assert.equal(call.options.body,undefined);}}
 finally{globalThis.fetch=original;}
});
test("missing documents, failed requests and empty PDF responses cannot download",async()=>{
 await assert.rejects(createInvoicePdf({}),/Load a saved document/);
 const original=globalThis.fetch;
 try{globalThis.fetch=async()=>new Response('',{headers:{'Content-Type':'application/pdf'}});await assert.rejects(createBillPdf({id:'id'}),/valid PDF/);
 globalThis.fetch=async()=>new Response(JSON.stringify({detail:'Not found'}),{status:404,headers:{'Content-Type':'application/json'}});await assert.rejects(createInvoicePdf({id:'id'}),e=>e.status===404&&e.data.detail==='Not found');}finally{globalThis.fetch=original;}
});
