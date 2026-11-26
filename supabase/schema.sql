-- TalentAI HR Intelligence Platform — Supabase Schema (Postgres + pgvector + Storage)
create extension if not exists vector;
create extension if not exists pgcrypto;

-- 1. User Profiles (linked 1:1 to auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  email text unique not null,
  is_hr boolean not null default false,
  department text not null default 'General',
  salary numeric(10, 2) default 50000.00,
  leave_balance integer not null default 10,
  attendance_score integer not null default 100,
  created_at timestamptz not null default now()
);

-- Automatically create a profile row when a new user signs up via Supabase Auth
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username, email, is_hr, department, salary, leave_balance, attendance_score)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'username'), ''), split_part(new.email, '@', 1)),
    new.email,
    false,
    'General',
    50000.00,
    10,
    100
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 2. Job Postings
create table if not exists public.job_postings (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  department text not null default 'Engineering',
  description text not null,
  required_skills text not null default 'Not specified',
  experience_years integer not null default 0,
  status text not null default 'draft'
    check (status in ('draft', 'screening', 'pending_approval', 'approved', 'completed')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. Candidates
create table if not exists public.candidates (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.job_postings(id) on delete cascade,
  name text not null default 'Unknown',
  email text,
  match_score double precision not null default 0.0,
  matched_skills text not null default '',
  interview_slot text not null default 'TBD',
  email_subject text not null default '',
  email_body text not null default '',
  resume_source text not null default '',
  resume_storage_path text not null default '',
  email_sent boolean not null default false,
  status text not null default 'email_drafted'
    check (status in ('shortlisted', 'email_drafted', 'email_sent', 'rejected')),
  created_at timestamptz not null default now()
);

-- 4. Resume Vector Chunks (pgvector, 768 dims for jina-embeddings-v2-base-en)
create table if not exists public.resume_chunks (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.job_postings(id) on delete cascade,
  source_file text not null,
  candidate_name text not null,
  candidate_email text not null default '',
  chunk_index integer not null,
  content text not null,
  embedding vector(768) not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_resume_chunks_job_id on public.resume_chunks(job_id);

create or replace function public.match_resume_chunks(
  query_embedding vector(768),
  match_job_id uuid,
  match_count int default 30
)
returns table (
  id uuid,
  source_file text,
  candidate_name text,
  candidate_email text,
  content text,
  similarity double precision
)
language sql stable
as $$
  select
    rc.id,
    rc.source_file,
    rc.candidate_name,
    rc.candidate_email,
    rc.content,
    1 - (rc.embedding <=> query_embedding) as similarity
  from public.resume_chunks rc
  where rc.job_id = match_job_id
  order by rc.embedding <=> query_embedding
  limit match_count;
$$;

-- 5. Knowledge Base: Policies & FAQs
create table if not exists public.company_policies (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  last_updated timestamptz not null default now()
);

create table if not exists public.faqs (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  answer text not null,
  created_at timestamptz not null default now()
);

-- 6. Performance Records
create table if not exists public.performance_records (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  employee_name text not null,
  employee_email text not null,
  department text not null default 'General',
  review_period text not null,
  kpi_data text not null,
  performance_score integer,
  kpi_achievement_percent double precision,
  strengths text,
  areas_for_improvement text,
  recommended_actions text,
  created_at timestamptz not null default now()
);

-- 7. Attendance Hardware Tap Logs & AI Reports
create table if not exists public.attendance_logs (
  id bigserial primary key,
  employee_id text not null,
  timestamp timestamptz not null default now(),
  device_type text not null default 'rfid_scanner',
  location text not null default 'Main Entrance',
  tap_type text not null check (tap_type in ('IN', 'OUT')),
  created_at timestamptz not null default now()
);

create table if not exists public.attendance_reports (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  employee_name text not null,
  total_hours double precision not null,
  leaves_taken integer not null,
  ai_score integer,
  ai_feedback text not null,
  created_at timestamptz not null default now()
);

-- 8. Storage bucket for resumes
insert into storage.buckets (id, name, public)
values ('hr-uploads', 'hr-uploads', false)
on conflict (id) do nothing;

-- 9. Row-Level Security (backend uses service_role key; profiles readable by owner)
alter table public.profiles enable row level security;
drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

alter table public.job_postings enable row level security;
alter table public.candidates enable row level security;
alter table public.resume_chunks enable row level security;
alter table public.company_policies enable row level security;
alter table public.faqs enable row level security;
alter table public.performance_records enable row level security;
alter table public.attendance_logs enable row level security;
alter table public.attendance_reports enable row level security;

-- Restrict vector search RPC to service_role only (FastAPI backend uses service_role key)
revoke execute on function public.match_resume_chunks(vector, uuid, int) from public, anon, authenticated;
grant execute on function public.match_resume_chunks(vector, uuid, int) to service_role;
