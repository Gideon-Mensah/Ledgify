"""Database enforcement for source records, allocations, and period overlap."""
from django.db import migrations

# table, journal column, fields allowed to change through a domain workflow,
# terminal status required if that source's original journal is reversed.
SOURCES = [
 ('fx_fxrevaluation','journal_id','reversal_journal_id,reversed_by_id,reversed_at','fx_reversal'),
 ('sales_invoice','accounting_journal_id','status,amount_paid,amount_credited,amount_written_off,updated_at','void'),
 ('purchases_bill','accounting_journal_id','status,amount_paid,amount_credited,updated_at','void'),
 ('sales_customerpayment','accounting_journal_id','status,updated_at','reversed'),
 ('purchases_supplierpayment','accounting_journal_id','status,updated_at','reversed'),
 ('sales_customercreditnote','accounting_journal_id','status,amount_applied,amount_refunded,updated_at','unsupported'),
 ('purchases_suppliercredit','accounting_journal_id','status,amount_applied,amount_refunded,updated_at','unsupported'),
 ('sales_customerrefund','accounting_journal_id','status,updated_at','unsupported'),
 ('purchases_supplierrefund','accounting_journal_id','status,updated_at','unsupported'),
 ('sales_baddebtwriteoff','accounting_journal_id','status,updated_at','unsupported'),
 ('inventory_stockmovement','accounting_journal_id','status,updated_at','stock_reversal'),
 ('accounting_openingbalance','journal_id','status,reversal_journal_id,updated_by_id,updated_at','reversed'),
 ('payroll_payslip','journal_id','amount_paid,payment_status','unsupported'),
 ('payroll_payrollpayment','journal_id','','unsupported'),
 ('fixed_assets_fixedasset','activation_journal_id','status,updated_at','unsupported'),
 ('fixed_assets_depreciationschedule','journal_id','','unsupported'),
 ('fixed_assets_fixedassetdisposal','journal_id','','unsupported'),
]
LINES = [
 ('sales_invoiceline','invoice_id','sales_invoice','accounting_journal_id'),
 ('purchases_billline','bill_id','purchases_bill','accounting_journal_id'),
 ('sales_customercreditnoteline','credit_note_id','sales_customercreditnote','accounting_journal_id'),
 ('purchases_suppliercreditline','credit_id','purchases_suppliercredit','accounting_journal_id'),
 ('accounting_openingbalanceline','opening_balance_id','accounting_openingbalance','journal_id'),
 ('payroll_payslipline','payslip_id','payroll_payslip','journal_id'),
]
SQL = r'''
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE accounting_accountingperiod ADD CONSTRAINT ledgify_period_no_overlap
 EXCLUDE USING gist (organisation_id WITH =, daterange(start_date,end_date,'[]') WITH &&);
ALTER TABLE accounting_accountingperiod ADD CONSTRAINT ledgify_period_dates CHECK(start_date<=end_date);
CREATE FUNCTION ledgify_guard_financial_year() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM ledgify_lock_ledger(NEW.organisation_id);
 IF TG_OP='INSERT' AND NEW.status<>'open' THEN RAISE EXCEPTION 'Create an open financial year first' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (OLD.organisation_id,OLD.start_date,OLD.end_date) IS DISTINCT FROM (NEW.organisation_id,NEW.start_date,NEW.end_date) THEN
   RAISE EXCEPTION 'Financial year boundaries are immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ledgify_financial_year BEFORE INSERT OR UPDATE ON accounting_financialyear FOR EACH ROW EXECUTE FUNCTION ledgify_guard_financial_year();
CREATE FUNCTION ledgify_year_transition_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status<>NEW.status AND NOT EXISTS (
   SELECT 1 FROM accounting_financialyearhistory WHERE financial_year_id=NEW.id AND performed_at>=OLD.updated_at
   AND ((NEW.status='closed' AND action='closed') OR (NEW.status='open' AND action='reopened' AND length(trim(reason))>0))) THEN
   RAISE EXCEPTION 'Financial year transition requires durable actor and reason history' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ledgify_year_audit AFTER UPDATE ON accounting_financialyear DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledgify_year_transition_audit();
CREATE FUNCTION ledgify_org_currency_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM ledgify_lock_ledger(OLD.id);
 IF NEW.base_currency<>OLD.base_currency AND EXISTS(SELECT 1 FROM accounting_journalentry WHERE organisation_id=OLD.id AND status IN ('posted','reversed')) THEN
   RAISE EXCEPTION 'Base currency cannot change after ledger posting' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ledgify_org_currency BEFORE UPDATE ON organisations_organisation FOR EACH ROW EXECUTE FUNCTION ledgify_org_currency_guard();
CREATE FUNCTION ledgify_opening_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM ledgify_lock_ledger(NEW.organisation_id);
 IF NEW.status='posted' AND EXISTS(
   SELECT 1 FROM accounting_openingbalance o JOIN accounting_journalentry r ON r.reversal_of_id=o.journal_id
   WHERE o.id<>NEW.id AND o.organisation_id=NEW.organisation_id AND o.opening_date=NEW.opening_date AND r.date>NEW.opening_date
 ) THEN RAISE EXCEPTION 'Opening replacement cannot precede its original reversal' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ledgify_opening_history BEFORE INSERT OR UPDATE ON accounting_openingbalance FOR EACH ROW EXECUTE FUNCTION ledgify_opening_history_guard();
CREATE FUNCTION ledgify_pay_run_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM payroll_payslip p JOIN accounting_journalentry j ON j.id=p.journal_id WHERE p.pay_run_id=OLD.id AND j.status IN ('posted','reversed')) THEN
   IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Posted payroll run cannot be deleted' USING ERRCODE='23514'; END IF;
   IF (to_jsonb(OLD)-ARRAY['status','updated_at','processed_at']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['status','updated_at','processed_at']) OR NEW.status NOT IN ('posted','paid') THEN
     RAISE EXCEPTION 'Posted payroll run financial fields are immutable' USING ERRCODE='23514';
   END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER ledgify_pay_run BEFORE UPDATE OR DELETE ON payroll_payrollrun FOR EACH ROW EXECUTE FUNCTION ledgify_pay_run_guard();
CREATE TRIGGER ledgify_exchange_rate BEFORE UPDATE OR DELETE ON fx_exchangerate FOR EACH ROW EXECUTE FUNCTION ledgify_immutable_history();
CREATE FUNCTION ledgify_guard_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE jid uuid; state text; old_data jsonb; new_data jsonb;
BEGIN
 old_data=to_jsonb(OLD); jid=(old_data->>TG_ARGV[0])::uuid;
 IF jid IS NULL THEN IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW; END IF;
 SELECT status INTO state FROM accounting_journalentry WHERE id=jid FOR UPDATE;
 IF state NOT IN ('posted','reversed') THEN IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW; END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Posted source documents cannot be deleted' USING ERRCODE='23514'; END IF;
 new_data=to_jsonb(NEW);
 IF (old_data-string_to_array(TG_ARGV[1],',')) IS DISTINCT FROM (new_data-string_to_array(TG_ARGV[1],',')) THEN
   RAISE EXCEPTION 'Posted source financial fields are immutable' USING ERRCODE='23514';
 END IF;
 IF new_data->>'status' IN ('draft','awaiting_approval','submitted') OR
    (new_data->>'status' IN ('void','reversed') AND state<>'reversed') THEN
   RAISE EXCEPTION 'Source status requires its domain correction workflow' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION ledgify_guard_source_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_id uuid; new_id uuid; jid uuid;
BEGIN
 IF TG_OP<>'INSERT' THEN old_id=(to_jsonb(OLD)->>TG_ARGV[0])::uuid; END IF;
 IF TG_OP<>'DELETE' THEN new_id=(to_jsonb(NEW)->>TG_ARGV[0])::uuid; END IF;
 FOR jid IN EXECUTE format('SELECT %I FROM %I WHERE id IN ($1,$2) FOR UPDATE',TG_ARGV[2],TG_ARGV[1]) USING old_id,new_id LOOP
   IF EXISTS(SELECT 1 FROM accounting_journalentry WHERE id=jid AND status IN ('posted','reversed')) THEN
     RAISE EXCEPTION 'Posted source lines are immutable' USING ERRCODE='23514';
   END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION ledgify_guard_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Allocation history cannot be deleted' USING ERRCODE='23514'; END IF;
 IF (to_jsonb(OLD)-ARRAY['status','reversed_at','reversed_by_id','reversal_reason','reversal_effective_date']) IS DISTINCT FROM
    (to_jsonb(NEW)-ARRAY['status','reversed_at','reversed_by_id','reversal_reason','reversal_effective_date']) THEN
   RAISE EXCEPTION 'Allocation financial history is immutable' USING ERRCODE='23514';
 END IF;
 IF to_jsonb(NEW)->>'status'='reversed' AND (to_jsonb(NEW)->>'reversal_effective_date' IS NULL OR to_jsonb(NEW)->>'reversed_by_id' IS NULL OR length(trim(to_jsonb(NEW)->>'reversal_reason'))=0 OR (to_jsonb(NEW)->>'reversal_effective_date')::date<coalesce((to_jsonb(NEW)->>'effective_date')::date,(to_jsonb(NEW)->>'allocated_at')::date)) THEN
   RAISE EXCEPTION 'Unallocation requires an actor, reason and valid effective date' USING ERRCODE='23514';
 END IF;
 IF to_jsonb(OLD)->>'status'='reversed' AND to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW) THEN
   RAISE EXCEPTION 'Reversed allocations are immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION ledgify_document_totals_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE document_id uuid; d record; paid numeric; credited numeric; written numeric;
BEGIN
 IF TG_TABLE_NAME IN ('sales_invoice','purchases_bill') THEN document_id=NEW.id;
 ELSE document_id=(to_jsonb(NEW)->>TG_ARGV[1])::uuid; END IF;
 IF TG_ARGV[0]='sales' THEN
   SELECT * INTO d FROM sales_invoice WHERE id=document_id;
   SELECT coalesce(sum(amount),0) INTO paid FROM sales_customerpaymentallocation WHERE invoice_id=document_id AND status='active';
   SELECT coalesce(sum(amount),0) INTO credited FROM sales_customercreditallocation WHERE invoice_id=document_id;
   SELECT coalesce(sum(amount),0) INTO written FROM sales_baddebtwriteoff WHERE invoice_id=document_id AND status='posted';
   IF d.amount_paid<>paid OR d.amount_credited<>credited OR d.amount_written_off<>written THEN
     RAISE EXCEPTION 'Invoice accumulated balances must equal its allocation and write-off history' USING ERRCODE='23514';
   END IF;
 ELSE
   SELECT * INTO d FROM purchases_bill WHERE id=document_id;
   SELECT coalesce(sum(amount),0) INTO paid FROM purchases_supplierpaymentallocation WHERE bill_id=document_id AND status='active';
   SELECT coalesce(sum(amount),0) INTO credited FROM purchases_suppliercreditallocation WHERE bill_id=document_id;
   IF d.amount_paid<>paid OR d.amount_credited<>credited THEN
     RAISE EXCEPTION 'Bill accumulated balances must equal its allocation history' USING ERRCODE='23514';
   END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE FUNCTION ledgify_guard_account_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM ledgify_lock_ledger(OLD.organisation_id);
 IF (OLD.organisation_id,OLD.account_type,OLD.account_class,OLD.currency) IS DISTINCT FROM
    (NEW.organisation_id,NEW.account_type,NEW.account_class,NEW.currency) AND EXISTS (
      SELECT 1 FROM accounting_journalline l JOIN accounting_journalentry j ON j.id=l.journal_entry_id
       WHERE l.account_id=OLD.id AND j.status IN ('posted','reversed')) THEN
   RAISE EXCEPTION 'Account financial classification used by posted history is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ledgify_account_history BEFORE UPDATE ON accounting_account FOR EACH ROW EXECUTE FUNCTION ledgify_guard_account_history();
CREATE TRIGGER ledgify_correction_history BEFORE UPDATE OR DELETE ON accounting_accountingcorrection FOR EACH ROW EXECUTE FUNCTION ledgify_immutable_history();
CREATE TRIGGER ledgify_year_history BEFORE UPDATE OR DELETE ON accounting_financialyearhistory FOR EACH ROW EXECUTE FUNCTION ledgify_immutable_history();
'''


