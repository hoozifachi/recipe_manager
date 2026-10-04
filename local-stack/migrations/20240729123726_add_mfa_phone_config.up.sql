do $$ begin
    alter type auth.factor_type add value 'phone';
exception
    when duplicate_object then null;
end $$;


alter table auth.mfa_factors add column if not exists phone text unique default null;
alter table auth.mfa_challenges add column if not exists otp_code text null;


create unique index if not exists unique_verified_phone_factor on auth.mfa_factors (user_id, phone);
