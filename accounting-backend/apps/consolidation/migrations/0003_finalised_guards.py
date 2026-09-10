from django.db import migrations

SQL = r'''
CREATE FUNCTION ledgify_consolidation_write_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pid uuid; state text; old_pid uuid; jid uuid;
BEGIN
 IF TG_TABLE_NAME='consolidation_eliminationjournalline' THEN
   IF TG_OP='DELETE' THEN jid=OLD.journal_id; ELSE jid=NEW.journal_id; END IF;
   SELECT period_id,status INTO pid,state FROM consolidation_eliminationjournal WHERE id=jid FOR UPDATE;
   IF state<>'draft' THEN RAISE EXCEPTION 'Posted elimination lines are immutable' USING ERRCODE='23514'; END IF;
   IF TG_OP='UPDATE' AND OLD.journal_id<>NEW.journal_id THEN RAISE EXCEPTION 'Elimination lines cannot be reparented' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='consolidation_consolidationsnapshotline' THEN
   IF TG_OP='DELETE' THEN jid=OLD.snapshot_id; ELSE jid=NEW.snapshot_id; END IF;
   SELECT period_id INTO pid FROM consolidation_consolidationsnapshot WHERE id=jid;
   IF TG_OP='UPDATE' AND OLD.snapshot_id<>NEW.snapshot_id THEN RAISE EXCEPTION 'Snapshot lines cannot be reparented' USING ERRCODE='23514'; END IF;
 ELSE
   IF TG_OP='DELETE' THEN pid=OLD.period_id; ELSE pid=NEW.period_id; END IF;
   IF TG_OP='UPDATE' AND OLD.period_id<>NEW.period_id THEN RAISE EXCEPTION 'Period ownership is immutable' USING ERRCODE='23514'; END IF;
 END IF;
 SELECT status INTO state FROM consolidation_consolidationperiod WHERE id=pid FOR UPDATE;
 IF state='finalised' THEN RAISE EXCEPTION 'Finalised consolidation period is immutable; authorised reopen required' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='consolidation_eliminationjournal' THEN
   IF TG_OP='DELETE' AND OLD.status<>'draft' THEN RAISE EXCEPTION 'Posted eliminations cannot be deleted' USING ERRCODE='23514'; END IF;
   IF TG_OP='UPDATE' AND OLD.status<>'draft' THEN
     IF (to_jsonb(OLD)-ARRAY['status','reversed_by_id','reversed_at']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['status','reversed_by_id','reversed_at']) OR
       (OLD.status<>NEW.status AND NOT (OLD.status='posted' AND NEW.status='reversed' AND EXISTS(SELECT 1 FROM consolidation_eliminationjournal WHERE reversal_of_id=OLD.id AND status='posted'))) THEN
       RAISE EXCEPTION 'Posted elimination is immutable' USING ERRCODE='23514';
     END IF;
   END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE FUNCTION ledgify_consolidation_period_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
   IF OLD.status='finalised' THEN RAISE EXCEPTION 'Finalised period cannot be deleted' USING ERRCODE='23514'; END IF;
   RETURN OLD;
 END IF;
 IF (OLD.group_id,OLD.start_date,OLD.end_date) IS DISTINCT FROM (NEW.group_id,NEW.start_date,NEW.end_date) THEN
   RAISE EXCEPTION 'Consolidation period boundaries are immutable' USING ERRCODE='23514';
 END IF;
 IF OLD.status='finalised' AND to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW) AND NOT (
    NEW.status='open' AND (to_jsonb(OLD)-'status')=(to_jsonb(NEW)-'status') AND EXISTS (
    SELECT 1 FROM consolidation_consolidationhistory WHERE period_id=OLD.id AND event='REOPENED'
      AND timestamp>=OLD.finalised_at AND length(trim(reason))>0)) THEN
   RAISE EXCEPTION 'Authorised reopen history is required' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION ledgify_consolidation_account_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(OLD)-ARRAY['display_order','status']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['display_order','status']) AND
   (EXISTS(SELECT 1 FROM consolidation_consolidationsnapshotline WHERE consolidation_account_id=OLD.id) OR
    EXISTS(SELECT 1 FROM consolidation_eliminationjournalline l JOIN consolidation_eliminationjournal j ON j.id=l.journal_id WHERE l.consolidation_account_id=OLD.id AND j.status IN ('posted','reversed'))) THEN
   RAISE EXCEPTION 'Consolidation account used in financial history is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ledgify_consolidation_account BEFORE UPDATE ON consolidation_consolidationaccount FOR EACH ROW EXECUTE FUNCTION ledgify_consolidation_account_guard();
CREATE FUNCTION ledgify_consolidation_group_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (OLD.reporting_currency_id,OLD.parent_organisation_id) IS DISTINCT FROM (NEW.reporting_currency_id,NEW.parent_organisation_id) AND EXISTS(SELECT 1 FROM consolidation_consolidationsnapshot WHERE group_id=OLD.id) THEN
   RAISE EXCEPTION 'Group reporting currency and parent cannot change after preparation' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ledgify_consolidation_group BEFORE UPDATE ON consolidation_consolidationgroup FOR EACH ROW EXECUTE FUNCTION ledgify_consolidation_group_guard();
CREATE TRIGGER ledgify_consolidation_period BEFORE UPDATE OR DELETE ON consolidation_consolidationperiod FOR EACH ROW EXECUTE FUNCTION ledgify_consolidation_period_guard();
CREATE TRIGGER ledgify_consolidation_history BEFORE UPDATE OR DELETE ON consolidation_consolidationhistory FOR EACH ROW EXECUTE FUNCTION ledgify_immutable_history();
'''
TABLES=['consolidation_eliminationjournal','consolidation_eliminationjournalline','consolidation_consolidationsnapshot','consolidation_consolidationsnapshotline']

def forward(apps,editor):
    if editor.connection.vendor!='postgresql':return
    editor.execute(SQL,params=None)
    for table in TABLES:editor.execute(f'CREATE TRIGGER ledgify_consolidation_write BEFORE INSERT OR UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION ledgify_consolidation_write_guard()')

def backward(apps,editor):
    if editor.connection.vendor!='postgresql':return
    for table in TABLES:editor.execute(f'DROP TRIGGER ledgify_consolidation_write ON {table}')
    editor.execute('DROP TRIGGER ledgify_consolidation_account ON consolidation_consolidationaccount; DROP TRIGGER ledgify_consolidation_group ON consolidation_consolidationgroup; DROP FUNCTION ledgify_consolidation_account_guard(); DROP FUNCTION ledgify_consolidation_group_guard(); DROP TRIGGER ledgify_consolidation_period ON consolidation_consolidationperiod; DROP TRIGGER ledgify_consolidation_history ON consolidation_consolidationhistory; DROP FUNCTION ledgify_consolidation_period_guard(); DROP FUNCTION ledgify_consolidation_write_guard();')

class Migration(migrations.Migration):
    dependencies=[('consolidation','0002_eliminationjournal_reversal_of_and_more'),('accounting','0022_source_and_period_guards')]
    operations=[migrations.RunPython(forward,backward)]
