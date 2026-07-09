'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Solicitud, Rol, UsuarioAutorizado, Etapa, Incidencia } from '@/lib/types'

// ── Constantes ──────────────────────────────────────────────────
const STAGES = [
  { id: 'Nuevo',                           label: 'Nuevo',                  color: '#2563EB', cls: 's-nuevo'    },
  { id: 'Enviando contrato',               label: 'Enviando contrato',      color: '#EA580C', cls: 's-cenv'     },
  { id: 'Firma de contrato',               label: 'Firma de contrato',      color: '#7C3AED', cls: 's-cfirm'    },
  { id: 'Revision de Entidad Legal en ABM',label: 'Revision Entidad Legal', color: '#B45309', cls: 's-entidad'  },
  { id: 'Configuracion de ODOO',           label: 'Config. ODOO & ServTech',color: '#0D9488', cls: 's-odoo'    },
  { id: 'Solicitud resuelta',              label: 'Solicitud resuelta',     color: '#16A34A', cls: 's-resuelto' },
  { id: 'Bloqueado',                       label: 'Bloqueado',              color: '#DC2626', cls: 's-bloqueado'},
] as const

const ROLE_STAGES: Record<Rol, string[]> = {
  Legal:       ['Nuevo','Enviando contrato','Firma de contrato','Bloqueado'],
  MI:          ['Revision de Entidad Legal en ABM','Bloqueado'],
  Activaciones:['Configuracion de ODOO','Solicitud resuelta','Bloqueado'],
  Todos:       STAGES.map(s => s.id),
}

const TS_MAP: Record<string, keyof Solicitud> = {
  'Enviando contrato':                'ts_contrato_enviado',
  'Firma de contrato':                'ts_contrato_firmado',
  'Revision de Entidad Legal en ABM': 'ts_entidad_validada',
  'Configuracion de ODOO':            'ts_odoo_configurado',
  'Solicitud resuelta':               'ts_resuelto',
}

const STAGE_ORDER = [
  'Nuevo','Enviando contrato','Firma de contrato',
  'Revision de Entidad Legal en ABM','Configuracion de ODOO','Solicitud resuelta'
]

const RAZONES_BLOQUEO = [
  'Sin respuesta del solicitante-ABM','Listado de tiendas inconsistente-ABM',
  'RIF vs. RS no coincide-ABM','Razon social incorrecta','Ya es lending',
  'Aliado ya esta en lending','Ticket duplicado','Aliado desistio de migrar',
  'En separacion de razon social','Pend modificacion de lending fee',
  'Tipo de linea incorrecto','Contrato base vencido',
]

const CATEGORIAS_INCIDENCIA = [
  'Tipo de linea incorrecto (LP/LC/Ambas)',
  'Comision mal configurada (lending fee)',
  'Error en entidad legal / razon social',
  'Metodo de pago mal asignado',
  'ServTech mal configurado',
  'Canal de venta incorrecto',
  'Tienda no habilitada en ABM',
  'Otro',
]

// ── Helpers ─────────────────────────────────────────────────────
function today() { return new Date().toISOString().slice(0, 10) }
function daysBetween(a: string, b: string) {
  if (!a || !b) return null
  return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86400000)
}
function stageAge(s: Solicitud) {
  const k = s.etapa_actual === 'Nuevo' ? 'ts_nuevo' : (TS_MAP[s.etapa_actual] ?? '')
  return k ? daysBetween(s[k as keyof Solicitud] as string, today()) : null
}
function pipelineAge(s: Solicitud) { return daysBetween(s.ts_nuevo, today()) }
function initials(email: string) {
  return email.replace('@cashea.app','').split(/[\s.]/).map(w=>w[0]).join('').slice(0,2).toUpperCase()
}
function stageBadge(st: typeof STAGES[number]) {
  return (
    <span style={{display:'inline-flex',alignItems:'center',gap:4,padding:'3px 8px',
      borderRadius:20,fontSize:10,fontWeight:600,
      background:st.color+'22',color:st.color}}>
      <span style={{width:5,height:5,borderRadius:'50%',background:st.color}}/>
      {st.label}
    </span>
  )
}
function genId(existing: Solicitud[]) {
  const nums = existing.map(s => parseInt(s.id.replace('MIG-','')||'0')).filter(Boolean)
  const next = nums.length ? Math.max(...nums) + 1 : 1
  return `MIG-${String(next).padStart(3,'0')}`
}

