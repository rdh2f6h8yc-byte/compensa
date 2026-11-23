-- Compensa · base de datos (Supabase)
-- Perfiles, decisiones guardadas, ayudas para jóvenes y suscripciones de Apple.
-- Seguridad: cada usuario solo ve y toca lo suyo (RLS). Lo de pago (Pro) solo lo cambia el servidor.

create extension if not exists pgcrypto;

-- ---------- Perfiles ----------
create table if not exists public.perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  comunidad text not null default '',
  pro_hasta timestamptz,
  ia_gratis_usadas int not null default 0,
  ia_dia date,
  ia_hoy int not null default 0,
  ayudas_vistas timestamptz,
  creado timestamptz not null default now()
);
alter table public.perfiles enable row level security;
drop policy if exists "perfil propio" on public.perfiles;
create policy "perfil propio" on public.perfiles for select to authenticated using (id = auth.uid());
-- Sin políticas de insert/update/delete: se cambia solo con las funciones de abajo.

create or replace function public.crear_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfiles (id) values (new.id) on conflict do nothing;
  return new;
end $$;
drop trigger if exists al_crear_usuario on auth.users;
create trigger al_crear_usuario after insert on auth.users for each row execute function public.crear_perfil();

create or replace function public.es_pro(u uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select pro_hasta > now() from public.perfiles where id = u), false)
$$;

-- Datos de mi cuenta para la app
create or replace function public.mi_perfil() returns json
language plpgsql security definer set search_path = public as $$
declare p public.perfiles;
begin
  if auth.uid() is null then return null; end if;
  insert into public.perfiles (id) values (auth.uid()) on conflict do nothing;
  select * into p from public.perfiles where id = auth.uid();
  return json_build_object(
    'pro', coalesce(p.pro_hasta > now(), false),
    'pro_hasta', p.pro_hasta,
    'comunidad', p.comunidad,
    'ia_gratis', greatest(0, 3 - p.ia_gratis_usadas),
    'ayudas_vistas', p.ayudas_vistas,
    'decisiones', (select count(*) from public.decisiones where usuario = auth.uid())
  );
end $$;

create or replace function public.guardar_comunidad(p text) returns void
language sql security definer set search_path = public as $$
  update public.perfiles set comunidad = left(coalesce(p, ''), 40) where id = auth.uid()
$$;

create or replace function public.marcar_ayudas_vistas() returns void
language sql security definer set search_path = public as $$
  update public.perfiles set ayudas_vistas = now() where id = auth.uid()
$$;

-- IA: 3 explicaciones gratis por cuenta; con Pro, hasta p_max al día
create or replace function public.usar_ia(p_max int default 30) returns text
language plpgsql security definer set search_path = public as $$
declare p public.perfiles; hoy date := (now() at time zone 'Europe/Madrid')::date;
begin
  if auth.uid() is null then return 'sin_sesion'; end if;
  insert into public.perfiles (id) values (auth.uid()) on conflict do nothing;
  select * into p from public.perfiles where id = auth.uid() for update;
  if p.pro_hasta > now() then
    if p.ia_dia is distinct from hoy then
      update public.perfiles set ia_dia = hoy, ia_hoy = 1 where id = auth.uid();
      return 'ok';
    end if;
    if p.ia_hoy >= p_max then return 'limite'; end if;
    update public.perfiles set ia_hoy = ia_hoy + 1 where id = auth.uid();
    return 'ok';
  end if;
  if p.ia_gratis_usadas >= 3 then return 'gratis_agotado'; end if;
  update public.perfiles set ia_gratis_usadas = ia_gratis_usadas + 1 where id = auth.uid();
  return 'ok';
end $$;

-- ---------- Decisiones guardadas ----------
create table if not exists public.decisiones (
  id uuid primary key default gen_random_uuid(),
  usuario uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nombre text not null default 'Mi decisión' check (char_length(nombre) <= 60),
  datos jsonb not null default '{}'::jsonb check (pg_column_size(datos) < 20000),
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now()
);
create index if not exists decisiones_usuario on public.decisiones (usuario, actualizado desc);
alter table public.decisiones enable row level security;

-- Gratis: 1 decisión guardada. Pro: hasta 100.
create or replace function public.puede_guardar() returns boolean
language sql stable security definer set search_path = public as $$
  select (select count(*) from public.decisiones where usuario = auth.uid())
         < case when public.es_pro() then 100 else 1 end
$$;

drop policy if exists "ver mis decisiones" on public.decisiones;
drop policy if exists "crear decision" on public.decisiones;
drop policy if exists "cambiar mis decisiones" on public.decisiones;
drop policy if exists "borrar mis decisiones" on public.decisiones;
create policy "ver mis decisiones" on public.decisiones for select to authenticated using (usuario = auth.uid());
create policy "crear decision" on public.decisiones for insert to authenticated with check (usuario = auth.uid() and public.puede_guardar());
create policy "cambiar mis decisiones" on public.decisiones for update to authenticated using (usuario = auth.uid()) with check (usuario = auth.uid());
create policy "borrar mis decisiones" on public.decisiones for delete to authenticated using (usuario = auth.uid());

