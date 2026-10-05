-- ============ helpers ============
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============ profiles ============
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============ projects ============
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_url text not null,
  title text,
  status text not null default 'created'
    check (status in ('created','queued','processing','completed','failed','cancelled')),
  settings jsonb not null default '{}'::jsonb,
  transcript jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_user_id_idx on public.projects (user_id);
create index projects_status_idx on public.projects (status);
create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- ============ jobs ============
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  status text not null default 'QUEUED'
    check (status in ('QUEUED','DOWNLOADING','TRANSCRIBING','ANALYZING','CLIPPING',
                      'CAPTIONS','RENDERING','UPLOADING','COMPLETED','FAILED','CANCELLED')),
  progress integer not null default 0 check (progress between 0 and 100),
  current_step text,
  error_code text,
  error_message text,
  attempts integer not null default 0,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jobs_project_id_idx on public.jobs (project_id);
create index jobs_status_idx on public.jobs (status);
create trigger jobs_set_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

-- ============ clips ============
-- output_url and thumbnail_url hold STORAGE PATHS; signed URLs are made at request time.
create table public.clips (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  start_time numeric(10,3) not null check (start_time >= 0),
  end_time numeric(10,3) not null,
  duration numeric(10,3) generated always as (end_time - start_time) stored,
  title text,
  hook text,
  score integer check (score between 0 and 100),
  reason text,
  selection_method text check (selection_method in ('llm','heuristic')),
  caption_settings jsonb not null default '{}'::jsonb,
  output_url text,
  thumbnail_url text,
  status text not null default 'pending'
    check (status in ('pending','rendering','completed','failed')),
  created_at timestamptz not null default now(),
  check (end_time > start_time)
);
create index clips_project_id_idx on public.clips (project_id);

-- ============ templates ============
create table public.templates (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  type text not null default 'caption' check (type in ('caption','motion')),
  config jsonb not null default '{}'::jsonb,
  is_system boolean not null default false,
  created_at timestamptz not null default now()
);

insert into public.templates (name, type, config, is_system) values
  ('Classic',   'caption', '{"fontSize":64,"position":"bottom","bold":false,"highlight":false,"animation":"none"}', true),
  ('Bold',      'caption', '{"fontSize":78,"position":"center","bold":true,"highlight":false,"animation":"pop"}', true),
  ('Highlight', 'caption', '{"fontSize":72,"position":"bottom","bold":true,"highlight":true,"animation":"word"}', true);

-- ============ processing_logs ============
create table public.processing_logs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  level text not null default 'info' check (level in ('debug','info','warn','error')),
  step text,
  message text not null,
  created_at timestamptz not null default now()
);
create index processing_logs_job_id_idx on public.processing_logs (job_id, created_at);

-- ============ Row Level Security ============
-- Mobile app can only READ its own data. All writes go through the API (service role).
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.jobs enable row level security;
alter table public.clips enable row level security;
alter table public.templates enable row level security;
alter table public.processing_logs enable row level security;

create policy "profiles select own" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "profiles update own" on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "projects select own" on public.projects
  for select to authenticated using (user_id = (select auth.uid()));

create policy "jobs select own" on public.jobs
  for select to authenticated using (
    exists (select 1 from public.projects p
            where p.id = jobs.project_id and p.user_id = (select auth.uid())));

create policy "clips select own" on public.clips
  for select to authenticated using (
    exists (select 1 from public.projects p
            where p.id = clips.project_id and p.user_id = (select auth.uid())));

create policy "logs select own" on public.processing_logs
  for select to authenticated using (
    exists (select 1 from public.jobs j
            join public.projects p on p.id = j.project_id
            where j.id = processing_logs.job_id and p.user_id = (select auth.uid())));

create policy "templates select all" on public.templates
  for select to authenticated using (true);

-- ============ Storage bucket (private, 50 MB per file) ============
insert into storage.buckets (id, name, public, file_size_limit)
values ('shorts', 'shorts', false, 52428800)
on conflict (id) do nothing;

-- Path layout: users/{userId}/projects/{projectId}/...
create policy "users read own files" on storage.objects
  for select to authenticated using (
    bucket_id = 'shorts'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = (select auth.uid())::text);