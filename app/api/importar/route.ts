import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function POST(req: NextRequest) {
  const { solicitudes } = await req.json()

  if (!solicitudes || !Array.isArray(solicitudes)) {
    return NextResponse.json({ error: 'Datos invalidos' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('solicitudes')
    .upsert(solicitudes, { onConflict: 'id' })
    .select()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ insertadas: data?.length ?? 0 })
}
