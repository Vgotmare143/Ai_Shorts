create or replace function public.claim_next_job()
returns setof public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  picked uuid;
begin
  select id into picked
  from public.jobs
  where status = 'QUEUED'
  order by created_at
  limit 1
  for update skip locked;

  if picked is null then
    return;
  end if;

  return query
  update public.jobs
  set status = 'DOWNLOADING',
      current_step = 'Starting',
      progress = 1,
      locked_at = now(),
      attempts = attempts + 1,
      error_code = null,
      error_message = null
  where id = picked
  returning *;
end;
$$;

revoke all on function public.claim_next_job() from public, anon, authenticated;
grant execute on function public.claim_next_job() to service_role;