def forward(apps, editor):
    if editor.connection.vendor != 'postgresql': return
    editor.execute(SQL, params=None)
    for table,app,fk in [('sales_invoice','sales','id'),('purchases_bill','purchases','id'),('sales_customerpaymentallocation','sales','invoice_id'),('sales_customercreditallocation','sales','invoice_id'),('sales_baddebtwriteoff','sales','invoice_id'),('purchases_supplierpaymentallocation','purchases','bill_id'),('purchases_suppliercreditallocation','purchases','bill_id')]:
        editor.execute(f"CREATE CONSTRAINT TRIGGER ledgify_document_totals AFTER INSERT OR UPDATE ON {table} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledgify_document_totals_guard('{app}','{fk}')",params=None)
    checks=[]
    for table, journal, mutable, terminal in SOURCES:
        editor.execute(f"CREATE TRIGGER ledgify_source_guard BEFORE UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION ledgify_guard_source('{journal}','{mutable}')",params=None)
        condition="TRUE" if terminal=='unsupported' else f"s.status<>'{terminal}'"
        if terminal=='fx_reversal':
            condition="NOT EXISTS(SELECT 1 FROM accounting_journalentry r WHERE r.id=s.reversal_journal_id AND r.reversal_of_id=NEW.id AND r.status='posted')"
        if terminal=='stock_reversal':
            condition="NOT EXISTS(SELECT 1 FROM inventory_stockmovement r WHERE r.reversal_of_id=s.id AND r.status='posted')"
        checks.append(f"IF EXISTS(SELECT 1 FROM {table} s WHERE s.{journal}=NEW.id AND {condition}) THEN RAISE EXCEPTION 'Reverse through the responsible source workflow: {table}' USING ERRCODE='23514'; END IF;")
    editor.execute("""CREATE FUNCTION ledgify_source_reversal_consistency() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF (SELECT status FROM accounting_journalentry WHERE id=NEW.id)='reversed' THEN
      """+'\n'.join(checks)+""" END IF; RETURN NULL; END $$;
      CREATE CONSTRAINT TRIGGER ledgify_source_reversal AFTER UPDATE ON accounting_journalentry
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledgify_source_reversal_consistency();""",params=None)
    for table,fk,parent,journal in LINES:
        editor.execute(f"CREATE TRIGGER ledgify_source_line_guard BEFORE INSERT OR UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION ledgify_guard_source_line('{fk}','{parent}','{journal}')",params=None)
    for table in ['sales_customerpaymentallocation','purchases_supplierpaymentallocation','sales_customercreditallocation','purchases_suppliercreditallocation']:
        editor.execute(f"CREATE TRIGGER ledgify_allocation_guard BEFORE UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION ledgify_guard_allocation()",params=None)


