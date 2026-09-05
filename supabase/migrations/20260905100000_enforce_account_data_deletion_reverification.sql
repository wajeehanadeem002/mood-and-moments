create function public.clerk_session_has_strict_reverification()
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  factor_verification_age jsonb := auth.jwt() -> 'fva';
  first_factor_age numeric;
  second_factor_age numeric;
begin
  if factor_verification_age is null
    or jsonb_typeof(factor_verification_age) is distinct from 'array'
  then
    return false;
  end if;

  if jsonb_array_length(factor_verification_age) <> 2 then
    return false;
  end if;

  if jsonb_typeof(factor_verification_age -> 0) is distinct from 'number'
    or jsonb_typeof(factor_verification_age -> 1) is distinct from 'number'
  then
    return false;
  end if;

  begin
    first_factor_age := (factor_verification_age ->> 0)::numeric;
    second_factor_age := (factor_verification_age ->> 1)::numeric;
  exception
    when others then
      return false;
  end;

  if not (first_factor_age = -1 or first_factor_age >= 0)
    or not (second_factor_age = -1 or second_factor_age >= 0)
  then
    return false;
  end if;

  if first_factor_age = -1 and second_factor_age = -1 then
    return false;
  end if;

  if second_factor_age = -1 then
    return first_factor_age >= 0 and first_factor_age < 10;
  end if;

  return second_factor_age >= 0 and second_factor_age < 10;
end;
$$;

comment on function public.clerk_session_has_strict_reverification() is
  'Validates Clerk strict reverification from the signed JWT fva claim; not callable by application roles.';

revoke all on function public.clerk_session_has_strict_reverification()
  from public, anon, authenticated;

alter function public.begin_account_data_deletion()
  rename to begin_account_data_deletion_without_reverification;

alter function public.verify_and_finish_account_data_deletion(uuid)
  rename to verify_and_finish_account_data_deletion_without_reverification;

revoke all on function public.begin_account_data_deletion_without_reverification()
  from public, anon, authenticated;
revoke all on function public.verify_and_finish_account_data_deletion_without_reverification(uuid)
  from public, anon, authenticated;

comment on function public.begin_account_data_deletion_without_reverification() is
  'Privileged account-data deletion implementation; callable only through the strict-reverification wrapper.';
comment on function public.verify_and_finish_account_data_deletion_without_reverification(uuid) is
  'Privileged account-data deletion finalizer; callable only through the strict-reverification wrapper.';

create function public.begin_account_data_deletion()
returns table (
  operation_id uuid,
  deleted_moments integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_owner text := nullif(btrim(coalesce(auth.jwt() ->> 'sub', '')), '');
begin
  if caller_owner is null or coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' then
    raise insufficient_privilege using message = 'Authentication is required.';
  end if;

  if public.clerk_session_has_strict_reverification() is distinct from true then
    raise insufficient_privilege using message = 'Strict Clerk reverification is required.';
  end if;

  return query
  select deletion.operation_id, deletion.deleted_moments
  from public.begin_account_data_deletion_without_reverification() as deletion;
end;
$$;

create function public.verify_and_finish_account_data_deletion(
  requested_operation_id uuid
)
returns table (
  outcome text,
  remaining_moments integer,
  remaining_storage_objects integer,
  remaining_cleanup_authorizations integer,
  remaining_deletion_jobs integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_owner text := nullif(btrim(coalesce(auth.jwt() ->> 'sub', '')), '');
begin
  if caller_owner is null or coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' then
    raise insufficient_privilege using message = 'Authentication is required.';
  end if;

  if public.clerk_session_has_strict_reverification() is distinct from true then
    raise insufficient_privilege using message = 'Strict Clerk reverification is required.';
  end if;

  return query
  select
    verification.outcome,
    verification.remaining_moments,
    verification.remaining_storage_objects,
    verification.remaining_cleanup_authorizations,
    verification.remaining_deletion_jobs
  from public.verify_and_finish_account_data_deletion_without_reverification(
    requested_operation_id
  ) as verification;
end;
$$;

comment on function public.begin_account_data_deletion() is
  'Begins owner-scoped cloud data deletion after validating Clerk strict reverification from the signed JWT.';
comment on function public.verify_and_finish_account_data_deletion(uuid) is
  'Verifies and completes owner-scoped cloud data deletion after independently validating Clerk strict reverification.';

revoke all on function public.begin_account_data_deletion()
  from public, anon;
revoke all on function public.verify_and_finish_account_data_deletion(uuid)
  from public, anon;
grant execute on function public.begin_account_data_deletion()
  to authenticated;
grant execute on function public.verify_and_finish_account_data_deletion(uuid)
  to authenticated;
