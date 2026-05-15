export interface PaqueteComponente {
  producto_id: string;
  nombre: string;
  cantidad: number;
}

export interface PaqueteOpcionSeleccionada {
  grupo_id: string;
  nombre_grupo: string;
  producto_id: string;
  nombre_producto: string;
  precio_adicional: number;
}

export interface CartItem {
  /** Identificador único de línea. Para productos simples y paquetes legacy = producto_id.
   *  Para paquetes dinámicos con opciones se asigna un uuid para permitir múltiples
   *  configuraciones del mismo paquete en el ticket. */
  lineId?: string;
  producto_id: string;
  nombre: string;
  precio_unitario: number;
  cantidad: number;
  subtotal: number;
  tipo_concepto: 'producto' | 'coworking' | 'amenity' | 'paquete';
  coworking_session_id?: string;
  descripcion?: string;
  paquete_id?: string;
  componentes?: PaqueteComponente[];
  /** Solo paquetes dinámicos: opciones elegidas por el cajero. */
  opciones?: PaqueteOpcionSeleccionada[];
  notas?: string;
  /** Indica que el precio_unitario proviene de una tarifa de coworking (upsell). */
  precio_especial?: boolean;
  /** Si está presente, esta línea YA existe en detalle_ventas (venta_id NULL) y al cobrar
   *  sólo se le estampa el venta_id; NO debe re-insertarse ni reenviarse a cocina. */
  open_account_detalle_id?: string;
}

export interface VentaConfig {
  iva_porcentaje: number;
  comision_bancaria_porcentaje: number;
}

export interface MixedPayment {
  efectivo: number;
  tarjeta: number;
  transferencia: number;
}

export interface VentaSummary {
  items: CartItem[];
  subtotal: number;
  iva: number;
  comision: number;
  propina: number;
  total: number;
  metodo_pago: 'efectivo' | 'tarjeta' | 'transferencia' | 'mixto';
  tipo_consumo: 'sitio' | 'para_llevar' | 'delivery';
  mixed_payment?: MixedPayment;
  propina_en_digital?: boolean;
  coworking_session_id?: string;
  caja_id?: string;
  usuario_nombre?: string;
  fecha?: string;
  folio?: number;
}