def backward(apps, editor):
    if editor.connection.vendor != 'postgresql': return
    for table in ['sales_invoice','purchases_bill','sales_customerpaymentallocation','sales_customercreditallocation','sales_baddebtwriteoff','purchases_supplierpaymentallocation','purchases_suppliercreditallocation']:
        editor.execute(f'DROP TRIGGER ledgify_document_totals ON {table}')
    for table, *_ in SOURCES: editor.execute(f'DROP TRIGGER ledgify_source_guard ON {table}')
    for table, *_ in LINES: editor.execute(f'DROP TRIGGER ledgify_source_line_guard ON {table}')
    for table in ['sales_customerpaymentallocation','purchases_supplierpaymentallocation','sales_customercreditallocation','purchases_suppliercreditallocation']:
        editor.execute(f'DROP TRIGGER ledgify_allocation_guard ON {table}')
    for trigger,table in [('ledgify_account_history','accounting_account'),('ledgify_correction_history','accounting_accountingcorrection'),('ledgify_year_history','accounting_financialyearhistory'),('ledgify_source_reversal','accounting_journalentry'),('ledgify_financial_year','accounting_financialyear'),('ledgify_year_audit','accounting_financialyear'),('ledgify_org_currency','organisations_organisation'),('ledgify_opening_history','accounting_openingbalance'),('ledgify_pay_run','payroll_payrollrun'),('ledgify_exchange_rate','fx_exchangerate')]:
        editor.execute(f'DROP TRIGGER {trigger} ON {table}')
    for function in ['ledgify_opening_history_guard','ledgify_pay_run_guard','ledgify_org_currency_guard','ledgify_document_totals_guard','ledgify_guard_financial_year','ledgify_year_transition_audit','ledgify_guard_source','ledgify_guard_source_line','ledgify_guard_allocation','ledgify_guard_account_history','ledgify_source_reversal_consistency']:
        editor.execute(f'DROP FUNCTION {function}()')
    editor.execute('ALTER TABLE accounting_accountingperiod DROP CONSTRAINT ledgify_period_no_overlap, DROP CONSTRAINT ledgify_period_dates')


class Migration(migrations.Migration):
    dependencies=[('accounting','0021_payment_correction_audit'),('sales','0012_phase2_allocation_dates'),('purchases','0013_phase2_allocation_dates'),('inventory','0005_alter_stockmovement_movement_type_and_more'),('payroll','0001_initial'),('fixed_assets','0001_initial'),('fx','0002_fxrevaluation_reversal_journal_and_more')]
    operations=[migrations.RunPython(forward,backward)]
