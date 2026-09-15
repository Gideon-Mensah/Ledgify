// Flatten the backend ledger contract without recomputing balances or exposing IDs.
export function ledgerDocumentRows(ledgers) {
 return (ledgers||[]).flatMap(ledger=>{
  const base={account:ledger.account.code,date:'',journal:'',reference:'',description:'',debit:'',credit:'',balance:''};
  return [{...base,description:`${ledger.account.name} — opening balance`,balance:ledger.opening_balance??''},...(ledger.transactions||[]).map(row=>({...base,date:row.date,journal:row.entry_number,reference:row.reference,description:row.description,debit:row.debit,credit:row.credit,balance:row.running_balance})),{...base,description:'Period totals / closing balance',debit:ledger.total_debit,credit:ledger.total_credit,balance:ledger.balance}];
 });
}
