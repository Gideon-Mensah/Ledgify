from importlib import import_module
from django.db import migrations

SQL = """
CREATE OR REPLACE FUNCTION ledgify_guard_account_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM ledgify_lock_ledger(OLD.organisation_id);
 IF EXISTS (SELECT 1 FROM accounting_journalline l JOIN accounting_journalentry j ON j.id=l.journal_entry_id
            WHERE l.account_id=OLD.id AND j.status IN ('posted','reversed')) THEN
   IF (OLD.organisation_id,OLD.account_type,OLD.currency) IS DISTINCT FROM
      (NEW.organisation_id,NEW.account_type,NEW.currency) THEN
     RAISE EXCEPTION 'Account type, organisation and currency used by posted history are immutable' USING ERRCODE='23514';
   END IF;
   IF OLD.account_class IS DISTINCT FROM NEW.account_class AND NOT EXISTS (
     SELECT 1 FROM accounting_accountclassificationevent e
      WHERE e.id::text=current_setting('ledgify.account_classification_event',true)
        AND e.account_id=OLD.id AND e.organisation_id=OLD.organisation_id
        AND e.before->>'account_class'=OLD.account_class AND e.after->>'account_class'=NEW.account_class
        AND e.before->>'account_type'=OLD.account_type AND e.after->>'account_type'=NEW.account_type
   ) THEN
     RAISE EXCEPTION 'Use the audited account classification workflow for posted accounts' USING ERRCODE='23514';
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ledgify_account_classification_history BEFORE UPDATE OR DELETE ON accounting_accountclassificationevent
 FOR EACH ROW EXECUTE FUNCTION ledgify_immutable_history();
"""

def forward(apps, editor):
    if editor.connection.vendor == 'postgresql': editor.execute(SQL, params=None)


def backward(apps, editor):
    if editor.connection.vendor != 'postgresql': return
    editor.execute('DROP TRIGGER ledgify_account_classification_history ON accounting_accountclassificationevent')
    original = import_module('apps.accounting.migrations.0022_source_and_period_guards').SQL
    function = original[original.index('CREATE FUNCTION ledgify_guard_account_history()'):original.index('CREATE TRIGGER ledgify_account_history')]
    editor.execute(function.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION', 1), params=None)


class Migration(migrations.Migration):
    dependencies = [('accounting', '0023_controlled_account_classification')]
    operations = [migrations.RunPython(forward, backward)]