// ── Componente principal ─────────────────────────────────────────
export default function Home() {
  const [data, setData] = useState<Solicitud[]>([])
  const [loading, setLoading] = useState(true)
  const [currentUser, setCurrentUser] = useState<UsuarioAutorizado|null>(null)
  const [role, setRole] = useState<Rol>('Todos')
  const [view, setView] = useState<'kanban'|'list'|'menciones'|'incidencias'>('kanban')
  const [filterMode, setFilterMode] = useState('todos')
  const [stageFilter, setStageFilter] = useState<string|null>(null)
  const [solFilter, setSolFilter] = useState('')
  const [searchQ, setSearchQ] = useState('')
  const [searchResults, setSearchResults] = useState<Solicitud[]>([])
  const [selectedId, setSelectedId] = useState<string|null>(null)
  const [showForm, setShowForm] = useState(false)
  const [showBloqModal, setShowBloqModal] = useState(false)
  const [bloqTargetId, setBloqTargetId] = useState<string|null>(null)
  const [showNotaModal, setShowNotaModal] = useState(false)
  const [notaTargetId, setNotaTargetId] = useState<string|null>(null)
  const [toast, setToast] = useState<{msg:string,err?:boolean}|null>(null)
  const [loginEmail, setLoginEmail] = useState('')
  const [loginError, setLoginError] = useState('')
  const [csvRows, setCsvRows] = useState<any[]>([])
  const [showCsvModal, setShowCsvModal] = useState(false)
  const [showIncidenciaModal, setShowIncidenciaModal] = useState(false)
  const [incidenciaTargetId, setIncidenciaTargetId] = useState<string|null>(null)
  const [incidencias, setIncidencias] = useState<Incidencia[]>([])
  const [lastCsvHash, setLastCsvHash] = useState('')

  // ── Toast ──
  function showToast(msg: string, err = false) {
    setToast({msg,err})
    setTimeout(() => setToast(null), 3500)
  }

  // ── Auth ──
  async function doLogin() {
    const email = loginEmail.trim().toLowerCase()
    if (!email.endsWith('@cashea.app')) { setLoginError('Solo se aceptan correos @cashea.app'); return }
    const res = await fetch('/api/auth', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({email}) })
    const json = await res.json()
    if (!res.ok) { setLoginError(json.error || 'Usuario no autorizado'); return }
    setCurrentUser(json.usuario)
    setRole(json.usuario.equipo as Rol)
    sessionStorage.setItem('cashea_user', JSON.stringify(json.usuario))
  }

  // ── Cargar datos ──
  const loadData = useCallback(async () => {
    setLoading(true)
    const { data: rows, error } = await supabase.from('solicitudes').select('*').order('ts_nuevo', { ascending: false })
    if (!error && rows) setData(rows as Solicitud[])
    const { data: incRows } = await supabase.from('incidencias').select('*').order('created_at', { ascending: false })
    if (incRows) setIncidencias(incRows as Incidencia[])
    setLoading(false)
  }, [])

  useEffect(() => {
    const saved = sessionStorage.getItem('cashea_user')
    if (saved) { const u = JSON.parse(saved); setCurrentUser(u); setRole(u.equipo) }
    loadData()
  }, [loadData])

  // ── Incidencias ──
  async function submitIncidencia(categoria: string, descripcion: string, equipoReporta: string) {
    if (!incidenciaTargetId || !currentUser) return
    const nueva: Incidencia = {
      solicitud_id: incidenciaTargetId,
      categoria,
      descripcion,
      reportado_por: currentUser.email,
      equipo_reporta: equipoReporta,
      estado: 'Activa',
      fecha_incidencia: today(),
    }
    const { data, error } = await supabase.from('incidencias').insert(nueva).select().single()
    if (error) { showToast('Error al registrar incidencia: ' + error.message, true); return }
    setIncidencias(prev => [data as Incidencia, ...prev])
    setShowIncidenciaModal(false)
    setIncidenciaTargetId(null)
    showToast('Incidencia registrada correctamente')
  }

  async function marcarCorregida(incidenciaId: number) {
    const { error } = await supabase.from('incidencias').update({
      estado: 'Corregida', fecha_correccion: today()
    }).eq('id', incidenciaId)
    if (error) { showToast('Error: ' + error.message, true); return }
    setIncidencias(prev => prev.map(i => i.id === incidenciaId ? {...i, estado:'Corregida', fecha_correccion:today()} : i))
    showToast('Incidencia marcada como corregida')
  }

  // ── Filtros ──
  function getFiltered() {
    let items = data.filter(d => ROLE_STAGES[role].includes(d.etapa_actual))
    if (solFilter) items = items.filter(d => d.solicitante === solFilter)
    const now = new Date()
    if (filterMode === 'hoy') { const h = new Date(); h.setHours(0,0,0,0); items = items.filter(d => new Date(d.ts_nuevo) >= h) }
    else if (filterMode === 'semana') { const w = new Date(); w.setDate(w.getDate()-7); items = items.filter(d => new Date(d.ts_nuevo) >= w) }
    else if (filterMode === 'mes') { const m = new Date(now.getFullYear(),now.getMonth(),1); items = items.filter(d => new Date(d.ts_nuevo) >= m) }
    else if (filterMode === 'stage' && stageFilter) items = items.filter(d => d.etapa_actual === stageFilter)
    return items
  }

  // ── Avanzar etapa ──
  async function advance(id: string, newStage: Etapa) {
    const item = data.find(d => d.id === id)
    if (!item) return
    const tsKey = TS_MAP[newStage]
    const updates: any = { etapa_actual: newStage }
    if (tsKey) updates[tsKey] = today()
    const { error } = await supabase.from('solicitudes').update(updates).eq('id', id)
    if (error) { showToast('Error al actualizar: ' + error.message, true); return }
    setData(prev => prev.map(d => d.id === id ? {...d, ...updates} : d))
    setSelectedId(null)
    showToast(`${item.nombre_aliado} → ${newStage}`)
  }

  // ── Bloquear ──
  async function confirmBloqueo(razon: string, comentario: string) {
    const item = data.find(d => d.id === bloqTargetId)
    if (!item) return
    const razonFinal = razon + (comentario ? ' - ' + comentario : '')
    const fecha = today()
    const equipo = role === 'Todos' ? 'Sistema' : role
    const autoNota = `[${fecha} | ${equipo}] Ticket bloqueado: ${razon}. @${item.solicitante} tu solicitud fue bloqueada.`
    const nuevaNotas = item.notas_seguimiento ? item.notas_seguimiento + '\n' + autoNota : autoNota
    const { error } = await supabase.from('solicitudes').update({
      etapa_actual: 'Bloqueado', razon_bloqueo: razonFinal, notas_seguimiento: nuevaNotas
    }).eq('id', bloqTargetId!)
    if (error) { showToast('Error: ' + error.message, true); return }
    setData(prev => prev.map(d => d.id === bloqTargetId ? {...d, etapa_actual:'Bloqueado', razon_bloqueo:razonFinal, notas_seguimiento:nuevaNotas} : d))
    setShowBloqModal(false); setSelectedId(null)
    showToast(`${item.nombre_aliado} bloqueada`)
  }

  // ── Agregar nota ──
  async function submitNota(texto: string) {
    const item = data.find(d => d.id === notaTargetId)
    if (!item) return
    const fecha = today()
    const equipo = role === 'Todos' ? 'MI' : role
    const nuevaNota = `[${fecha} | ${equipo}] ${texto}`
    const nuevaNotas = item.notas_seguimiento ? item.notas_seguimiento + '\n' + nuevaNota : nuevaNota
    const { error } = await supabase.from('solicitudes').update({ notas_seguimiento: nuevaNotas }).eq('id', notaTargetId!)
    if (error) { showToast('Error: ' + error.message, true); return }
    setData(prev => prev.map(d => d.id === notaTargetId ? {...d, notas_seguimiento:nuevaNotas} : d))
    setShowNotaModal(false)
    showToast('Nota guardada')
  }

  // ── Crear solicitud ──
  async function submitForm(form: Partial<Solicitud>) {
    const id = genId(data)
    const nueva: any = {
      id, etapa_actual: 'Nuevo', razon_bloqueo: '', ts_nuevo: today(),
      ts_contrato_enviado:null, ts_contrato_firmado:null, ts_entidad_validada:null,
      ts_odoo_configurado:null, ts_resuelto:null, notas_seguimiento:'',
      solicitante: currentUser?.email ?? '',
      nombre_aliado: form.nombre_aliado ?? '',
      rif: form.rif ?? '', razon_social: form.razon_social ?? '',
      tier: form.tier ?? '', orden: form.orden ?? '',
      lending_fee: form.lending_fee ?? '', tiendas: form.tiendas ?? '',
      motivo_cambio: form.motivo_cambio ?? '', comentarios: form.comentarios ?? '',
      canal_venta: form.canal_venta ?? '',
    }
    const { error } = await supabase.from('solicitudes').insert(nueva)
    if (error) { showToast('Error: ' + error.message, true); return }
    setData(prev => [nueva, ...prev])
    setShowForm(false)
    showToast(`Solicitud ${id} creada`)
  }

  // ── CSV Import ──
  function hashStr(s: string) {
    let h = 0
    for (let i = 0; i < s.length; i++) { h = ((h<<5)-h) + s.charCodeAt(i); h |= 0 }
    return h.toString()
  }

  function parseCsv(text: string) {
    const hash = hashStr(text)
    if (hash === lastCsvHash) { showToast('Este archivo ya fue importado', true); return }
    const lines = text.trim().split('\n')
    if (lines.length < 2) { showToast('CSV vacío', true); return }
    const sep = lines[0].includes(';') ? ';' : ','
    const seenKeys: Record<string,boolean> = {}
    const rows = lines.slice(1).map((l, i) => {
      const r = l.split(sep).map(c => c.trim().replace(/^"|"$/g,''))
      const obj: any = {
        nombre_aliado:r[0]||'', razon_social:r[1]||'', rif:r[2]||'',
        tier:r[3]||'', orden:r[4]||'', lending_fee:r[5]||'', canal_venta:r[6]||'',
        tiendas:(r[7]||'').replace(/\|/g,'\n'), motivo_cambio:r[8]||'',
        comentarios:r[9]||'', errors:[], isDuplicate:false, dupReason:'',
      }
      if (!obj.nombre_aliado) obj.errors.push('Falta nombre')
      if (!obj.razon_social) obj.errors.push('Falta razon social')
      if (!/^[VJE]-\d{8,9}$/.test(obj.rif)) obj.errors.push('RIF invalido')
      if (!obj.tiendas) obj.errors.push('Falta tiendas')
      const key = obj.rif + '|' + obj.nombre_aliado.toLowerCase()
      if (seenKeys[key]) { obj.isDuplicate = true; obj.dupReason = 'Duplicado en CSV' }
      else seenKeys[key] = true
      const enBase = data.some(d => d.rif === obj.rif && d.nombre_aliado.toLowerCase() === obj.nombre_aliado.toLowerCase())
      if (enBase) { obj.isDuplicate = true; obj.dupReason = 'Ya existe en la base' }
      return obj
    })
    setCsvRows(rows)
    ;(window as any)._csvHash = hash
  }

  async function importCsv() {
    const ok = csvRows.filter(r => r.errors.length === 0 && !r.isDuplicate)
    const dups = csvRows.filter(r => r.isDuplicate)
    const hoy = today()
    const toInsert = [
      ...ok.map(r => ({ id:genId([...data]), nombre_aliado:r.nombre_aliado, rif:r.rif,
        razon_social:r.razon_social, tier:r.tier, orden:r.orden, lending_fee:r.lending_fee,
        canal_venta:r.canal_venta, tiendas:r.tiendas, motivo_cambio:r.motivo_cambio,
        comentarios:r.comentarios, solicitante:currentUser?.email??'',
        etapa_actual:'Nuevo' as Etapa, razon_bloqueo:'', ts_nuevo:hoy,
        ts_contrato_enviado:null, ts_contrato_firmado:null, ts_entidad_validada:null,
        ts_odoo_configurado:null, ts_resuelto:null, notas_seguimiento:'' })),
      ...dups.map(r => ({ id:genId([...data]), nombre_aliado:r.nombre_aliado, rif:r.rif,
        razon_social:r.razon_social, tier:r.tier, orden:r.orden, lending_fee:r.lending_fee,
        canal_venta:r.canal_venta, tiendas:r.tiendas, motivo_cambio:r.motivo_cambio,
        comentarios:r.comentarios, solicitante:currentUser?.email??'',
        etapa_actual:'Bloqueado' as Etapa, razon_bloqueo:'Ticket duplicado - '+r.dupReason,
        ts_nuevo:hoy, ts_contrato_enviado:null, ts_contrato_firmado:null,
        ts_entidad_validada:null, ts_odoo_coordinado:null, ts_resuelto:null, notas_seguimiento:'' })),
    ]
    const res = await fetch('/api/importar', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({solicitudes:toInsert}) })
    const json = await res.json()
    if (!res.ok) { showToast('Error: ' + json.error, true); return }
    setLastCsvHash((window as any)._csvHash || '')
    await loadData()
    setShowCsvModal(false)
    showToast(`${ok.length} importadas${dups.length ? ` · ${dups.length} como Bloqueado/Duplicado` : ''}`)
  }

  // ── Search ──
  useEffect(() => {
    if (!searchQ.trim()) { setSearchResults([]); return }
    const q = searchQ.toLowerCase()
    setSearchResults(data.filter(d => d.razon_social?.toLowerCase().includes(q)))
  }, [searchQ, data])

  // ── Menciones ──
  function getMenciones() {
    if (!currentUser) return []
    return data.filter(d => (d.notas_seguimiento||'').includes(currentUser.email))
  }

  // ── Render helpers ──
  const selected = data.find(d => d.id === selectedId)
  const filtered = getFiltered()
  const solicitantes = data.map(d => d.solicitante).filter((s, i, arr) => Boolean(s) && arr.indexOf(s) === i) as string[]
  const menciones = getMenciones()

  if (!currentUser) return <LoginScreen email={loginEmail} setEmail={setLoginEmail} error={loginError} onLogin={doLogin} />

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100vh',overflow:'hidden'}}>
      {/* Topbar */}
      <div style={{display:'flex',alignItems:'center',gap:10,padding:'0 20px',height:56,background:'#0A0A0A',flexShrink:0,flexWrap:'wrap'}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <div style={{width:28,height:28,background:'#FDFA3D',borderRadius:7,display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,fontSize:14}}>C</div>
          <span style={{fontWeight:700,fontSize:15,color:'#fff'}}>Cashea</span>
          <div style={{width:1,height:18,background:'rgba(255,255,255,.15)',margin:'0 4px'}}/>
          <span style={{fontSize:11,color:'rgba(255,255,255,.4)',fontFamily:'monospace'}}>Migración de Modelo</span>
        </div>
        <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
          <span style={{fontSize:11,color:'rgba(255,255,255,.4)',fontFamily:'monospace'}}>{currentUser.email}</span>
          <div style={{width:1,height:18,background:'rgba(255,255,255,.1)'}}/>
          {(['Legal','MI','Activaciones','Todos'] as Rol[]).map(r => (
            <button key={r} onClick={() => setRole(r)}
              style={{padding:'5px 12px',borderRadius:20,fontSize:12,fontWeight:500,border:'1px solid',cursor:'pointer',transition:'all .15s',
                background:role===r?'#FDFA3D':'transparent',
                borderColor:role===r?'#FDFA3D':'rgba(255,255,255,.15)',
                color:role===r?'#0A0A0A':'rgba(255,255,255,.5)'}}>
              {r}
            </button>
          ))}
          <div style={{width:1,height:18,background:'rgba(255,255,255,.1)'}}/>
          <button onClick={() => setShowCsvModal(true)}
            style={{padding:'7px 12px',borderRadius:20,border:'1px solid rgba(255,255,255,.15)',background:'transparent',color:'rgba(255,255,255,.5)',cursor:'pointer',fontSize:12}}>
            ↑ CSV
          </button>
          <button onClick={() => setShowForm(true)}
            style={{padding:'7px 14px',background:'#FDFA3D',color:'#0A0A0A',border:'none',borderRadius:20,fontWeight:700,fontSize:12,cursor:'pointer'}}>
            + Nueva solicitud
          </button>
        </div>
      </div>

      {/* Stats */}
      <div style={{display:'flex',gap:1,background:'#EBEBEB',borderBottom:'1px solid #EBEBEB',flexShrink:0}}>
        {[
          {n:data.length,l:'Total',c:'#0A0A0A'},
          {n:data.filter(d=>d.etapa_actual==='Nuevo').length,l:'Nuevas',c:'#2563EB'},
          {n:data.filter(d=>['Enviando contrato','Firma de contrato','Revision de Entidad Legal en ABM','Configuracion de ODOO'].includes(d.etapa_actual)).length,l:'En proceso',c:'#EA580C'},
          {n:data.filter(d=>d.etapa_actual==='Bloqueado').length,l:'Bloqueadas',c:'#DC2626'},
          {n:data.filter(d=>d.etapa_actual==='Solicitud resuelta').length,l:'Resueltas',c:'#16A34A'},
        ].map(s => (
          <div key={s.l} style={{flex:1,padding:'10px 16px',background:'#fff',textAlign:'center'}}>
            <div style={{fontSize:20,fontWeight:700,color:s.c}}>{s.n}</div>
            <div style={{fontSize:10,color:'#9A9A9A',textTransform:'uppercase',letterSpacing:'.06em',fontWeight:500}}>{s.l}</div>
          </div>
        ))}
      </div>

      <div style={{display:'flex',flex:1,overflow:'hidden'}}>
        {/* Sidebar */}
        <div style={{width:215,background:'#fff',borderRight:'1px solid #EBEBEB',padding:'14px 10px',display:'flex',flexDirection:'column',gap:2,flexShrink:0,overflowY:'auto'}}>
          <div style={{fontSize:10,color:'#9A9A9A',letterSpacing:'.08em',textTransform:'uppercase',padding:'8px 8px 4px',fontWeight:600}}>Buscar ticket</div>
          <div style={{position:'relative',marginBottom:4}}>
            <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="Razon social exacta..."
              style={{width:'100%',background:'#F5F5F5',border:'1.5px solid #EBEBEB',borderRadius:10,padding:'8px 10px 8px 30px',fontSize:12,outline:'none',fontFamily:'inherit'}}/>
            <svg style={{position:'absolute',left:9,top:'50%',transform:'translateY(-50%)',color:'#9A9A9A',pointerEvents:'none'}} width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="6.5" cy="6.5" r="4.5"/><line x1="10" y1="10" x2="14" y2="14"/></svg>
          </div>
          {searchResults.length > 0 && (
            <div style={{background:'#fff',border:'1px solid #EBEBEB',borderRadius:10,overflow:'hidden',marginBottom:8,maxHeight:'40vh',overflowY:'auto',boxShadow:'0 4px 6px rgba(0,0,0,.07)'}}>
              {searchResults.map(item => {
                const st = STAGES.find(s=>s.id===item.etapa_actual)||STAGES[0]
                return (
                  <div key={item.id} onClick={()=>{setSelectedId(item.id);setSearchQ('');setSearchResults([])}}
                    style={{padding:'10px 12px',borderBottom:'1px solid #EBEBEB',cursor:'pointer'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8,marginBottom:4}}>
                      <div>
                        <div style={{fontWeight:600,fontSize:13}}>{item.nombre_aliado}</div>
                        <div style={{fontSize:11,color:'#9A9A9A'}}>{item.razon_social}</div>
                      </div>
                      {stageBadge(st)}
                    </div>
                    <div style={{fontSize:11,color:'#9A9A9A',display:'grid',gridTemplateColumns:'1fr 1fr',gap:2}}>
                      <span>RIF: <b style={{color:'#0A0A0A'}}>{item.rif}</b></span>
                      <span>ID: <b style={{color:'#0A0A0A'}}>{item.id}</b></span>
                      <span>Desde: <b style={{color:'#0A0A0A'}}>{item.ts_nuevo||'—'}</b></span>
                      <span>Sol: <b style={{color:'#0A0A0A'}}>{item.solicitante?.replace('@cashea.app','')}</b></span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <div style={{fontSize:10,color:'#9A9A9A',letterSpacing:'.08em',textTransform:'uppercase',padding:'8px 8px 4px',fontWeight:600,marginTop:6}}>Vistas</div>
          <NavItem active={view==='kanban'&&!stageFilter} onClick={()=>{setView('kanban');setStageFilter(null);setFilterMode('todos')}}>
            Pipeline completo <NavBadge>{data.length}</NavBadge>
          </NavItem>
          <NavItem active={view==='menciones'} onClick={()=>setView('menciones')}>
            Mis menciones {menciones.length>0 && <span style={{background:'#DC2626',color:'#fff',fontSize:10,fontWeight:700,padding:'1px 6px',borderRadius:10,marginLeft:'auto'}}>{menciones.length}</span>}
          </NavItem>

          <div style={{fontSize:10,color:'#9A9A9A',letterSpacing:'.08em',textTransform:'uppercase',padding:'8px 8px 4px',fontWeight:600,marginTop:6}}>Etapas</div>
          {STAGES.map(s => (
            <NavItem key={s.id} active={stageFilter===s.id} onClick={()=>{setStageFilter(s.id);setFilterMode('stage');setView('list')}}>
              <span style={{width:7,height:7,borderRadius:'50%',background:s.color,flexShrink:0}}/>
              {s.label.length > 18 ? s.label.slice(0,18)+'…' : s.label}
              <NavBadge>{data.filter(d=>d.etapa_actual===s.id).length}</NavBadge>
            </NavItem>
          ))}
        </div>

        {/* Content */}
        <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
          {/* Header */}
          <div style={{padding:'12px 20px',borderBottom:'1px solid #EBEBEB',display:'flex',alignItems:'center',gap:10,background:'#fff',flexWrap:'wrap'}}>
            <div>
              <div style={{fontWeight:700,fontSize:15}}>
                {view==='menciones' ? 'Mis menciones' : stageFilter ? STAGES.find(s=>s.id===stageFilter)?.label : 'Pipeline completo'}
              </div>
              <div style={{fontSize:11,color:'#9A9A9A'}}>
                {view==='menciones' ? 'Tickets donde fuiste mencionado' :
                  {Legal:'Nuevo → Contrato → Firma',MI:'Revision Entidad Legal',Activaciones:'ODOO → Resuelta',Todos:'Vista completa'}[role]}
              </div>
            </div>
            {view !== 'menciones' && (
              <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
                {['todos','hoy','semana','mes'].map(f => (
                  <button key={f} onClick={()=>{setFilterMode(f);setStageFilter(null);setView('kanban')}}
                    style={{padding:'5px 12px',borderRadius:20,fontSize:12,fontWeight:500,border:'1px solid',cursor:'pointer',
                      background:filterMode===f&&!stageFilter?'#0A0A0A':'transparent',
                      borderColor:filterMode===f&&!stageFilter?'#0A0A0A':'#EBEBEB',
                      color:filterMode===f&&!stageFilter?'#FDFA3D':'#5A5A5A'}}>
                    {f==='todos'?'Todos':f==='hoy'?'Hoy':f==='semana'?'Esta semana':'Este mes'}
                  </button>
                ))}
              </div>
            )}
            <select value={solFilter} onChange={e=>setSolFilter(e.target.value)}
              style={{marginLeft:'auto',padding:'5px 10px',borderRadius:20,fontSize:12,border:'1px solid #EBEBEB',background:'transparent',cursor:'pointer',outline:'none'}}>
              <option value="">Todos los solicitantes</option>
              {solicitantes.map(s => <option key={s} value={s}>{s.replace('@cashea.app','')}</option>)}
            </select>
          </div>

          {/* Main area */}
          {loading ? (
            <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',color:'#9A9A9A'}}>Cargando...</div>
          ) : view === 'menciones' ? (
            <MencionesView items={menciones} onSelect={setSelectedId} />
          ) : view === 'incidencias' ? (
            <IncidenciasView incidencias={incidencias} data={data} onMarcarCorregida={marcarCorregida} />
          ) : view === 'list' || stageFilter ? (
            <ListView items={filtered} onSelect={setSelectedId} showBlocked={stageFilter==='Bloqueado'} />
          ) : (
            <KanbanView items={filtered} role={role} onSelect={setSelectedId} />
          )}
        </div>
      </div>

      {/* Drawer detalle */}
      {selected && (
        <DetailDrawer item={selected} role={role}
          onClose={()=>setSelectedId(null)}
          onAdvance={advance}
          onBloquear={id=>{setBloqTargetId(id);setShowBloqModal(true)}}
          onNota={id=>{setNotaTargetId(id);setShowNotaModal(true)}}
          onIncidencia={id=>{setIncidenciaTargetId(id);setShowIncidenciaModal(true)}}
          incidencias={incidencias.filter(i=>i.solicitud_id===selected.id)}
          onMarcarCorregida={marcarCorregida}
        />
      )}

      {/* Modales */}
      {showForm && <FormModal user={currentUser} existing={data} onSubmit={submitForm} onClose={()=>setShowForm(false)}/>}
      {showBloqModal && <BloqModal onConfirm={confirmBloqueo} onClose={()=>setShowBloqModal(false)}/>}
      {showNotaModal && <NotaModal onSubmit={submitNota} onClose={()=>setShowNotaModal(false)}/>}
      {showCsvModal && <CsvModal csvRows={csvRows} onParse={parseCsv} onImport={importCsv} onClose={()=>{setShowCsvModal(false);setCsvRows([])}}/>}

      {/* Toast */}
      {showIncidenciaModal && (
    <IncidenciaModal
      user={currentUser!}
      onSubmit={submitIncidencia}
      onClose={()=>{setShowIncidenciaModal(false);setIncidenciaTargetId(null)}}
    />
  )}

  {toast && (
        <div style={{position:'fixed',bottom:20,right:20,background:'#0A0A0A',borderRadius:14,padding:'12px 16px',fontSize:13,zIndex:9999,display:'flex',alignItems:'center',gap:8,color:'#fff',boxShadow:'0 10px 15px rgba(0,0,0,.1)'}}>
          <span style={{width:7,height:7,borderRadius:'50%',background:toast.err?'#DC2626':'#FDFA3D',flexShrink:0}}/>
          {toast.msg}
        </div>
      )}
    </div>
  )
}

// ── Sub-componentes UI ───────────────────────────────────────────
function NavItem({children,active,onClick}:{children:React.ReactNode,active:boolean,onClick:()=>void}) {
  return (
    <div onClick={onClick} style={{display:'flex',alignItems:'center',gap:8,padding:'7px 10px',borderRadius:10,fontSize:13,color:active?'#0A0A0A':'#5A5A5A',cursor:'pointer',fontWeight:500,background:active?'#FDFA3D':'transparent',transition:'all .1s'}}>
      {children}
    </div>
  )
}
function NavBadge({children}:{children:React.ReactNode}) {
  return <span style={{marginLeft:'auto',fontSize:10,fontWeight:600,background:'#EBEBEB',color:'#5A5A5A',padding:'1px 6px',borderRadius:10}}>{children}</span>
}

function KanbanView({items,role,onSelect}:{items:Solicitud[],role:Rol,onSelect:(id:string)=>void}) {
  const stages = STAGES.filter(s => ROLE_STAGES[role].includes(s.id))
  return (
    <div style={{display:'flex',gap:12,flex:1,overflowX:'auto',padding:16,alignItems:'flex-start'}}>
      {stages.map(col => {
        const ci = items.filter(d => d.etapa_actual === col.id)
        return (
          <div key={col.id} style={{minWidth:240,maxWidth:260,flexShrink:0,display:'flex',flexDirection:'column',gap:8}}>
            <div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',background:'#fff',border:'1px solid #EBEBEB',borderRadius:10,boxShadow:'0 1px 3px rgba(0,0,0,.08)'}}>
              <span style={{width:8,height:8,borderRadius:'50%',background:col.color}}/>
              <span style={{fontWeight:600,fontSize:11,letterSpacing:'.04em',color:'#2A2A2A'}}>{col.label.toUpperCase()}</span>
              <span style={{marginLeft:'auto',fontSize:11,fontWeight:600,color:'#9A9A9A'}}>{ci.length}</span>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:8,overflowY:'auto',maxHeight:'calc(100vh - 210px)'}}>
              {ci.length === 0 ? (
                <div style={{border:'1px dashed #D4D4D4',borderRadius:14,padding:16,textAlign:'center',fontSize:12,color:'#9A9A9A'}}>Sin solicitudes</div>
              ) : ci.map(item => (
                <KanbanCard key={item.id} item={item} color={col.color} onSelect={onSelect}/>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function KanbanCard({item,color,onSelect}:{item:Solicitud,color:string,onSelect:(id:string)=>void}) {
  const sol = item.solicitante?.replace('@cashea.app','') ?? ''
  const hasNotas = !!item.notas_seguimiento?.trim()
  return (
    <div onClick={()=>onSelect(item.id)} style={{background:'#fff',border:'1px solid #EBEBEB',borderRadius:14,padding:13,cursor:'pointer',position:'relative',overflow:'hidden',boxShadow:'0 1px 3px rgba(0,0,0,.08)',transition:'all .15s'}}>
      <div style={{position:'absolute',left:0,top:0,bottom:0,width:3,background:color,borderRadius:'3px 0 0 3px'}}/>
      <div style={{display:'flex',justifyContent:'space-between',marginBottom:5}}>
        <div style={{fontWeight:600,fontSize:13}}>{item.nombre_aliado}</div>
        <div style={{fontFamily:'monospace',fontSize:10,color:'#9A9A9A'}}>{item.id}</div>
      </div>
      <div style={{display:'flex',flexWrap:'wrap',gap:4,marginBottom:8}}>
        <span style={{background:'#F5F5F5',color:'#5A5A5A',border:'1px solid #EBEBEB',padding:'2px 8px',borderRadius:20,fontSize:10,fontWeight:600}}>{item.rif}</span>
        {item.tier && <span style={{background:'#EFF6FF',color:'#2563EB',padding:'2px 8px',borderRadius:20,fontSize:10,fontWeight:600}}>{item.tier}</span>}
        {item.lending_fee && <span style={{background:'#F5F3FF',color:'#7C3AED',padding:'2px 8px',borderRadius:20,fontSize:10,fontWeight:600}}>{item.lending_fee}%</span>}
        {hasNotas && <span style={{background:'#FDFA3D',color:'#0A0A0A',padding:'2px 8px',borderRadius:20,fontSize:10,fontWeight:600}}>notas</span>}
      </div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',borderTop:'1px solid #EBEBEB',paddingTop:8,marginTop:4}}>
        <span style={{fontSize:11,color:'#9A9A9A',display:'flex',alignItems:'center',gap:5}}>
          <span style={{width:18,height:18,borderRadius:'50%',background:'#0A0A0A',display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:8,fontWeight:700,color:'#FDFA3D'}}>{initials(item.solicitante??'')}</span>
          {sol}
        </span>
        <span style={{fontSize:11,color:'#9A9A9A',fontWeight:500}}>{item.ts_nuevo?.slice(5).replace('-','/')}</span>
      </div>
    </div>
  )
}

function ListView({items,onSelect,showBlocked}:{items:Solicitud[],onSelect:(id:string)=>void,showBlocked?:boolean}) {
  return (
    <div style={{flex:1,overflowY:'auto',padding:16}}>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
        <thead>
          <tr style={{borderBottom:'2px solid #EBEBEB'}}>
            {['ID','Aliado','RIF','Solicitante','Canal','Días etapa','Días pipeline','Comentarios',...(showBlocked?['Razón bloqueo']:[])].map(h=>(
              <th key={h} style={{textAlign:'left',padding:'8px 12px',color:'#9A9A9A',fontSize:10,fontWeight:700,letterSpacing:'.06em',textTransform:'uppercase'}}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr><td colSpan={9} style={{textAlign:'center',padding:28,color:'#9A9A9A'}}>Sin solicitudes</td></tr>
          ) : items.map(item => {
            const ds = stageAge(item); const dp = pipelineAge(item)
            const sol = item.solicitante?.replace('@cashea.app','')
            const dColor = ds===null?'#9A9A9A':ds>14?'#DC2626':ds>7?'#EA580C':'#0A0A0A'
            return (
              <tr key={item.id} onClick={()=>onSelect(item.id)} style={{borderBottom:'1px solid #EBEBEB',cursor:'pointer',background:'#fff',transition:'background .1s'}}>
                <td style={{padding:'10px 12px',fontFamily:'monospace',color:'#9A9A9A',fontSize:11}}>{item.id}</td>
                <td style={{padding:'10px 12px'}}><div style={{fontWeight:600}}>{item.nombre_aliado}</div><div style={{fontSize:11,color:'#9A9A9A'}}>{item.razon_social}</div></td>
                <td style={{padding:'10px 12px',fontFamily:'monospace',fontSize:11,color:'#5A5A5A'}}>{item.rif}</td>
                <td style={{padding:'10px 12px',fontSize:12,color:'#5A5A5A'}}>{sol}</td>
                <td style={{padding:'10px 12px',fontSize:11,color:'#5A5A5A'}}>{item.canal_venta||'—'}</td>
                <td style={{padding:'10px 12px',fontWeight:700,fontSize:13,color:dColor}}>{ds!==null?ds+'d':'—'}</td>
                <td style={{padding:'10px 12px',fontSize:12,color:'#5A5A5A'}}>{dp!==null?dp+'d':'—'}</td>
                <td style={{padding:'10px 12px',fontSize:11,color:'#5A5A5A',maxWidth:180,whiteSpace:'pre-wrap'}}>{item.comentarios||'—'}</td>
                {showBlocked && <td style={{padding:'10px 12px',fontSize:11,color:'#DC2626'}}>{item.razon_bloqueo||'—'}</td>}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function MencionesView({items,onSelect}:{items:Solicitud[],onSelect:(id:string)=>void}) {
  return (
    <div style={{flex:1,overflowY:'auto',padding:16}}>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
        <thead><tr style={{borderBottom:'2px solid #EBEBEB'}}>
          {['ID','Aliado','Etapa','Nota con mencion'].map(h=>(
            <th key={h} style={{textAlign:'left',padding:'8px 12px',color:'#9A9A9A',fontSize:10,fontWeight:700,letterSpacing:'.06em',textTransform:'uppercase'}}>{h}</th>
          ))}
        </tr></thead>
        <tbody>
          {items.length===0 ? <tr><td colSpan={4} style={{textAlign:'center',padding:28,color:'#9A9A9A'}}>No tienes menciones</td></tr>
          : items.map(item => {
            const st = STAGES.find(s=>s.id===item.etapa_actual)||STAGES[0]
            return (
              <tr key={item.id} onClick={()=>onSelect(item.id)} style={{borderBottom:'1px solid #EBEBEB',cursor:'pointer'}}>
                <td style={{padding:'10px 12px',fontFamily:'monospace',color:'#9A9A9A',fontSize:11}}>{item.id}</td>
                <td style={{padding:'10px 12px'}}><div style={{fontWeight:600}}>{item.nombre_aliado}</div></td>
                <td style={{padding:'10px 12px'}}>{stageBadge(st)}</td>
                <td style={{padding:'10px 12px',fontSize:11,color:'#5A5A5A',maxWidth:300}}>{item.notas_seguimiento?.split('\n').find(n=>n.includes('@'))||'—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function DetailDrawer({item,role,onClose,onAdvance,onBloquear,onNota,onIncidencia,incidencias,onMarcarCorregida}:{
  item:Solicitud,role:Rol,onClose:()=>void,
  onAdvance:(id:string,e:Etapa)=>void,
  onBloquear:(id:string)=>void,
  onNota:(id:string)=>void,
  onIncidencia:(id:string)=>void,
  incidencias:Incidencia[],
  onMarcarCorregida:(id:number)=>void,
}) {
  const st = STAGES.find(s=>s.id===item.etapa_actual)||STAGES[0]
  const days = stageAge(item)
  const notas = (item.notas_seguimiento||'').trim().split('\n').filter(Boolean)

  function getNextAction() {
    const s = item.etapa_actual; const r = role
    const bloqBtn = (
      <button onClick={()=>onBloquear(item.id)} style={btnStyle('danger')}>
        🚫 <div><div>Marcar como bloqueada</div><div style={{fontSize:10,opacity:.7,marginTop:2}}>Selecciona la razón</div></div>
      </button>
    )
    if (s==='Solicitud resuelta') return <div style={btnStyle('success')}>✓ Proceso completado</div>
    if (s==='Bloqueado') return <div style={{...btnStyle('danger'),cursor:'default',opacity:.8}}>🚫 {item.razon_bloqueo}</div>
    if (r==='Legal'&&s==='Nuevo') return <>{<button onClick={()=>onAdvance(item.id,'Enviando contrato')} style={btnStyle('primary')}>→ Mover a Enviando contrato</button>}{bloqBtn}</>
    if (r==='Legal'&&s==='Enviando contrato') return <>{<button onClick={()=>onAdvance(item.id,'Firma de contrato')} style={btnStyle('primary')}>✍ Mover a Firma de contrato</button>}{bloqBtn}</>
    if (r==='Legal'&&s==='Firma de contrato') return <>{<button onClick={()=>onAdvance(item.id,'Revision de Entidad Legal en ABM')} style={btnStyle('primary')}>→ Contratos firmados, pasar a MI</button>}{bloqBtn}</>
    if (r==='MI'&&s==='Revision de Entidad Legal en ABM') return <>{<button onClick={()=>onAdvance(item.id,'Configuracion de ODOO')} style={btnStyle('primary')}>→ Entidad validada, pasar a Activaciones</button>}{bloqBtn}</>
    if (r==='Activaciones'&&s==='Configuracion de ODOO') return <>{<button onClick={()=>onAdvance(item.id,'Solicitud resuelta')} style={btnStyle('primary')}>🚀 Marcar como resuelta</button>}{bloqBtn}</>
    return <>{<div style={{...btnStyle('default'),cursor:'default',opacity:.5}}>⏳ Sin acción requerida ahora</div>}{bloqBtn}</>
  }

  return (
    <>
      <div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(0,0,0,.3)',backdropFilter:'blur(2px)',zIndex:100}}/>
      <div style={{position:'fixed',right:0,top:0,bottom:0,width:480,background:'#fff',borderLeft:'1px solid #EBEBEB',overflowY:'auto',zIndex:101,boxShadow:'0 10px 15px rgba(0,0,0,.1)'}}>
        <div style={{padding:'20px 20px 16px',borderBottom:'1px solid #EBEBEB',display:'flex',justifyContent:'space-between',alignItems:'flex-start',position:'sticky',top:0,background:'#fff',zIndex:1}}>
          <div>
            <div style={{fontWeight:700,fontSize:16}}>{item.nombre_aliado}</div>
            <div style={{fontSize:12,color:'#9A9A9A',marginTop:2}}>{item.id} · {item.razon_social}</div>
          </div>
          <button onClick={onClose} style={{width:28,height:28,borderRadius:8,border:'1px solid #EBEBEB',background:'transparent',cursor:'pointer',fontSize:14,display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
        </div>
        <div style={{padding:20,display:'flex',flexDirection:'column',gap:20}}>
          {/* Estado actual */}
          <div style={{display:'flex',alignItems:'center',gap:10,padding:'12px 14px',background:'#F5F5F5',borderRadius:10,border:'1px solid #EBEBEB'}}>
            {stageBadge(st)}
            {days!==null && <span style={{fontSize:12,color:'#9A9A9A',marginLeft:'auto'}}>{days} días en esta etapa</span>}
          </div>
          {/* Datos */}
          <Section title="Datos del aliado">
            <Grid2>
              <InfoItem label="Razón social" value={item.razon_social}/>
              <InfoItem label="RIF" value={item.rif}/>
              <InfoItem label="Tier" value={item.tier||'—'}/>
              <InfoItem label="Tipo de línea" value={item.orden||'—'}/>
              <InfoItem label="Lending fee" value={item.lending_fee?item.lending_fee+'%':'—'}/>
              <InfoItem label="Canal de venta" value={item.canal_venta||'—'}/>
              <InfoItem label="Solicitante" value={item.solicitante||'—'} full/>
              <InfoItem label="Tiendas" value={item.tiendas||'—'} full small/>
              <InfoItem label="Motivo" value={item.motivo_cambio||'—'} full/>
              {item.comentarios && <InfoItem label="Comentario inicial" value={item.comentarios} full small/>}
              {item.razon_bloqueo && <InfoItem label="Razón de bloqueo" value={item.razon_bloqueo} full danger/>}
            </Grid2>
          </Section>
          {/* Timeline */}
          <Section title="Pipeline">
            {STAGE_ORDER.map((s,i) => {
              const k = s==='Nuevo'?'ts_nuevo':(TS_MAP[s]??'')
              const ts = k ? item[k as keyof Solicitud] as string : ''
              const currIdx = STAGE_ORDER.indexOf(item.etapa_actual)
              const done = !!ts || i < currIdx
              const curr = s === item.etapa_actual
              return (
                <div key={s} style={{display:'flex',gap:12,paddingBottom:14,position:'relative'}}>
                  {i < STAGE_ORDER.length-1 && <div style={{position:'absolute',left:11,top:24,bottom:0,width:1,background:'#EBEBEB'}}/>}
                  <div style={{width:24,height:24,borderRadius:'50%',border:`2px solid ${done?'#16A34A':curr?'#0A0A0A':'#EBEBEB'}`,background:done?'#F0FDF4':curr?'#FDFA3D':'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:700,flexShrink:0,color:done?'#16A34A':curr?'#0A0A0A':'#9A9A9A'}}>
                    {done ? '✓' : i+1}
                  </div>
                  <div>
                    <div style={{fontSize:13,fontWeight:500,color:(!done&&!curr)?'#9A9A9A':'#0A0A0A'}}>{s}</div>
                    <div style={{fontSize:11,color:'#9A9A9A',marginTop:1}}>{ts||'—'}</div>
                  </div>
                </div>
              )
            })}
          </Section>
          {/* Notas */}
          <Section title="Notas de seguimiento" action={<button onClick={()=>onNota(item.id)} style={{fontSize:11,padding:'3px 10px',borderRadius:20,border:'1.5px solid #EBEBEB',background:'transparent',cursor:'pointer',fontWeight:600}}>+ Agregar nota</button>}>
            {notas.length === 0 ? <div style={{fontSize:12,color:'#9A9A9A',padding:'8px 0'}}>Sin notas aún.</div>
            : notas.map((n,i) => {
              const m = n.match(/^\[([^\|]+)\|([^\]]+)\]\s*(.+)$/)
              return (
                <div key={i} style={{padding:'10px 12px',background:'#F5F5F5',borderRadius:10,marginBottom:8,borderLeft:'3px solid #D4D4D4'}}>
                  {m ? <>
                    <div style={{display:'flex',gap:6,marginBottom:4,alignItems:'center'}}>
                      <span style={{fontSize:10,fontFamily:'monospace',color:'#9A9A9A'}}>{m[1].trim()}</span>
                      <span style={{fontSize:10,fontWeight:700,background:'#0A0A0A',color:'#FDFA3D',padding:'1px 7px',borderRadius:10}}>{m[2].trim()}</span>
                    </div>
                    <div style={{fontSize:12}}>{m[3].trim()}</div>
                  </> : <div style={{fontSize:12}}>{n}</div>}
                </div>
              )
            })}
          </Section>
          {/* Acción */}
          {(role === 'MI' || role === 'Activaciones') && item.etapa_actual === 'Solicitud resuelta' && (
            <Section title="Incidencias post-resolución" action={
              <button onClick={()=>onIncidencia(item.id)} style={{fontSize:11,padding:'3px 10px',borderRadius:20,border:'1.5px solid #DC2626',background:'transparent',color:'#DC2626',cursor:'pointer',fontWeight:600}}>+ Reportar incidencia</button>
            }>
              {incidencias.length === 0 ? (
                <div style={{fontSize:12,color:'#9A9A9A',padding:'8px 0'}}>Sin incidencias registradas.</div>
              ) : incidencias.map(inc => (
                <div key={inc.id} style={{padding:'10px 12px',background:inc.estado==='Corregida'?'#F0FDF4':'#FEF2F2',borderRadius:10,marginBottom:8,border:`1px solid ${inc.estado==='Corregida'?'#16A34A':'#DC2626'}33`}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:4}}>
                    <span style={{fontSize:11,fontWeight:700,color:inc.estado==='Corregida'?'#16A34A':'#DC2626'}}>{inc.categoria}</span>
                    <span style={{fontSize:10,padding:'1px 7px',borderRadius:10,background:inc.estado==='Corregida'?'#16A34A':'#DC2626',color:'#fff',fontWeight:600}}>{inc.estado}</span>
                  </div>
                  <div style={{fontSize:12,color:'#5A5A5A',marginBottom:4}}>{inc.descripcion}</div>
                  <div style={{fontSize:10,color:'#9A9A9A',display:'flex',gap:10}}>
                    <span>Reportó: {inc.equipo_reporta}</span>
                    <span>{inc.fecha_incidencia}</span>
                  </div>
                  {inc.estado === 'Activa' && (
                    <button onClick={()=>onMarcarCorregida(inc.id!)} style={{marginTop:6,fontSize:11,padding:'3px 10px',borderRadius:20,border:'1.5px solid #16A34A',background:'transparent',color:'#16A34A',cursor:'pointer',fontWeight:600}}>
                      Marcar como corregida
                    </button>
                  )}
                </div>
              ))}
            </Section>
          )}
          <Section title="Acción requerida">
            <div style={{display:'flex',flexDirection:'column',gap:8}}>{getNextAction()}</div>
          </Section>
        </div>
      </div>
    </>
  )
}

// ── UI Helpers ───────────────────────────────────────────────────
function Section({title,children,action}:{title:string,children:React.ReactNode,action?:React.ReactNode}) {
  return (
    <div>
      <div style={{fontSize:11,fontWeight:600,color:'#9A9A9A',letterSpacing:'.06em',textTransform:'uppercase',marginBottom:10,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        {title}{action}
      </div>
      {children}
    </div>
  )
}
function Grid2({children}:{children:React.ReactNode}) {
  return <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>{children}</div>
}
function InfoItem({label,value,full,small,danger}:{label:string,value:string,full?:boolean,small?:boolean,danger?:boolean}) {
  return (
    <div style={{gridColumn:full?'1/-1':'auto',background:danger?'#FEF2F2':'#F5F5F5',borderRadius:10,padding:'9px 12px',border:`1px solid ${danger?'rgba(220,38,38,.3)':'#EBEBEB'}`}}>
      <div style={{fontSize:10,color:danger?'#DC2626':'#9A9A9A',marginBottom:3,fontWeight:500,textTransform:'uppercase',letterSpacing:'.04em'}}>{label}</div>
      <div style={{fontSize:small?11:13,fontWeight:500,color:danger?'#DC2626':'#0A0A0A',whiteSpace:'pre-wrap',wordBreak:'break-word'}}>{value}</div>
    </div>
  )
}
function btnStyle(type:'primary'|'danger'|'success'|'default') {
  const base:React.CSSProperties = {display:'flex',alignItems:'center',gap:10,padding:'12px 14px',borderRadius:10,fontSize:13,fontWeight:500,textAlign:'left',width:'100%',cursor:'pointer',border:'1px solid',transition:'all .15s'}
  if (type==='primary') return {...base,background:'#FDFA3D',borderColor:'#FDFA3D',color:'#0A0A0A'}
  if (type==='danger')  return {...base,background:'#FEF2F2',borderColor:'#DC2626',color:'#DC2626'}
  if (type==='success') return {...base,background:'#F0FDF4',borderColor:'#16A34A',color:'#16A34A'}
  return {...base,background:'#fff',borderColor:'#EBEBEB',color:'#0A0A0A'}
}

// ── Modales ──────────────────────────────────────────────────────
function LoginScreen({email,setEmail,error,onLogin}:{email:string,setEmail:(v:string)=>void,error:string,onLogin:()=>void}) {
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.4)',backdropFilter:'blur(4px)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:300}}>
      <div style={{background:'#fff',borderRadius:20,width:'100%',maxWidth:400,boxShadow:'0 10px 15px rgba(0,0,0,.1)',overflow:'hidden'}}>
        <div style={{padding:'20px 20px 0'}}>
          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16}}>
            <div style={{width:36,height:36,background:'#FDFA3D',borderRadius:10,display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,fontSize:18}}>C</div>
            <div><div style={{fontWeight:700,fontSize:18}}>Migración de Modelo</div><div style={{fontSize:13,color:'#9A9A9A'}}>Migración de Modelo Base → Express</div></div>
          </div>
          <div style={{marginBottom:14}}>
            <label style={{fontSize:12,color:'#5A5A5A',fontWeight:600,display:'block',marginBottom:5}}>Correo corporativo *</label>
            <input value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==='Enter'&&onLogin()} type="email" placeholder="tunombre@cashea.app"
              style={{width:'100%',background:'#F5F5F5',border:'1.5px solid #EBEBEB',borderRadius:10,padding:'9px 12px',fontSize:13,outline:'none',fontFamily:'inherit'}}/>
            <div style={{fontSize:11,color:'#9A9A9A',marginTop:4}}>Solo se aceptan correos @cashea.app registrados</div>
          </div>
          {error && <div style={{fontSize:12,color:'#DC2626',background:'#FEF2F2',padding:'10px 12px',borderRadius:10,marginBottom:14,fontWeight:500}}>{error}</div>}
        </div>
        <div style={{padding:16,borderTop:'1px solid #EBEBEB'}}>
          <button onClick={onLogin} style={{width:'100%',padding:'8px 20px',borderRadius:20,border:'none',background:'#0A0A0A',color:'#FDFA3D',cursor:'pointer',fontWeight:700,fontSize:13}}>
            Ingresar →
          </button>
        </div>
      </div>
    </div>
  )
}

function FormModal({user,existing,onSubmit,onClose}:{user:UsuarioAutorizado,existing:Solicitud[],onSubmit:(f:Partial<Solicitud>)=>void,onClose:()=>void}) {
  const [f, setF] = useState<Partial<Solicitud>>({})
  const [errors, setErrors] = useState<Record<string,string>>({})

  function validate() {
    const e:Record<string,string> = {}
    if (!f.nombre_aliado) e.nombre_aliado = 'Requerido'
    if (!f.razon_social) e.razon_social = 'Requerido'
    if (!f.rif || !/^[VJE]-\d{8,9}$/.test(f.rif)) e.rif = 'Formato inválido (Ej: J-12345678)'
    if (!f.tiendas) e.tiendas = 'Requerido'
    const lines = (f.tiendas||'').split('\n').filter(Boolean)
    if (lines.some(l => !/^\d{3,6}\s+-\s+.+/.test(l))) e.tiendas = 'Formato: ID - Nombre (una tienda por línea)'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  return (
    <Modal title="Nueva solicitud de migración" onClose={onClose} onSubmit={()=>validate()&&onSubmit(f)} submitLabel="Enviar solicitud">
      <Row2>
        <Field label="Nombre del aliado *" error={errors.nombre_aliado}><input placeholder="Ej. Farmatodo" value={f.nombre_aliado||''} onChange={e=>setF({...f,nombre_aliado:e.target.value})} style={inputStyle}/></Field>
        <Field label="Razón social *" error={errors.razon_social}><input placeholder="Ej. Farmatodo C.A." value={f.razon_social||''} onChange={e=>setF({...f,razon_social:e.target.value})} style={inputStyle}/></Field>
      </Row2>
      <Row2>
        <Field label="RIF *" error={errors.rif} hint="V, J o E + guión + 8 o 9 dígitos"><input placeholder="J-12345678" value={f.rif||''} onChange={e=>setF({...f,rif:e.target.value})} style={inputStyle}/></Field>
        <Field label="Tier"><select value={f.tier||''} onChange={e=>setF({...f,tier:e.target.value})} style={inputStyle}><option value="">—</option>{['Tier 1','Tier 2','Tier 3','Tier 4'].map(t=><option key={t}>{t}</option>)}</select></Field>
      </Row2>
      <Row2>
        <Field label="Tipo de línea"><select value={f.orden||''} onChange={e=>setF({...f,orden:e.target.value})} style={inputStyle}><option value="">—</option>{['LP','LC','Ambas'].map(o=><option key={o}>{o}</option>)}</select></Field>
        <Field label="% Lending fee"><input type="number" step="0.1" placeholder="5.5" value={f.lending_fee||''} onChange={e=>setF({...f,lending_fee:e.target.value})} style={inputStyle}/></Field>
      </Row2>
      <Field label="Canal de venta"><select value={f.canal_venta||''} onChange={e=>setF({...f,canal_venta:e.target.value})} style={inputStyle}><option value="">—</option>{['Marketplace','Marketplace + MMC','Boton de pago','Solo tienda fisica'].map(c=><option key={c}>{c}</option>)}</select></Field>
      <Field label="Tiendas *" error={errors.tiendas} hint="ID - Nombre tal como aparece en el ABM. Una tienda por línea."><textarea placeholder={"23852 - Farmacia La Bonita, La Paz\n10045 - Tienda Nombre, Ciudad"} value={f.tiendas||''} onChange={e=>setF({...f,tiendas:e.target.value})} style={{...inputStyle,minHeight:70,resize:'vertical'}}/></Field>
      <Field label="Motivo del cambio *"><select value={f.motivo_cambio||''} onChange={e=>setF({...f,motivo_cambio:e.target.value})} style={inputStyle}><option value="">—</option>{['Mejora de liquidez del aliado','Solicitud comercial','Renegociacion de contrato','Otro'].map(m=><option key={m}>{m}</option>)}</select></Field>
      <Field label="Comentarios"><textarea placeholder="Contexto relevante..." value={f.comentarios||''} onChange={e=>setF({...f,comentarios:e.target.value})} style={{...inputStyle,minHeight:60,resize:'vertical'}}/></Field>
    </Modal>
  )
}

function BloqModal({onConfirm,onClose}:{onConfirm:(r:string,c:string)=>void,onClose:()=>void}) {
  const [razon,setRazon] = useState(''); const [comentario,setComentario] = useState('')
  return (
    <Modal title="Razón de bloqueo" onClose={onClose} onSubmit={()=>razon&&onConfirm(razon,comentario)} submitLabel="Confirmar bloqueo" danger>
      <Field label="Selecciona la razón *"><select value={razon} onChange={e=>setRazon(e.target.value)} style={inputStyle}><option value="">—</option>{RAZONES_BLOQUEO.map(r=><option key={r}>{r}</option>)}</select></Field>
      <Field label="Comentario adicional (opcional)"><textarea value={comentario} onChange={e=>setComentario(e.target.value)} placeholder="Contexto adicional..." style={{...inputStyle,minHeight:60,resize:'vertical'}}/></Field>
    </Modal>
  )
}

function NotaModal({onSubmit,onClose}:{onSubmit:(t:string)=>void,onClose:()=>void}) {
  const [texto,setTexto] = useState('')
  return (
    <Modal title="Agregar nota" onClose={onClose} onSubmit={()=>texto&&onSubmit(texto)} submitLabel="Guardar nota">
      <Field label="Nota *" hint="Escribe @correo para mencionar a alguien"><textarea value={texto} onChange={e=>setTexto(e.target.value)} placeholder="Ej. Contratos enviados al aliado." style={{...inputStyle,minHeight:90,resize:'vertical'}}/></Field>
    </Modal>
  )
}

function CsvModal({csvRows,onParse,onImport,onClose}:{csvRows:any[],onParse:(t:string)=>void,onImport:()=>void,onClose:()=>void}) {
  const ok = csvRows.filter(r=>r.errors.length===0&&!r.isDuplicate)
  const dups = csvRows.filter(r=>r.isDuplicate)
  const errs = csvRows.filter(r=>r.errors.length>0&&!r.isDuplicate)
  return (
    <Modal title="Carga masiva de solicitudes" onClose={onClose} onSubmit={ok.length||dups.length?onImport:undefined} submitLabel={`Importar ${ok.length+dups.length} solicitudes`} wide>
      <div style={{fontSize:12,color:'#5A5A5A',background:'#F5F5F5',borderRadius:10,padding:'12px 14px',lineHeight:1.6,border:'1px solid #EBEBEB'}}>
        Columnas requeridas: <code style={{fontFamily:'monospace',fontSize:11,background:'#EBEBEB',padding:'1px 5px',borderRadius:4}}>nombre_aliado, razon_social, rif, tier, tipo_linea, lending_fee, canal_venta, tiendas, motivo_cambio, comentarios</code><br/>
        Tiendas separadas por <code style={{fontFamily:'monospace',fontSize:11,background:'#EBEBEB',padding:'1px 5px',borderRadius:4}}>|</code> dentro de la celda.
      </div>
      <div onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const f=e.dataTransfer.files[0];if(f){const r=new FileReader();r.onload=ev=>onParse(ev.target?.result as string);r.readAsText(f)}}}
        onClick={()=>document.getElementById('csv-input')?.click()}
        style={{border:'2px dashed #D4D4D4',borderRadius:14,padding:24,textAlign:'center',cursor:'pointer'}}>
        <div style={{fontSize:24,marginBottom:8}}>📄</div>
        <div style={{fontWeight:600,fontSize:13,marginBottom:4}}>Arrastra tu CSV aquí o haz click</div>
        <div style={{fontSize:12,color:'#9A9A9A'}}>Solo archivos .csv</div>
        <input id="csv-input" type="file" accept=".csv" style={{display:'none'}} onChange={e=>{const f=e.target.files?.[0];if(f){const r=new FileReader();r.onload=ev=>onParse(ev.target?.result as string);r.readAsText(f)}}}/>
      </div>
      {csvRows.length>0 && (
        <div>
          <div style={{display:'flex',gap:12,marginBottom:8,fontSize:13,fontWeight:600}}>
            <span style={{color:'#16A34A'}}>{ok.length} válidas</span>
            {dups.length>0&&<span style={{color:'#EA580C'}}>{dups.length} duplicadas</span>}
            {errs.length>0&&<span style={{color:'#DC2626'}}>{errs.length} con errores</span>}
          </div>
          <div style={{background:'#F5F5F5',border:'1px solid #EBEBEB',borderRadius:10,overflow:'auto',maxHeight:240}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
              <thead><tr>{['#','Aliado','RIF','Tier','Canal','Estado'].map(h=><th key={h} style={{padding:'6px 10px',background:'#EBEBEB',color:'#5A5A5A',textAlign:'left',fontWeight:600,fontSize:10,textTransform:'uppercase'}}>{h}</th>)}</tr></thead>
              <tbody>{csvRows.map((r,i)=>(
                <tr key={i} style={{borderBottom:'1px solid #EBEBEB',background:r.isDuplicate?'#FFF7ED':r.errors.length?'#FEF2F2':'#F0FDF4'}}>
                  <td style={{padding:'5px 10px'}}>{i+1}</td>
                  <td style={{padding:'5px 10px'}}>{r.nombre_aliado}</td>
                  <td style={{padding:'5px 10px'}}>{r.rif}</td>
                  <td style={{padding:'5px 10px'}}>{r.tier||'—'}</td>
                  <td style={{padding:'5px 10px'}}>{r.canal_venta||'—'}</td>
                  <td style={{padding:'5px 10px',fontWeight:600,color:r.isDuplicate?'#EA580C':r.errors.length?'#DC2626':'#16A34A'}}>
                    {r.isDuplicate?`Duplicado (${r.dupReason})`:r.errors.length?r.errors.join(', '):'OK'}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  )
}

function IncidenciasView({incidencias,data,onMarcarCorregida}:{incidencias:Incidencia[],data:Solicitud[],onMarcarCorregida:(id:number)=>void}) {
  const activas = incidencias.filter(i=>i.estado==='Activa')
  const corregidas = incidencias.filter(i=>i.estado==='Corregida')
  const resueltas = data.filter(d=>d.etapa_actual==='Solicitud resuelta')
  const tasaError = resueltas.length ? Math.round(incidencias.length/resueltas.length*100) : 0

  // Distribución por categoría
  const catCount: Record<string,number> = {}
  incidencias.forEach(i=>{ catCount[i.categoria] = (catCount[i.categoria]||0)+1 })
  const catRows = Object.entries(catCount).sort((a,b)=>b[1]-a[1])
  const maxCat = catRows.length ? catRows[0][1] : 1

  // Distribución por equipo que reporta
  const eqCount: Record<string,number> = {}
  incidencias.forEach(i=>{ eqCount[i.equipo_reporta] = (eqCount[i.equipo_reporta]||0)+1 })

  return (
    <div style={{flex:1,overflowY:'auto',padding:20,background:'#F5F5F5'}}>
      {/* KPIs */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:20}}>
        {[
          {n:incidencias.length,l:'Total incidencias',c:'#0A0A0A'},
          {n:activas.length,l:'Activas',c:'#DC2626'},
          {n:corregidas.length,l:'Corregidas',c:'#16A34A'},
          {n:tasaError+'%',l:'Tasa de error',c:'#EA580C'},
        ].map(k=>(
          <div key={k.l} style={{background:'#fff',borderRadius:14,padding:16,border:'1px solid #EBEBEB',boxShadow:'0 1px 3px rgba(0,0,0,.08)'}}>
            <div style={{fontSize:24,fontWeight:700,color:k.c,letterSpacing:'-.02em'}}>{k.n}</div>
            <div style={{fontSize:10,color:'#9A9A9A',textTransform:'uppercase',letterSpacing:'.06em',fontWeight:500,marginTop:2}}>{k.l}</div>
          </div>
        ))}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
        {/* Causas de incidencia */}
        <div style={{background:'#fff',borderRadius:14,padding:18,border:'1px solid #EBEBEB',boxShadow:'0 1px 3px rgba(0,0,0,.08)'}}>
          <div style={{fontSize:11,fontWeight:600,color:'#9A9A9A',letterSpacing:'.06em',textTransform:'uppercase',marginBottom:4}}>Causas de incidencia</div>
          <div style={{fontSize:11,color:'#9A9A9A',marginBottom:14}}>Categorías más frecuentes</div>
          {catRows.length===0 ? <div style={{fontSize:12,color:'#9A9A9A',textAlign:'center',padding:24}}>Sin incidencias aún</div>
          : catRows.map(([cat,val])=>(
            <div key={cat} style={{display:'flex',alignItems:'center',gap:10,marginBottom:8,fontSize:12}}>
              <div style={{width:130,flexShrink:0,color:'#5A5A5A',fontSize:11,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={cat}>{cat}</div>
              <div style={{flex:1,height:20,background:'#F5F5F5',borderRadius:4,overflow:'hidden'}}>
                <div style={{height:'100%',background:'#DC2626',borderRadius:4,width:Math.round(val/maxCat*100)+'%'}}/>
              </div>
              <div style={{minWidth:24,textAlign:'right',fontWeight:600,fontSize:12}}>{val}</div>
            </div>
          ))}
        </div>
        {/* Por equipo */}
        <div style={{background:'#fff',borderRadius:14,padding:18,border:'1px solid #EBEBEB',boxShadow:'0 1px 3px rgba(0,0,0,.08)'}}>
          <div style={{fontSize:11,fontWeight:600,color:'#9A9A9A',letterSpacing:'.06em',textTransform:'uppercase',marginBottom:4}}>Quién reporta</div>
          <div style={{fontSize:11,color:'#9A9A9A',marginBottom:14}}>Equipo que detectó la incidencia</div>
          {Object.entries(eqCount).length===0 ? <div style={{fontSize:12,color:'#9A9A9A',textAlign:'center',padding:24}}>Sin incidencias aún</div>
          : Object.entries(eqCount).sort((a,b)=>b[1]-a[1]).map(([eq,val])=>(
            <div key={eq} style={{display:'flex',alignItems:'center',gap:10,marginBottom:8,fontSize:12}}>
              <div style={{width:100,flexShrink:0,color:'#5A5A5A',fontWeight:500}}>{eq}</div>
              <div style={{flex:1,height:20,background:'#F5F5F5',borderRadius:4,overflow:'hidden'}}>
                <div style={{height:'100%',background:'#EA580C',borderRadius:4,width:Math.round(val/incidencias.length*100)+'%'}}/>
              </div>
              <div style={{minWidth:24,textAlign:'right',fontWeight:600}}>{val}</div>
            </div>
          ))}
        </div>
        {/* Lista de incidencias activas */}
        <div style={{gridColumn:'1/-1',background:'#fff',borderRadius:14,padding:18,border:'1px solid #EBEBEB',boxShadow:'0 1px 3px rgba(0,0,0,.08)'}}>
          <div style={{fontSize:11,fontWeight:600,color:'#9A9A9A',letterSpacing:'.06em',textTransform:'uppercase',marginBottom:14}}>Incidencias activas — requieren corrección</div>
          {activas.length===0 ? <div style={{fontSize:12,color:'#16A34A',textAlign:'center',padding:16,fontWeight:500}}>✓ Sin incidencias activas</div>
          : <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
            <thead><tr style={{borderBottom:'2px solid #EBEBEB'}}>
              {['Solicitud','Aliado','Categoría','Reportó','Fecha','Acción'].map(h=>(
                <th key={h} style={{textAlign:'left',padding:'7px 10px',color:'#9A9A9A',fontSize:10,fontWeight:700,letterSpacing:'.06em',textTransform:'uppercase'}}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {activas.map(inc=>{
                const sol = data.find(d=>d.id===inc.solicitud_id)
                return (
                  <tr key={inc.id} style={{borderBottom:'1px solid #EBEBEB'}}>
                    <td style={{padding:'8px 10px',fontFamily:'monospace',color:'#9A9A9A',fontSize:11}}>{inc.solicitud_id}</td>
                    <td style={{padding:'8px 10px',fontWeight:600}}>{sol?.nombre_aliado||'—'}</td>
                    <td style={{padding:'8px 10px',fontSize:11,color:'#DC2626',maxWidth:200}}>{inc.categoria}</td>
                    <td style={{padding:'8px 10px',fontSize:11,color:'#5A5A5A'}}>{inc.equipo_reporta}</td>
                    <td style={{padding:'8px 10px',fontSize:11,color:'#9A9A9A',fontFamily:'monospace'}}>{inc.fecha_incidencia}</td>
                    <td style={{padding:'8px 10px'}}>
                      <button onClick={()=>onMarcarCorregida(inc.id!)} style={{fontSize:11,padding:'3px 10px',borderRadius:20,border:'1.5px solid #16A34A',background:'transparent',color:'#16A34A',cursor:'pointer',fontWeight:600}}>
                        Corregida ✓
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>}
        </div>
      </div>
    </div>
  )
}

function IncidenciaModal({user,onSubmit,onClose}:{user:UsuarioAutorizado,onSubmit:(cat:string,desc:string,equipo:string)=>void,onClose:()=>void}) {
  const [categoria, setCategoria] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [equipoReporta, setEquipoReporta] = useState('')
  return (
    <Modal title="Reportar incidencia post-resolución" onClose={onClose}
      onSubmit={()=>categoria&&equipoReporta&&onSubmit(categoria,descripcion,equipoReporta)}
      submitLabel="Registrar incidencia" danger>
      <div style={{fontSize:12,color:'#5A5A5A',background:'#FEF2F2',borderRadius:10,padding:'12px 14px',border:'1px solid rgba(220,38,38,.2)',lineHeight:1.6}}>
        Esta marca queda registrada para medición de calidad. La corrección ocurre fuera de la app en el ABM de aliados.
      </div>
      <Field label="Categoría del error *">
        <select value={categoria} onChange={e=>setCategoria(e.target.value)} style={inputStyle}>
          <option value="">Seleccionar...</option>
          {CATEGORIAS_INCIDENCIA.map(c=><option key={c}>{c}</option>)}
        </select>
      </Field>
      <Field label="¿Quién reportó el error? *" hint="Equipo que detectó la incidencia">
        <select value={equipoReporta} onChange={e=>setEquipoReporta(e.target.value)} style={inputStyle}>
          <option value="">Seleccionar...</option>
          <option>Finanzas</option>
          <option>Data</option>
          <option>Comercial</option>
          <option>ATA</option>
          <option>MI</option>
          <option>Activaciones</option>
        </select>
      </Field>
      <Field label="Descripción del error (opcional)">
        <textarea value={descripcion} onChange={e=>setDescripcion(e.target.value)}
          placeholder="Ej. El lending fee se configuró como 5% cuando debía ser 6.5%"
          style={{...inputStyle,minHeight:70,resize:'vertical'}}/>
      </Field>
    </Modal>
  )
}

function Modal({title,children,onClose,onSubmit,submitLabel,danger,wide}:{title:string,children:React.ReactNode,onClose:()=>void,onSubmit?:()=>void,submitLabel?:string,danger?:boolean,wide?:boolean}) {
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.4)',backdropFilter:'blur(4px)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
      <div style={{background:'#fff',borderRadius:20,width:'100%',maxWidth:wide?700:540,maxHeight:'90vh',overflowY:'auto',boxShadow:'0 10px 15px rgba(0,0,0,.1)'}}>
        <div style={{padding:'20px 20px 16px',borderBottom:'1px solid #EBEBEB',display:'flex',alignItems:'center',justifyContent:'space-between',position:'sticky',top:0,background:'#fff',zIndex:1,borderRadius:'20px 20px 0 0'}}>
          <span style={{fontWeight:700,fontSize:16}}>{title}</span>
          <button onClick={onClose} style={{width:28,height:28,borderRadius:8,border:'1px solid #EBEBEB',background:'transparent',cursor:'pointer',fontSize:14,display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
        </div>
        <div style={{padding:20,display:'flex',flexDirection:'column',gap:14}}>{children}</div>
        <div style={{padding:'16px 20px',borderTop:'1px solid #EBEBEB',display:'flex',justifyContent:'flex-end',gap:8,position:'sticky',bottom:0,background:'#fff',borderRadius:'0 0 20px 20px'}}>
          <button onClick={onClose} style={{padding:'8px 16px',borderRadius:20,border:'1.5px solid #EBEBEB',background:'transparent',color:'#5A5A5A',cursor:'pointer',fontSize:13,fontWeight:500}}>Cancelar</button>
          {onSubmit && <button onClick={onSubmit} style={{padding:'8px 20px',borderRadius:20,border:'none',background:danger?'#DC2626':'#0A0A0A',color:danger?'#fff':'#FDFA3D',cursor:'pointer',fontWeight:700,fontSize:13}}>{submitLabel}</button>}
        </div>
      </div>
    </div>
  )
}

function Row2({children}:{children:React.ReactNode}) { return <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>{children}</div> }
function Field({label,children,hint,error}:{label:string,children:React.ReactNode,hint?:string,error?:string}) {
  return (
    <div style={{display:'flex',flexDirection:'column',gap:5}}>
      <label style={{fontSize:12,color:'#5A5A5A',fontWeight:600}}>{label}</label>
      {children}
      {hint && <span style={{fontSize:11,color:'#9A9A9A'}}>{hint}</span>}
      {error && <span style={{fontSize:11,color:'#DC2626',fontWeight:500}}>{error}</span>}
    </div>
  )
}
const inputStyle:React.CSSProperties = {background:'#F5F5F5',border:'1.5px solid #EBEBEB',borderRadius:10,padding:'9px 12px',color:'#0A0A0A',fontSize:13,outline:'none',width:'100%',fontFamily:'inherit'}
