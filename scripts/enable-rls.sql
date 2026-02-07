DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT table_schema, table_name, column_name
    FROM information_schema.columns
    WHERE column_name = 'tenantId'
      AND table_schema = 'public'
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', r.table_schema, r.table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I.%I', r.table_schema, r.table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I.%I USING (current_setting(''app.is_superadmin'', true) = ''true'' OR current_setting(''app.tenant_id'', true) = %I)',
      r.table_schema,
      r.table_name,
      r.column_name
    );
  END LOOP;
END $$;
