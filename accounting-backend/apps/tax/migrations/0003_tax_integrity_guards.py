"""PostgreSQL enforces tenant references, immutable history and nonoverlapping windows."""
from django.db import migrations

IMMUTABLE=['documenttaxsnapshot','documentlinetaxsnapshot','taxconfigurationaudit','taxaccountmapping',
    'organisationtaxregistration','taxclassification','taxfilingevidence','taxadjustment','taxpayment','withholdingtransaction','taxexport','evatcertification','taxregimeversion']

SQL=r'''
CREATE FUNCTION ledgify_tax_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Tax snapshots, mappings, published presets and audit history are immutable'; END; $$;
CREATE FUNCTION ledgify_tax_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Tax versions cannot be deleted; retire prospectively'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ledgify-ledger:'||NEW.organisation_id::text,0));
 IF TG_OP='UPDATE' AND (OLD.status <> 'DRAFT' OR OLD.activated_at IS NOT NULL) AND
   (to_jsonb(NEW)-ARRAY['status','approved_by_id','approved_at','activated_at']) IS DISTINCT FROM
   (to_jsonb(OLD)-ARRAY['status','approved_by_id','approved_at','activated_at']) THEN
   RAISE EXCEPTION 'Approved tax version content is immutable';
 END IF;
 IF NEW.status IN ('ACTIVE','SCHEDULED','SUPERSEDED') AND
   (NEW.approved_by_id IS NULL OR NEW.approved_at IS NULL OR NEW.activated_at IS NULL) THEN
   RAISE EXCEPTION 'Tax activation requires approval and activation history';
 END IF;
 RETURN NEW;
END; $$;
CREATE FUNCTION ledgify_tax_profile_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Tax profiles cannot be deleted'; END IF;
 IF OLD.status <> 'DRAFT' AND (to_jsonb(NEW)-ARRAY['status','reviewed_by_id','activated_at']) IS DISTINCT FROM
   (to_jsonb(OLD)-ARRAY['status','reviewed_by_id','activated_at']) THEN
   RAISE EXCEPTION 'Reviewed tax profiles are immutable';
 END IF;
 RETURN NEW;
END; $$;
CREATE FUNCTION ledgify_tax_return_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Tax return history cannot be deleted'; END IF;
 IF (to_jsonb(NEW)-ARRAY['status','approved_by_id','approved_at']) IS DISTINCT FROM
   (to_jsonb(OLD)-ARRAY['status','approved_by_id','approved_at']) THEN
   RAISE EXCEPTION 'Return snapshots are immutable; prepare another revision';
 END IF;
 IF OLD.status IN ('APPROVED','EXPORTED','FILED','PAID') AND
   NEW.status NOT IN ('APPROVED','EXPORTED','FILED','PAID') THEN
   RAISE EXCEPTION 'An approved return cannot become an editable draft';
 END IF;
 RETURN NEW;
END; $$;
CREATE FUNCTION ledgify_tax_legacy_rate_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM tax_taxtransaction WHERE tax_rate_id=OLD.id) OR
    EXISTS(SELECT 1 FROM tax_taxaccountmapping WHERE legacy_rate_id=OLD.id) THEN
   IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Used tax rate cannot be deleted'; END IF;
   IF (to_jsonb(NEW)-ARRAY['status','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','updated_at']) THEN
     RAISE EXCEPTION 'Used tax rate is immutable; create an effective-dated version';
   END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $$;
CREATE FUNCTION ledgify_tax_window_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Tax activation windows cannot be deleted'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ledgify-ledger:'||NEW.organisation_id::text,0));
 IF TG_OP='UPDATE' THEN
   IF (to_jsonb(NEW)-'end') IS DISTINCT FROM (to_jsonb(OLD)-'end') OR OLD."end" IS NOT NULL THEN
     RAISE EXCEPTION 'Only an open-ended activation window can be closed prospectively';
   END IF;
   IF EXISTS(SELECT 1 FROM accounting_journalentry WHERE organisation_id=NEW.organisation_id
       AND date>NEW."end" AND status IN ('posted','reversed')) THEN
     RAISE EXCEPTION 'Tax window change conflicts with posted history';
   END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE FUNCTION ledgify_tax_period_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status IN ('FILED','LOCKED') THEN
   IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Filed/locked tax periods cannot be deleted'; END IF;
   IF NEW.start_date<>OLD.start_date OR NEW.end_date<>OLD.end_date OR NEW.organisation_id<>OLD.organisation_id THEN
     RAISE EXCEPTION 'Filed/locked period boundaries cannot change';
   END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $$;
CREATE FUNCTION ledgify_tax_posting_period_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='posted' AND OLD.status='draft' AND EXISTS(
     SELECT 1 FROM tax_taxperiod WHERE organisation_id=NEW.organisation_id
     AND start_date<=NEW.date AND end_date>=NEW.date AND status IN ('FILED','LOCKED'))
   AND EXISTS(SELECT 1 FROM accounting_journalline l WHERE l.journal_entry_id=NEW.id AND
     (l.account_id IN (SELECT account_id FROM tax_taxaccountmapping WHERE organisation_id=NEW.organisation_id)
      OR l.account_id IN (SELECT input_tax_account_id FROM tax_taxrate WHERE organisation_id=NEW.organisation_id)
      OR l.account_id IN (SELECT output_tax_account_id FROM tax_taxrate WHERE organisation_id=NEW.organisation_id))) THEN
   RAISE EXCEPTION 'Tax posting belongs to an approved/filed tax period; adjust in an open period';
 END IF;
 RETURN NEW;
END; $$;
'''


