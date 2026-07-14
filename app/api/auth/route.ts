import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function POST(req: NextRequest) {
  const { email } = await req.json()

  if (!email || !email.endsWith('@cashea.app')) {
    return NextResponse.json({ error: 'Correo no valido' }, { status: 401 })
  }

  const lower = email.toLowerCase()

  const { data, error } = await supabaseAdmin
    .from('usuarios_autorizados')
    .select('*')
    .eq('email', lower)
    .single()

  // Usuario existente
  if (data) {
    if (data.activo === false) {
      return NextResponse.json({ error: 'Tu cuenta está desactivada. Contacta a un administrador.' }, { status: 403 })
    }
    return NextResponse.json({ usuario: data })
  }

  // Auto-registro: cualquier @cashea.app entra como rol base "Usuario" (sin permisos) hasta que un admin lo asigne
  const nombre = lower.replace('@cashea.app', '').replace(/[._]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())
  const { data: nuevo, error: insErr } = await supabaseAdmin
    .from('usuarios_autorizados')
    .insert({ email: lower, nombre, equipo: 'Usuario', activo: true, es_admin: false })
    .select()
    .single()

  if (insErr || !nuevo) {
    return NextResponse.json({ error: 'No se pudo registrar el usuario: ' + (insErr?.message || 'error desconocido') }, { status: 500 })
  }

  return NextResponse.json({ usuario: nuevo })
}
