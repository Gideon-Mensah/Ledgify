const posted = new Set(["approved", "sent", "partly_paid", "paid"]);
export function documentActions(kind, document, hasPermission) {
  const sales=kind === "invoice"; const state=document.backendStatus || document.status;
  const permitted=(permission,enabled,reason="Unavailable for this document state.")=>({visible:hasPermission(permission),enabled:Boolean(enabled),reason:enabled?"":reason});
  return {
    approve:permitted(sales?"approve_invoice":"approve_bill",state==="draft"),
    edit:permitted(sales?"create_invoice":"create_bill",state==="draft"),
    email:permitted("create_invoice",sales&&posted.has(state),"Only approved, sent, partly paid or paid invoices can be emailed."),
    pay:permitted(sales?"create_customer_payment":"create_supplier_payment",posted.has(state)&&Number(document.amountDue)>0),
    reverse:permitted("reverse_journal",posted.has(state)&&Number(document.amountPaid||0)===0&&Number(document.amountCredited||0)===0,"Reverse or unallocate settlements first. Dependent credits, write-offs and closed periods are checked by the server."),
    pdf:permitted("export_reports",true),
  };
}
