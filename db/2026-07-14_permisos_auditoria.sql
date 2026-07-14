-- ============================================================
-- Migración: gestión de permisos desde la app + auditoría
-- Correr en Supabase (SQL Editor) ANTES de desplegar el código.
-- ============================================================

-- 1) Columnas nuevas en usuarios_autorizados
alter table usuarios_autorizados add column if not exists es_admin  boolean     not null default false;
alter table usuarios_autorizados add column if not exists created_at timestamptz not null default now();
alter table usuarios_autorizados alter column equipo set default 'Usuario';

-- 2) Quitar cualquier CHECK que limite los valores de 'equipo'
--    (los roles válidos se validan en la app/API; así 'Usuario' y 'Comercial' son aceptados)
do $$
declare c record;
begin
  for c in
    select conname, pg_get_constraintdef(oid) as def
    from pg_constraint
    where conrelid = 'usuarios_autorizados'::regclass and contype = 'c'
  loop
    if position('equipo' in c.def) > 0 then
      execute format('alter table usuarios_autorizados drop constraint %I', c.conname);
    end if;
  end loop;
end $$;

-- 3) Tabla de auditoría (append-only desde la app vía service role)
create table if not exists audit_log (
  id             bigint generated always as identity primary key,
  ts             timestamptz not null default now(),  -- UTC del servidor
  ts_local       text,                                -- fecha/hora en hora de Venezuela (America/Caracas)
  usuario_email  text not null,
  usuario_rol    text,
  accion         text not null,   -- mover_etapa | mover_masivo | bloquear | desbloquear | reabrir | crear_solicitud | editar_solicitud | cambiar_rol
  solicitud_id   text,
  etapa_anterior text,
  etapa_nueva    text,
  detalle        text
);
create index if not exists idx_audit_log_id        on audit_log (id desc);
create index if not exists idx_audit_log_solicitud on audit_log (solicitud_id);

-- 4) Sembrar al usuario maestro/admin (ajusta el correo si hace falta)
update usuarios_autorizados
  set es_admin = true, equipo = 'Todos', activo = true
  where email = 'danielaz@cashea.app';

insert into usuarios_autorizados (email, nombre, equipo, activo, es_admin)
  select 'danielaz@cashea.app', 'Daniela', 'Todos', true, true
  where not exists (select 1 from usuarios_autorizados where email = 'danielaz@cashea.app');

-- ============================================================
-- PENDIENTE (fase de blindaje, cuando ciberseguridad dé requisitos):
--   * Row Level Security en solicitudes / audit_log / usuarios_autorizados
--   * audit_log solo-INSERT (nadie puede editar/borrar registros)
--   * Autenticación real (SSO) para que la identidad del log sea verificable
-- ============================================================
