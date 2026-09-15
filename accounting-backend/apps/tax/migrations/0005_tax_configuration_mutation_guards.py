from django.db import migrations

SQL = """
CREATE FUNCTION ledgify_tax_code_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM tax_taxrateversion WHERE code_id=OLD.id) THEN
  RAISE EXCEPTION 'A versioned tax code cannot be edited or deleted; create a new code/version';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER ledgify_tax_code_guard BEFORE UPDATE OR DELETE ON tax_taxcode
 FOR EACH ROW EXECUTE FUNCTION ledgify_tax_code_guard();
CREATE FUNCTION ledgify_tax_reopen_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status IN ('LOCKED','FILED') AND NEW.status NOT IN ('LOCKED','FILED') AND
 EXISTS(SELECT 1 FROM tax_taxreturndraft WHERE period_id=OLD.id AND status IN ('APPROVED','EXPORTED','FILED','PAID')) THEN
  RAISE EXCEPTION 'An approved return prevents reopening; use an open-period adjustment';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER ledgify_tax_reopen_guard BEFORE UPDATE ON tax_taxperiod
 FOR EACH ROW EXECUTE FUNCTION ledgify_tax_reopen_guard();
"""

def install(apps,editor):
    if editor.connection.vendor=='postgresql':editor.execute(SQL,params=None)

def remove(apps,editor):
    if editor.connection.vendor=='postgresql':
        editor.execute('DROP FUNCTION ledgify_tax_code_guard() CASCADE; DROP FUNCTION ledgify_tax_reopen_guard() CASCADE;')

class Migration(migrations.Migration):
    dependencies=[('tax','0004_alter_taxrate_rate_and_more')]
    operations=[migrations.RunPython(install,remove)]
