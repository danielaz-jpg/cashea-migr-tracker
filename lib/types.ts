export type Etapa =
  | 'Nuevo'
  | 'Enviando contrato'
  | 'Firma de contrato'
  | 'Revision de Entidad Legal en ABM'
  | 'Configuracion de ODOO'
  | 'Solicitud resuelta'
  | 'Bloqueado'

export interface Solicitud {
  id: string
  nombre_aliado: string
  rif: string
  razon_social: string
  tier: string
  orden: string
  lending_fee: string
  tiendas: string
  motivo_cambio: string
  comentarios: string
  solicitante: string
  etapa_actual: Etapa
  razon_bloqueo: string
  ts_nuevo: string
  ts_contrato_enviado: string
  ts_contrato_firmado: string
  ts_entidad_validada: string
  ts_odoo_configurado: string
  ts_resuelto: string
  notas_seguimiento: string
  canal_venta: string
  created_at?: string
  updated_at?: string
}

export interface UsuarioAutorizado {
  id: number
  email: string
  nombre: string
  equipo: 'Legal' | 'MI' | 'Activaciones' | 'Todos'
  activo: boolean
}

export type Rol = 'Legal' | 'MI' | 'Activaciones' | 'Todos'

export interface Incidencia {
  id?: number
  solicitud_id: string
  categoria: string
  descripcion: string
  reportado_por: string
  equipo_reporta: string
  estado: 'Activa' | 'Corregida'
  fecha_incidencia: string
  fecha_correccion?: string
  created_at?: string
}
