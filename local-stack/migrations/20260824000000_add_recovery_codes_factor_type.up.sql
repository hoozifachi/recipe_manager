/* auth_migration: 20260824000000 */
do $$ begin
    alter type auth.factor_type add value 'recovery_code';
exception
    when duplicate_object then null;
end $$;
