# Migrations

## Historic Duplicate Prefixes (M1)

Two pairs of files share a numeric prefix:

| Files | Reason |
|-------|--------|
| `006_create_ons_table.sql` and `006_create_ons_table_safe.sql` | `_safe` was added as a safer rebuild after the original table creation |
| `007_add_ons_foreign_keys.sql` and `007_cleanup_inconsistent_ons_data.sql` | cleanup script was added after the FK migration to fix inconsistent data |

### Why they were NOT renamed

Supabase CLI tracks applied migrations by exact filename in `supabase_migrations.schema_migrations`.
Renaming a file that production has already applied causes the CLI to treat it as a new migration
and attempt to re-run it, which would fail (objects already exist) or corrupt state.

At the time of the M1 audit (May 2026), the Supabase project was not linked locally so
`supabase migration list --linked` could not be run to confirm whether these files are recorded
in production. Renaming without that confirmation is unsafe.

### What to do if you want to rename

1. Connect to prod: `supabase link --project-ref <ref>`
2. Run: `supabase migration list --linked`
3. If `006_create_ons_table_safe` and `007_cleanup_inconsistent_ons_data` do NOT appear in the
   output, it is safe to rename them to `006b_create_ons_table_safe.sql` and
   `007b_cleanup_inconsistent_ons_data.sql`.
4. If they DO appear, do not rename — leave this README as the only record.

### Sequencing intent

The intended execution order is:
```
006_create_ons_table.sql
006_create_ons_table_safe.sql  (rebuilds the table more safely)
007_add_ons_foreign_keys.sql
007_cleanup_inconsistent_ons_data.sql  (removes data inconsistencies before FK enforcement)
008_link_cash_movements_to_transactions.sql
...
```
