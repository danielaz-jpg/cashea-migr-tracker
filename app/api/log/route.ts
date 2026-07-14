import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// Registrar un evento de auditoría (append-only vía service role)
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { ts_local, usuario_email, usuario_rol, accion, solicitud_id, etapa_anterior, etapa_nueva, detalle } = body

  if (!accion || !usuario_email) {
    return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 })
  }

  const { error } = await supabaseAdmin.from('audit_log').insert({
    ts_local: ts_local || '',
    usuario_email,
    usuario_rol: usuario_rol || '',
    accion,
    solicitud_id: solicitud_id ?? null,
    etapa_anterior: etapa_anterior ?? null,
    etapa_nueva: etapa_nueva ?? null,
    detalle: detalle ?? null,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// Listar auditoría (solo admin). Filtros opcionales: solicitud_id, accion.
export async function GET(req: NextRequest) {
  const callerEmail = req.nextUrl.searchParams.get('callerEmail') || ''
  const { data: caller } = await supabaseAdmin
    .from('usuarios_autorizados').select('es_admin').eq('email', callerEmail.toLowerCase()).single()
  if (!caller?.es_admin) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }

  const { data, error } = await supabaseAdmin
    .from('audit_log')
    .select('*')
    .order('id', { ascending: false })
    .limit(1000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ logs: data })
}
