create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null check (role in ('admin', 'worker')),
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  serial text,
  order_id text not null,
  sku text,
  stone_weight text,
  stone_color text,
  stone_shape text,
  metal_color text,
  item_size text,
  status text not null default 'Pending' check (status in ('Pending', 'In Progress', 'Completed', 'Hold / Issue')),
  updated_by_name text default '-',
  updated_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.order_images (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  slot integer not null check (slot between 1 and 3),
  file_path text not null,
  file_name text not null,
  created_at timestamptz not null default now(),
  unique (order_id, slot)
);

create or replace function public.protect_worker_order_updates()
returns trigger
language plpgsql
security definer
as $$
declare
  current_role text;
begin
  select role into current_role from public.profiles where id = auth.uid();

  if current_role = 'worker' then
    if new.serial is distinct from old.serial
      or new.order_id is distinct from old.order_id
      or new.sku is distinct from old.sku
      or new.stone_weight is distinct from old.stone_weight
      or new.stone_color is distinct from old.stone_color
      or new.stone_shape is distinct from old.stone_shape
      or new.metal_color is distinct from old.metal_color
      or new.item_size is distinct from old.item_size
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at
    then
      raise exception 'Workers can update status only';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists protect_worker_order_updates on public.orders;
create trigger protect_worker_order_updates
before update on public.orders
for each row execute function public.protect_worker_order_updates();

insert into storage.buckets (id, name, public)
values ('order-images', 'order-images', false)
on conflict (id) do nothing;

alter table public.profiles enable row level security;
alter table public.orders enable row level security;
alter table public.order_images enable row level security;

create policy "Profiles are readable by signed in users"
on public.profiles for select
to authenticated
using (true);

create policy "Admins manage profiles"
on public.profiles for all
to authenticated
using ((select role from public.profiles where id = auth.uid()) = 'admin')
with check ((select role from public.profiles where id = auth.uid()) = 'admin');

create policy "Signed in users read orders"
on public.orders for select
to authenticated
using (true);

create policy "Admins insert orders"
on public.orders for insert
to authenticated
with check ((select role from public.profiles where id = auth.uid()) = 'admin');

create policy "Admins update orders"
on public.orders for update
to authenticated
using ((select role from public.profiles where id = auth.uid()) = 'admin')
with check ((select role from public.profiles where id = auth.uid()) = 'admin');

create policy "Workers update status fields"
on public.orders for update
to authenticated
using ((select role from public.profiles where id = auth.uid()) = 'worker')
with check ((select role from public.profiles where id = auth.uid()) = 'worker');

create policy "Admins delete orders"
on public.orders for delete
to authenticated
using ((select role from public.profiles where id = auth.uid()) = 'admin');

create policy "Signed in users read image rows"
on public.order_images for select
to authenticated
using (true);

create policy "Admins manage image rows"
on public.order_images for all
to authenticated
using ((select role from public.profiles where id = auth.uid()) = 'admin')
with check ((select role from public.profiles where id = auth.uid()) = 'admin');

create policy "Signed in users read storage images"
on storage.objects for select
to authenticated
using (bucket_id = 'order-images');

create policy "Admins upload storage images"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'order-images'
  and (select role from public.profiles where id = auth.uid()) = 'admin'
);

create policy "Admins update storage images"
on storage.objects for update
to authenticated
using (
  bucket_id = 'order-images'
  and (select role from public.profiles where id = auth.uid()) = 'admin'
);

create policy "Admins delete storage images"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'order-images'
  and (select role from public.profiles where id = auth.uid()) = 'admin'
);
