import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

const ROLES_VALIDOS = ['Usuario', 'Legal', 'MI', 'Activaciones', 'Comercial', 'Todos']

// Verifica que quien llama sea admin (autodeclarado por ahora; se blindará con auth real + RLS)
async function esAdmin(email: string) {
  if (!email) return false
  const { data } = await supabaseAdmin
    .from('usuarios_autorizados')
    .select('es_admin')
    .eq('email', email.toLowerCase())
    .single()
  return !!data?.es_admin
}

// Listar usuarios (solo admin)
export async function GET(req: NextRequest) {
  const callerEmail = req.nextUrl.searchParams.get('callerEmail') || ''
  if (!(await esAdmin(callerEmail))) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }
  const { data, error } = await supabaseAdmin
    .from('usuarios_autorizados')
    .select('*')
    .order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ usuarios: data })
}

// Actualizar rol / activo / es_admin de un usuario (solo admin) + registra en auditoría
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { callerEmail, targetId, equipo, activo, es_admin, tsLocal } = body

  if (!(await esAdmin(callerEmail))) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }
  if (equipo && !ROLES_VALIDOS.includes(equipo)) {
    return NextResponse.json({ error: 'Rol inválido' }, { status: 400 })
  }

  const { data: antes } = await supabaseAdmin
    .from('usuarios_autorizados').select('*').eq('id', targetId).single()
  if (!antes) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })

  const updates: any = {}
  if (equipo !== undefined) updates.equipo = equipo
  if (activo !== undefined) updates.activo = activo
  if (es_admin !== undefined) updates.es_admin = es_admin

  const { data, error } = await supabaseAdmin
    .from('usuarios_autorizados').update(updates).eq('id', targetId).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Auditoría del cambio de permisos
  const cambios: string[] = []
  if (equipo !== undefined && equipo !== antes.equipo) cambios.push(`rol ${antes.equipo} → ${equipo}`)
  if (activo !== undefined && activo !== antes.activo) cambios.push(`activo ${antes.activo} → ${activo}`)
  if (es_admin !== undefined && es_admin !== antes.es_admin) cambios.push(`admin ${antes.es_admin} → ${es_admin}`)
  if (cambios.length) {
    await supabaseAdmin.from('audit_log').insert({
      ts_local: tsLocal || '',
      usuario_email: callerEmail,
      usuario_rol: 'Admin',
      accion: 'cambiar_rol',
      solicitud_id: null,
      detalle: `${antes.email}: ${cambios.join(', ')}`,
    })
  }

  return NextResponse.json({ usuario: data })
}