def install(apps,editor):
    if editor.connection.vendor!='postgresql':return
    editor.execute(SQL,params=None)
    for table in IMMUTABLE+['taxtransaction']:
        editor.execute(f'CREATE TRIGGER ledgify_tax_immutable BEFORE UPDATE OR DELETE ON tax_{table} FOR EACH ROW EXECUTE FUNCTION ledgify_tax_immutable()')
    for table,function,events in [('taxrateversion','version','INSERT OR UPDATE OR DELETE'),('organisationtaxprofile','profile','UPDATE OR DELETE'),('taxreturndraft','return','UPDATE OR DELETE'),('taxrate','legacy_rate','UPDATE OR DELETE'),('taxapplicabilityrule','window','INSERT OR UPDATE OR DELETE'),('taxperiod','period','UPDATE OR DELETE')]:
        editor.execute(f'CREATE TRIGGER ledgify_tax_{function}_guard BEFORE {events} ON tax_{table} FOR EACH ROW EXECUTE FUNCTION ledgify_tax_{function}_guard()')
    editor.execute("ALTER TABLE tax_taxapplicabilityrule ADD CONSTRAINT tax_activation_windows_no_overlap EXCLUDE USING gist (organisation_id WITH =, code_id WITH =, daterange(start,\"end\",'[]') WITH &&)")
    editor.execute('CREATE TRIGGER ledgify_tax_posting_period_guard BEFORE UPDATE ON accounting_journalentry FOR EACH ROW EXECUTE FUNCTION ledgify_tax_posting_period_guard()')
    # Validate every organisation-owned FK, including less visible evidence/calendar APIs.
    for model in apps.get_app_config('tax').get_models():
        fields={f.name:f for f in model._meta.fields}
        if 'organisation' not in fields:continue
        checks=[]
        for field in model._meta.fields:
            related=getattr(field,'related_model',None)
            if not related or not any(f.name=='organisation' for f in related._meta.fields):continue
            checks.append(f"IF NEW.{field.column} IS NOT NULL AND NOT EXISTS(SELECT 1 FROM {related._meta.db_table} WHERE id=NEW.{field.column} AND organisation_id=NEW.organisation_id) THEN RAISE EXCEPTION 'Cross-organisation tax reference rejected'; END IF;")
        if not checks:continue
        function='ledgify_scope_'+model._meta.db_table
        editor.execute(f'CREATE FUNCTION {function}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN '+''.join(checks)+' RETURN NEW; END; $$;',params=None)
        editor.execute(f'CREATE TRIGGER {function} BEFORE INSERT OR UPDATE ON {model._meta.db_table} FOR EACH ROW EXECUTE FUNCTION {function}()')


def remove(apps,editor):
    if editor.connection.vendor!='postgresql':return
    editor.execute('DROP TRIGGER ledgify_tax_posting_period_guard ON accounting_journalentry')
    editor.execute('ALTER TABLE tax_taxapplicabilityrule DROP CONSTRAINT tax_activation_windows_no_overlap')
    for model in apps.get_app_config('tax').get_models():
        editor.execute(f'DROP FUNCTION IF EXISTS ledgify_scope_{model._meta.db_table}() CASCADE')
    for name in ['immutable','version_guard','profile_guard','return_guard','legacy_rate_guard','window_guard','period_guard','posting_period_guard']:
        editor.execute(f'DROP FUNCTION IF EXISTS ledgify_tax_{name}() CASCADE')


class Migration(migrations.Migration):
    dependencies=[('tax','0002_taxtransaction_component_snapshot_and_more'),('accounting','0022_source_and_period_guards'),('sales','0015_customercreditnoteline_tax_snapshot_and_more'),('purchases','0015_billline_tax_snapshot_and_more')]
    operations=[migrations.RunPython(install,remove)]
