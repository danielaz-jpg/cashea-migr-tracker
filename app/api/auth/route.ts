import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function POST(req: NextRequest) {
  const { email } = await req.json()

  if (!email || !email.endsWith('@cashea.app')) {
    return NextResponse.json({ error: 'Correo no valido' }, { status: 401 })
  }

  const { data, error } = await supabaseAdmin
    .from('usuarios_autorizados')
    .select('*')
    .eq('email', email.toLowerCase())
    .eq('activo', true)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Usuario no autorizado' }, { status: 403 })
  }

  return NextResponse.json({ usuario: data })
}
