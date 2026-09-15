import { isMonetaryField } from "./monetaryFields.js";
// Customer-facing report schemas. Only explicitly selected scalar values leave the API boundary.
export const reportLabel = value => String(value ?? '').replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
export const reportScalar = value => value == null || typeof value === 'object' ? '' : String(value);
export function reportAmount(value) {
  const text = reportScalar(value);
  if (!text) return '';
  if (!/^-?\d+(\.\d+)?$/.test(text)) throw new Error('The report contains an invalid amount.');
  const negative = text.startsWith('-') && /[1-9]/.test(text);
  const [whole, fraction = ''] = text.replace(/^-/, '').split('.');
  return `${negative ? '(' : ''}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction.padEnd(2, '0')}${negative ? ')' : ''}`;
}
// The same section sums used by the on-screen statements, with decimal-string arithmetic.
const sumAmounts = values => {
  const inputs=values.map(value=>reportScalar(value)||'0');
  inputs.forEach(value=>reportAmount(value));
  const scale=Math.max(2,...inputs.map(value=>(value.split('.')[1]||'').length));
  const total=inputs.reduce((sum,value)=>{const negative=value.startsWith('-');const [whole,fraction='']=value.replace(/^-/,'').split('.');const units=BigInt(whole+fraction.padEnd(scale,'0'));return sum+(negative?-units:units);},0n);
  const digits=(total<0n?-total:total).toString().padStart(scale+1,'0');
  return `${total<0n?'-':''}${digits.slice(0,-scale)}.${digits.slice(-scale)}`;
};
const negate=value=>String(value).startsWith('-')?String(value).slice(1):'-'+value;
const column = (key, label = reportLabel(key), money = false, width = 1) => ({ key, label, money, width });
const text = (key, label, width = 2) => column(key, label, false, width);
const money = (key, label) => column(key, label, true, 1.4);
const accountColumns = [text('code', 'Account code', 1.6), text('name', 'Account name', 4), text('type', 'Type', 1.5)];
const accountRow = row => ({ ...row, code: row.account?.code, name: row.account?.name, type: reportLabel(row.account?.account_type || row.account?.account_class) });
const ledgerColumns = [text('date', 'Date', 1.3), text('journal', 'Journal', 1.3), text('reference', 'Reference', 1.4), text('description', 'Description', 4), money('debit'), money('credit'), money('balance')];
const totalsKeys = ['total_income','total_expenses','net_profit','total_assets','total_liabilities','total_equity','total_liabilities_and_equity','total_operating','total_investing','total_financing','total_unclassified','net_cash_flow','opening_cash','closing_cash','difference'];
export function reportMetadata(metadata) {
  return ['start_date','end_date','as_of_date','currency','base_currency','transaction_currency','bank_account','source','opening_balance','closing_balance','report_amount','generated','filters','tax_position'].filter(key => metadata[key] != null && metadata[key] !== '').map(key => [reportLabel(key), reportScalar(metadata[key])]).filter(([, value]) => value);
}
export function presentReport(rows, title, metadata = {}) {
  const sections = [];
  const add = (heading, columns, items) => {
    if (!items.length) return;
    sections.push({ heading, columns, rows: items.map(row => Object.fromEntries(columns.map(c => [c.key, reportScalar(row[c.key])])) ) });
  };
  const totals = rows.find(row => row.section === 'Totals') || {};
  if (title === 'Trial Balance') {
    add('', [...accountColumns, money('debit'), money('credit'), money('net_balance', 'Balance')], [
      ...rows.filter(row => row.account).map(accountRow),
      { name: 'Total', debit: totals.total_debit, credit: totals.total_credit, net_balance: totals.difference },
    ]);
  } else if (['Profit and Loss','Balance Sheet','Cash Flow Statement'].includes(title)) {
    const sectionRows=key=>rows.filter(row=>row.section===key);
    const subsection=(heading,items,total)=>{
      if(!items.length)return;
      const columns=[...accountColumns,money('amount','Current period')];
      if(items.some(row=>row.comparative_amount!=null))columns.push(money('comparative_amount','Comparative period'));
      add(heading,columns,[...items.map(accountRow),{name:`Total ${heading}`,amount:total??sumAmounts(items.map(row=>row.amount))}]);
    };
    if(title==='Profit and Loss'){
      const income=sectionRows('income').filter(row=>row.account?.account_class!=='other_income');
      const costs=sectionRows('expenses').filter(row=>row.account?.account_class==='cost_of_sales');
      const operating=sectionRows('expenses').filter(row=>!['cost_of_sales','other_expense'].includes(row.account?.account_class));
      subsection('Income',income);subsection('Cost of Sales',costs);
      const gross=sumAmounts([...income.map(row=>row.amount),...costs.map(row=>negate(row.amount))]);
      if(costs.length)add('Gross Profit',[text('label','Description',5),money('amount')],[{label:'Gross Profit',amount:gross}]);
      subsection('Operating Expenses',operating);
      if(operating.length)add('Operating Profit',[text('label','Description',5),money('amount')],[{label:'Operating Profit',amount:sumAmounts([gross,...operating.map(row=>negate(row.amount))])}]);
      subsection('Other Income',sectionRows('income').filter(row=>row.account?.account_class==='other_income'));
      subsection('Other Expenses',sectionRows('expenses').filter(row=>row.account?.account_class==='other_expense'));
    }else if(title==='Balance Sheet'){
      for(const [key,classes] of [['assets',['bank','current_asset','receivable']],['liabilities',['current_liability','payable']]]){
        subsection(`Current ${reportLabel(key)}`,sectionRows(key).filter(row=>classes.includes(row.account?.account_class)));
        subsection(`Non-current ${reportLabel(key)}`,sectionRows(key).filter(row=>!classes.includes(row.account?.account_class)));
      }
      subsection('Equity',sectionRows('equity'),totals.total_equity);
    }else{
      for(const key of ['operating','investing','financing','unclassified'])subsection(key==='unclassified'?'Unclassified Cash Flows':`Cash Flows from ${reportLabel(key)} Activities`,sectionRows(key),totals[`total_${key}`]);
    }
    add('Report totals', [text('label', 'Description', 5), money('amount')], totalsKeys.filter(key => totals[key] != null).map(key => ({label: reportLabel(key), amount: totals[key]})));
  } else if (title === 'General Ledger' || metadata.report_type === 'account-details') {
    const ledgers = metadata.report_data;
    if (Array.isArray(ledgers)) for (const ledger of ledgers) add(`${ledger.account.code} · ${ledger.account.name}`, ledgerColumns, [
      {description:'Opening balance', balance:ledger.opening_balance},
      ...ledger.transactions.map(row => ({...row, journal:row.entry_number, balance:row.running_balance})),
      {description:'Period totals / closing balance', debit:ledger.total_debit, credit:ledger.total_credit, balance:ledger.balance},
    ]);
    else for (const code of [...new Set(rows.map(row => row.account))]) add(reportScalar(code), ledgerColumns, rows.filter(row => row.account === code));
  } else if (['Aged Receivables','Aged Payables'].includes(title)) {
    const party = title === 'Aged Receivables' ? 'customer' : 'supplier';
    const bucketKeys = ['current','1_30','31_60','61_90','90_plus'];
    const bucketColumns = bucketKeys.map(key => money(key, key === 'current' ? 'Current' : key === '90_plus' ? '90+ days' : key.replaceAll('_','–')+' days'));
    for (const row of rows.filter(row => row[party])) {
      add(row[party].name, [...bucketColumns, money('total_outstanding','Total outstanding')], [{...row.buckets,total_outstanding:row.total_outstanding}]);
      const documents = row.invoices || row.bills || [];
      add(`${row[party].name} · Documents`, [text('number','Document'),text('due_date','Due date'),text('currency','Transaction currency'),money('amount_due','Transaction outstanding'),money('base_amount_due','Base outstanding')], documents.map(doc => ({...doc,number:doc.invoice_number || doc.bill_number})));
    }
    add('Aging totals · Base currency', [...bucketColumns,money('total_outstanding')], [{...totals.buckets,total_outstanding:totals.total_outstanding}]);
    add('Control reconciliation', [text('label','Description',4),money('amount')], ['gross_outstanding','unallocated_payments','unallocated_credits','standalone_refunds','control_balance','other_control_movements','reconciliation_difference','reconciled_balance'].filter(key => totals[key]!=null).map(key=>({label:reportLabel(key),amount:totals[key]})));
    add('Transaction currency totals', [text('currency','Transaction currency'),money('gross_outstanding'),money('unallocated_payments'),money('unallocated_credits'),money('net_outstanding')], rows.filter(row=>row.section==='currency_totals'));
  } else if (title === 'Indirect Tax Report') {
    add('Tax workpaper', [text('date'),text('document'),text('contact'),text('type'),text('direction'),text('tax_rate','Tax rate'),money('net_amount','Net'),money('tax_amount','Tax'),money('gross_amount','Gross'),text('currency'),text('inclusion'),text('status')], rows);
  } else if (title === 'Bank reconciliation') {
    add('Statement transactions', [text('date'),text('description','Description',4),text('reference'),money('amount'),text('currency'),text('status')], rows.filter(row=>row.section!=='Summary'));
    const summary = rows.find(row=>row.section==='Summary') || {};
    add('Reconciliation summary', [text('label','Description',4),money('amount')], ['statement_balance','book_balance','difference','matched_amount','unmatched_amount','outstanding_deposits','outstanding_payments'].filter(key=>summary[key]!=null).map(key=>({label:reportLabel(key),amount:summary[key]})));
    add('Reconciliation status', [text('label','Description',4),text('value','Result')], ['statement_balance_available','complete','reconciled_count','unreconciled_count','transaction_count'].filter(key=>summary[key]!=null).map(key=>({label:reportLabel(key),value:typeof summary[key]==='boolean'?(summary[key]?'Yes':'No'):summary[key]})));
  } else {
    // Preserve existing scalar operational exports; internal keys and nested API records are not columns.
    const internal = /(^id$|_id$|^organisation$|metadata|checksum|snapshot|^created_by$|^updated_by$)/i;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const keys = [...new Set(rows.flatMap(row=>Object.keys(row)))].filter(key=>!internal.test(key) && rows.some(row=>row[key]!=null && typeof row[key]!=='object') && !rows.some(row=>uuid.test(reportScalar(row[key]))));
    const columns = keys.map(key=>column(key,reportLabel(key),isMonetaryField(key),/name|description|particulars/.test(key)?4:1.5));
    add('', columns, rows);
  }
  if (!sections.length || sections.some(section=>!section.columns.length)) throw new Error('No printable report values are available.');
  return sections;
}