-- ---------- Ayudas para jóvenes (lectura pública; se editan desde el panel de Supabase) ----------
create table if not exists public.ayudas (
  id bigint generated always as identity primary key,
  tipo text not null check (tipo in ('alquiler', 'compra', 'otra')),
  ambito text not null default 'Estatal',   -- 'Estatal' o el nombre de la comunidad autónoma
  nombre text not null,
  importe text not null default '',
  quien text not null default '',
  donde text not null default '',
  plazo text not null default '',
  url text not null default '' check (url = '' or url like 'https://%'),
  plantilla text not null default 'solo',
  orden int not null default 100,
  activa boolean not null default true,
  revisada date not null default current_date,
  creada timestamptz not null default now()
);
alter table public.ayudas enable row level security;
drop policy if exists "ayudas publicas" on public.ayudas;
create policy "ayudas publicas" on public.ayudas for select to anon, authenticated using (activa);

insert into public.ayudas (tipo, ambito, nombre, importe, quien, donde, url, plantilla, orden, revisada)
select * from (values
  ('alquiler', 'Estatal', 'Bono Alquiler Joven', '250 €/mes durante 2 años',
   'De 18 a 35 años, ingresos de hasta 3 veces el IPREM (unos 25.200 € brutos al año) y alquiler de hasta 600 € (piso) o 300 € (habitación); hasta 900 € / 450 € en algunas zonas.',
   'Se pide en tu comunidad autónoma. Cada una abre su propia convocatoria.',
   'https://www.mivau.gob.es/vivienda/bono-alquiler-joven', 'solo', 10, date '2026-11-23'),
  ('compra', 'Estatal', 'Aval ICO primera vivienda', 'Hipoteca de hasta el 100 % del precio',
   'Jóvenes de hasta 35 años y familias con menores a cargo que pueden pagar la cuota pero no tienen ahorrado el 20 % de entrada.',
   'Se pide directamente en los bancos adheridos al pedir la hipoteca.',
   'https://www.ico.es/en/linea-avales-hipoteca-primera-vivienda', 'comprar', 20, date '2026-11-23')
) v(tipo, ambito, nombre, importe, quien, donde, url, plantilla, orden, revisada)
where not exists (select 1 from public.ayudas);

-- ---------- Suscripciones de Apple ----------
create table if not exists public.compras_apple (
  original text primary key,
  usuario uuid references auth.users(id) on delete set null,
  producto text not null default '',
  estado text not null default '',
  hasta timestamptz,
  entorno text not null default '',
  actualizado timestamptz not null default now()
);
alter table public.compras_apple enable row level security;
-- Sin políticas: solo el servidor (función «apple») la usa.

create or replace function public.registrar_apple(p_usuario uuid, p_original text, p_producto text,
  p_hasta timestamptz, p_estado text, p_entorno text) returns json
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  select usuario into u from public.compras_apple where original = p_original;
  u := coalesce(u, p_usuario);
  insert into public.compras_apple (original, usuario, producto, estado, hasta, entorno, actualizado)
  values (p_original, u, coalesce(p_producto, ''), coalesce(p_estado, ''), p_hasta, coalesce(p_entorno, ''), now())
  on conflict (original) do update set usuario = coalesce(public.compras_apple.usuario, excluded.usuario),
    producto = excluded.producto, estado = excluded.estado, hasta = excluded.hasta,
    entorno = excluded.entorno, actualizado = now();
  if u is not null and p_estado in ('active', 'expired', 'revoked') then
    update public.perfiles set pro_hasta = p_hasta where id = u;
  end if;
  return json_build_object('usuario', u, 'estado', p_estado, 'hasta', p_hasta);
end $$;
revoke all on function public.registrar_apple(uuid, text, text, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.registrar_apple(uuid, text, text, timestamptz, text, text) to service_role;

-- ---------- Borrar mi cuenta (obligatorio en la App Store) ----------
create or replace function public.borrar_mi_cuenta() returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then raise exception 'sin sesión'; end if;
  delete from auth.users where id = auth.uid();
end $$;

-- Permisos de las funciones para usuarios con sesión
revoke all on function public.mi_perfil() from public, anon;
revoke all on function public.guardar_comunidad(text) from public, anon;
revoke all on function public.marcar_ayudas_vistas() from public, anon;
revoke all on function public.usar_ia(int) from public, anon;
revoke all on function public.borrar_mi_cuenta() from public, anon;
grant execute on function public.mi_perfil() to authenticated;
grant execute on function public.guardar_comunidad(text) to authenticated;
grant execute on function public.marcar_ayudas_vistas() to authenticated;
grant execute on function public.usar_ia(int) to authenticated;
grant execute on function public.borrar_mi_cuenta() to authenticated;

-- Ajuste de permisos (es_pro solo se usa por dentro; puede_guardar lo necesitan las reglas de decisiones)
revoke all on function public.es_pro(uuid) from public, anon, authenticated;
revoke all on function public.puede_guardar() from public, anon;
grant execute on function public.puede_guardar() to authenticated;
revoke all on function public.crear_perfil() from public, anon, authenticated;
