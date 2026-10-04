alter table auth.mfa_factors drop constraint if exists mfa_factors_phone_key;
do $$
begin
    -- if both indexes exist, it means that the schema_migrations table was truncated and the migrations had to be rerun
    if (
        select count(*) = 2
        from pg_indexes 
        where indexname in ('unique_verified_phone_factor', 'unique_phone_factor_per_user')
        and schemaname = 'auth'
    ) then
        execute 'drop index auth.unique_verified_phone_factor';
    end if;

    if exists (
         select 1
         from pg_indexes
         where indexname = 'unique_verified_phone_factor'
         and schemaname = 'auth'
    ) then
        execute 'alter index auth.unique_verified_phone_factor rename to unique_phone_factor_per_user';
    end if;
end $$;
