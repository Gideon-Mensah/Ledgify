import { presentReport, reportAmount, reportMetadata } from "./reportPresentation.js";
// Print in a separate document so loaded module CSS cannot affect the output.
export async function printReport(rows,title,metadata,validateContext=()=>{}) {
 if(rows?.length>10000)throw new Error("Select a shorter report period (maximum 10,000 rows).");
 if(!rows?.length)throw new Error("No report data is available to print.");
 if(!metadata.identity?.name)throw new Error("Load the organisation profile before printing.");
 const sections=presentReport(rows,title,metadata);
 const iframe=document.createElement("iframe");iframe.title="Print document";iframe.style.cssText="position:fixed;left:-10000px;width:794px;height:1123px";document.body.append(iframe);
 const target=iframe.contentDocument;target.open();target.write('<!doctype html><html><head><title>Document</title></head><body></body></html>');target.close();target.title=title;
 const style=target.createElement('style');style.textContent='@page{size:A4;margin:12mm;@bottom-right{content:"Page " counter(page) " of " counter(pages);font:8pt Arial}}body{font:10pt Arial;color:#000;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{padding:5px;border-bottom:1px solid #ccc;text-align:left;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}thead{display:table-header-group}tr{break-inside:avoid}h1,h2{break-after:avoid}img{max-width:180px;max-height:85px}';target.head.append(style);
 const add=(tag,text,parent=target.body)=>{const node=target.createElement(tag);node.textContent=String(text??'');parent.append(node);return node;};
 const identity=metadata.identity;if(identity.logo_data){const img=target.createElement('img');img.src=identity.logo_data;target.body.append(img);}
 add('h2',identity.name);add('p',identity.address.join(' · '));for(const key of ['phone','email','website','registration_number','tax_number'])if(identity[key])add('p',`${key.replaceAll('_',' ')}: ${identity[key]}`);
 add('h1',title);add('p',reportMetadata(metadata).map(([key,value])=>`${key}: ${value}`).join(' · '));
 if(sections.some(section=>section.columns.length>=7))style.textContent+='@page{size:A4 landscape}';
 style.textContent+='table{margin-bottom:14px}th.money,td.money{text-align:right;font-variant-numeric:tabular-nums;overflow-wrap:normal}th{background:#eee;overflow-wrap:normal}h3{break-after:avoid}';
 for(const section of sections){
  const table=target.createElement('table');target.body.append(table);
  const group=target.createElement('colgroup');table.append(group);
  const weight=section.columns.reduce((sum,c)=>sum+c.width,0);
  section.columns.forEach(c=>{const col=target.createElement('col');col.style.width=`${c.width/weight*100}%`;group.append(col);});
  const head=target.createElement('thead');table.append(head);if(section.heading){const heading=target.createElement('tr');head.append(heading);const cell=add('th',section.heading,heading);cell.colSpan=section.columns.length;}const header=target.createElement('tr');head.append(header);
  section.columns.forEach(c=>{add('th',c.label,header).className=c.money?'money':'';});
  const body=target.createElement('tbody');table.append(body);
  section.rows.forEach(row=>{const tr=target.createElement('tr');body.append(tr);section.columns.forEach(c=>{add('td',c.money?reportAmount(row[c.key]):row[c.key],tr).className=c.money?'money':'';});});
 }
 try{await target.fonts.ready;await Promise.all([...target.images].map(img=>img.decode()));validateContext();}catch(error){iframe.remove();throw error;}iframe.contentWindow.addEventListener('afterprint',()=>iframe.remove(),{once:true});iframe.contentWindow.focus();iframe.contentWindow.print();
 // Some browsers omit afterprint. Keep the frame until the print dialog has closed.
 return iframe;
}
