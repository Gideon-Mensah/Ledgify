import test from 'node:test';
import assert from 'node:assert/strict';
import { presentReport, reportAmount, reportMetadata } from '../src/utils/reportPresentation.js';
const account={id:'8cb42a5b-f38a-4532-91aa-ef0ad03d3667',code:'1000',name:'Long account name '.repeat(15),account_type:'asset',serializer_metadata:{private:true}};
test('trial balance exposes only human fields and preserves exact supplied amounts and totals',()=>{
 const result=presentReport([{section:'rows',account,debit:'1000.10',credit:'0.00',net_balance:'1000.10'},{section:'Totals',total_debit:'1000.10',total_credit:'1000.10',difference:'0.00'}],'Trial Balance');
 assert.equal(result[0].rows[0].name,account.name);
 assert.equal(result[0].rows[0].debit,'1000.10');assert.equal(result[0].rows[1].credit,'1000.10');
 const printed=result.flatMap(s=>s.rows.flatMap(Object.values)).join(' ');
 for(const forbidden of [account.id,'[object Object]','serializer_metadata','{"'])assert.ok(!printed.includes(forbidden));
});
test('money formatting preserves decimal precision, zero and negative balances without binary arithmetic',()=>{
 assert.equal(reportAmount('9007199254740993.01'),'9,007,199,254,740,993.01');
 assert.equal(reportAmount('-1200.50'),'(1,200.50)');assert.equal(reportAmount('-0.00'),'0.00');assert.equal(reportAmount('0'),'0.00');assert.equal(reportAmount('1.2345'),'1.2345');
});
for(const [title,section,total] of [['Profit and Loss','income','net_profit'],['Balance Sheet','assets','total_assets'],['Cash Flow Statement','operating','net_cash_flow']])test(`${title} retains explicit sections, comparisons and backend totals`,()=>{
 const result=presentReport([{section,account,amount:'123.45',comparative_amount:'99.99'},{section:'Totals',[total]:'123.45'}],title);
 assert.equal(result[0].rows[0].amount,'123.45');assert.equal(result[0].rows[0].comparative_amount,'99.99');assert.equal(result.at(-1).rows[0].amount,'123.45');
});
test('ledger has account sections, opening and closing values without internal references',()=>{
 const result=presentReport([{}],'General Ledger',{report_data:[{account,opening_balance:'-10',transactions:[{entry_number:'J-1',journal_id:account.id,debit:'2',credit:'0',running_balance:'-8'}],total_debit:'2',total_credit:'0',balance:'-8'}]});
 assert.equal(result[0].heading,`${account.code} · ${account.name}`);assert.equal(result[0].rows[1].journal,'J-1');assert.equal(result[0].rows[2].balance,'-8');
});
test('aging separates party, transaction currency, base currency and reconciliation sections',()=>{
 const result=presentReport([{customer:{id:account.id,name:'Customer'},buckets:{current:'10','90_plus':'2'},total_outstanding:'12',invoices:[{invoice_number:'INV-1',currency:'GBP',amount_due:'1',base_amount_due:'12'}]},{section:'Totals',buckets:{current:'12'},total_outstanding:'12',control_balance:'12'}],'Aged Receivables');
 assert.equal(result[0].rows[0]['90_plus'],'2');assert.equal(result[1].rows[0].currency,'GBP');assert.equal(result[1].rows[0].base_amount_due,'12');
});
test('metadata retains currency labels but never raw report objects or account IDs',()=>{
 for(const currency of ['GHS','GBP']){
 const result=reportMetadata({currency,base_currency:'GHS',transaction_currency:'GBP',account_id:account.id,report_data:{account}});
 assert.deepEqual(result,[['Currency',currency],['Base Currency','GHS'],['Transaction Currency','GBP']]);
 }
});
test('large reports preserve every row and full long names',()=>{
 const result=presentReport([...Array.from({length:300},()=>({account,debit:'1.00',credit:'0.00',net_balance:'1.00'})),{section:'Totals',total_debit:'300.00',total_credit:'0.00',difference:'300.00'}],'Trial Balance');
 assert.equal(result[0].rows.length,301);assert.equal(result[0].rows[299].name,account.name);
});
test('tax export labels use configured names instead of internal version codes',async()=>{
 const {taxExportRows}=await import('../src/utils/taxReport.js');
 const row={tax_rate:'internal',tax_rate_code:'V1234567890abcdef12345-0',tax_rate_percent:'15'};
 assert.match(taxExportRows([row],{},[{id:'internal',name:'Standard sales / VAT'}])[0].tax_rate,/Standard sales \/ VAT/);
 assert.doesNotMatch(taxExportRows([row],{})[0].tax_rate,/V1234567890/);
});
test('P&L category subtotals retain the on-screen hierarchy without floating-point loss',()=>{
 const row=(section,account_class,amount)=>({section,account:{...account,account_class},amount});
 const result=presentReport([row('income','revenue','0.30'),row('expenses','cost_of_sales','0.10'),row('expenses','expense','0.10'),row('income','other_income','0.05'),row('expenses','other_expense','0.01'),{section:'Totals',total_income:'0.35',total_expenses:'0.21',net_profit:'0.14'}],'Profit and Loss');
 assert.equal(result.find(s=>s.heading==='Gross Profit').rows[0].amount,'0.20');
 assert.equal(result.find(s=>s.heading==='Operating Profit').rows[0].amount,'0.10');
 assert.equal(result.at(-1).rows.at(-1).amount,'0.14');
 for(const heading of ['Income','Cost of Sales','Operating Expenses','Other Income','Other Expenses'])assert.ok(result.some(s=>s.heading===heading));
});
test('Balance Sheet preserves current and non-current asset and liability groups',()=>{
 const rows=[['assets','bank'],['assets','fixed_asset'],['liabilities','payable'],['liabilities','non_current_liability']].map(([section,account_class])=>({section,account:{...account,account_class},amount:'1.00'}));
 const result=presentReport([...rows,{section:'Totals',total_assets:'2.00',total_liabilities:'2.00',total_equity:'0.00',total_liabilities_and_equity:'2.00',difference:'0.00'}],'Balance Sheet');
 assert.equal(result.at(-1).rows.find(row=>row.label==='Difference').amount,'0.00');
 for(const heading of ['Current Assets','Non-current Assets','Current Liabilities','Non-current Liabilities'])assert.ok(result.some(s=>s.heading===heading));
});
