"""Protect ledger history and coordinate period writes even outside the ORM."""
from django.db import migrations

SQL = r'''
CREATE FUNCTION ledgify_lock_ledger(org uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('ledgify-ledger:' || org::text, 0));
END $$;

CREATE FUNCTION ledgify_guard_journal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n integer; open_n integer; d numeric; c numeric; line_n integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'Posted journals cannot be deleted' USING ERRCODE='23514'; END IF;
    RETURN OLD;
  END IF;
  PERFORM ledgify_lock_ledger(NEW.organisation_id);
  IF TG_OP = 'INSERT' AND NEW.status <> 'draft' THEN
    RAISE EXCEPTION 'Create a draft and use the posting workflow' USING ERRCODE='23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('posted','reversed') THEN
    IF (to_jsonb(NEW) - ARRAY['status','updated_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','updated_at']) THEN
      RAISE EXCEPTION 'Posted journal headers are immutable' USING ERRCODE='23514';
    END IF;
    IF NEW.status <> OLD.status THEN
      IF NOT (OLD.status='posted' AND NEW.status='reversed' AND EXISTS (
          SELECT 1 FROM accounting_journalentry j WHERE j.reversal_of_id=OLD.id AND j.status='posted')) THEN
        RAISE EXCEPTION 'A posted reversal is required' USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status='draft' AND NEW.status='posted' THEN
    SELECT count(*),count(*) FILTER (WHERE status='open') INTO n,open_n
      FROM accounting_accountingperiod WHERE organisation_id=NEW.organisation_id
        AND start_date<=NEW.date AND end_date>=NEW.date;
    IF n<>1 OR open_n<>1 OR EXISTS (SELECT 1 FROM accounting_financialyear WHERE organisation_id=NEW.organisation_id
        AND status='closed' AND start_date<=NEW.date AND end_date>=NEW.date) THEN
      RAISE EXCEPTION 'Posting requires exactly one open period and no closed financial year' USING ERRCODE='23514';
    END IF;
    SELECT count(*),coalesce(sum(debit),0),coalesce(sum(credit),0) INTO line_n,d,c
      FROM accounting_journalline WHERE journal_entry_id=NEW.id;
    IF line_n<2 OR d<=0 OR d<>c OR EXISTS (
      SELECT 1 FROM accounting_journalline l JOIN accounting_account a ON a.id=l.account_id
      WHERE l.journal_entry_id=NEW.id AND (a.organisation_id<>NEW.organisation_id OR a.status<>'active')) THEN
      RAISE EXCEPTION 'Journal must balance with active organisation accounts' USING ERRCODE='23514';
    END IF;
    IF NEW.reversal_of_id IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM accounting_journalentry j WHERE j.id=NEW.reversal_of_id
          AND j.organisation_id=NEW.organisation_id AND j.status='posted' AND j.date<=NEW.date)
        OR EXISTS (
          (SELECT account_id,description,debit,credit FROM accounting_journalline WHERE journal_entry_id=NEW.id
           EXCEPT ALL SELECT account_id,'Reversal: '||description,credit,debit FROM accounting_journalline WHERE journal_entry_id=NEW.reversal_of_id)
          UNION ALL
          (SELECT account_id,'Reversal: '||description,credit,debit FROM accounting_journalline WHERE journal_entry_id=NEW.reversal_of_id
           EXCEPT ALL SELECT account_id,description,debit,credit FROM accounting_journalline WHERE journal_entry_id=NEW.id)
        ) THEN RAISE EXCEPTION 'Reversal must exactly offset its original journal' USING ERRCODE='23514'; END IF;
    END IF;
  ELSIF TG_OP='UPDATE' AND OLD.status='draft' AND NEW.status<>'draft' THEN
    RAISE EXCEPTION 'Invalid draft transition' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ledgify_journal_guard BEFORE INSERT OR UPDATE OR DELETE ON accounting_journalentry
  FOR EACH ROW EXECUTE FUNCTION ledgify_guard_journal();

CREATE FUNCTION ledgify_guard_journal_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p accounting_journalentry%ROWTYPE; parent_ids uuid[];
BEGIN
  IF TG_OP='INSERT' THEN parent_ids=ARRAY[NEW.journal_entry_id];
  ELSIF TG_OP='DELETE' THEN parent_ids=ARRAY[OLD.journal_entry_id];
  ELSE parent_ids=ARRAY[OLD.journal_entry_id,NEW.journal_entry_id]; END IF;
  FOR p IN SELECT * FROM accounting_journalentry WHERE id=ANY(parent_ids) ORDER BY id FOR UPDATE LOOP
    IF p.status<>'draft' THEN RAISE EXCEPTION 'Posted journal lines are immutable' USING ERRCODE='23514'; END IF;
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF NOT EXISTS (SELECT 1 FROM accounting_account a JOIN accounting_journalentry j ON j.id=NEW.journal_entry_id
      WHERE a.id=NEW.account_id AND a.organisation_id=j.organisation_id) THEN
    RAISE EXCEPTION 'Journal line account must belong to its organisation' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ledgify_journal_line_guard BEFORE INSERT OR UPDATE OR DELETE ON accounting_journalline
  FOR EACH ROW EXECUTE FUNCTION ledgify_guard_journal_line();

CREATE FUNCTION ledgify_guard_period() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    PERFORM ledgify_lock_ledger(OLD.organisation_id);
    IF EXISTS (SELECT 1 FROM accounting_journalentry WHERE organisation_id=OLD.organisation_id AND date BETWEEN OLD.start_date AND OLD.end_date)
       OR EXISTS (SELECT 1 FROM accounting_accountingperiodhistory WHERE accounting_period_id=OLD.id) THEN
      RAISE EXCEPTION 'Periods with ledger or audit history cannot be deleted' USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;
  PERFORM ledgify_lock_ledger(NEW.organisation_id);
  IF TG_OP='UPDATE' AND (OLD.organisation_id<>NEW.organisation_id OR OLD.start_date<>NEW.start_date OR OLD.end_date<>NEW.end_date) THEN
    RAISE EXCEPTION 'Period ownership and boundaries are immutable' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM accounting_accountingperiod WHERE organisation_id=NEW.organisation_id AND id<>NEW.id
      AND start_date<=NEW.end_date AND end_date>=NEW.start_date) THEN
    RAISE EXCEPTION 'Accounting periods cannot overlap' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND OLD.status<>NEW.status AND NOT EXISTS (
      SELECT 1 FROM accounting_accountingperiodhistory WHERE accounting_period_id=NEW.id AND organisation_id=NEW.organisation_id
        AND performed_at>=OLD.updated_at AND ((NEW.status='open' AND action='reopened' AND length(trim(reason))>0)
          OR (NEW.status='locked' AND action='locked'))) THEN
    RAISE EXCEPTION 'Period changes require durable actor and reason history' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ledgify_period_guard BEFORE INSERT OR UPDATE OR DELETE ON accounting_accountingperiod
  FOR EACH ROW EXECUTE FUNCTION ledgify_guard_period();

CREATE FUNCTION ledgify_immutable_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Audit history is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER ledgify_period_history_guard BEFORE UPDATE OR DELETE ON accounting_accountingperiodhistory
  FOR EACH ROW EXECUTE FUNCTION ledgify_immutable_history();
'''

REVERSE = '''
DROP TRIGGER IF EXISTS ledgify_period_history_guard ON accounting_accountingperiodhistory;
DROP TRIGGER IF EXISTS ledgify_period_guard ON accounting_accountingperiod;
DROP TRIGGER IF EXISTS ledgify_journal_line_guard ON accounting_journalline;
DROP TRIGGER IF EXISTS ledgify_journal_guard ON accounting_journalentry;
DROP FUNCTION IF EXISTS ledgify_immutable_history();
DROP FUNCTION IF EXISTS ledgify_guard_period();
DROP FUNCTION IF EXISTS ledgify_guard_journal_line();
DROP FUNCTION IF EXISTS ledgify_guard_journal();
DROP FUNCTION IF EXISTS ledgify_lock_ledger(uuid);
'''


def forward(apps,schema_editor):
    if schema_editor.connection.vendor=='postgresql':schema_editor.execute(SQL, params=None)


def backward(apps,schema_editor):
    if schema_editor.connection.vendor=='postgresql':schema_editor.execute(REVERSE, params=None)


class Migration(migrations.Migration):
    dependencies=[('accounting','0019_phase2_integrity')]
    operations=[migrations.RunPython(forward,backward)]
