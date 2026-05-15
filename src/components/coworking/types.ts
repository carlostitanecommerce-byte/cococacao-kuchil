export interface Area {
  id: string;
  nombre_area: string;
  capacidad_pax: number;
  precio_por_hora: number;
  es_privado: boolean;
}

export interface TarifaSnapshot {
  id?: string;
  nombre?: string;
  precio_base: number;
  tipo_cobro?: string;
  metodo_fraccion: string;
  minutos_tolerancia: number;
  amenities?: unknown[];
  upsells_disponibles?: unknown[];
  snapshot_at?: string;
  [key: string]: unknown;
}

export interface CoworkingSession {
  id: string;
  cliente_nombre: string;
  area_id: string;
  pax_count: number;
  usuario_id: string;
  fecha_inicio: string;
  fecha_fin_estimada: string;
  fecha_salida_real: string | null;
  estado: string;
  monto_acumulado: number;
  tarifa_id: string | null;
  upsell_producto_id: string | null;
  upsell_precio: number | null;
  tarifa_snapshot?: TarifaSnapshot | null;
}

export interface Reservacion {
  id: string;
  cliente_nombre: string;
  area_id: string;
  pax_count: number;
  fecha_reserva: string;
  hora_inicio: string;
  duracion_horas: number;
  estado: string;
  usuario_id: string;
  notas: string | null;
  created_at: string;
}

export interface SessionUpsell {
  id: string;
  producto_id: string;
  nombre: string;
  precio_especial: number;
  cantidad: number;
}

export interface CheckoutSummary {
  session: CoworkingSession;
  area: Area;
  tiempoContratadoMin: number;
  tiempoRealMin: number;
  tiempoExcedidoMin: number;
  bloquesExtra: number;
  subtotalContratado: number;
  cargoExtra: number;
  total: number;
  upsells: SessionUpsell[];
  metodoFraccion: string;
  metodoFraccionLabel: string;
  toleranciaMin: number;
  minCobrar: number;
  precioBaseSnapshot: number;
  paxMultiplier: number;
  consumosPosTotal: number;
  consumosPosLineas: number;
}
