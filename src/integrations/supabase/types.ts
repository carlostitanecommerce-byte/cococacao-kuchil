export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      areas_coworking: {
        Row: {
          capacidad_pax: number
          created_at: string
          es_privado: boolean
          id: string
          nombre_area: string
          precio_por_hora: number
          updated_at: string
        }
        Insert: {
          capacidad_pax?: number
          created_at?: string
          es_privado?: boolean
          id?: string
          nombre_area: string
          precio_por_hora?: number
          updated_at?: string
        }
        Update: {
          capacidad_pax?: number
          created_at?: string
          es_privado?: boolean
          id?: string
          nombre_area?: string
          precio_por_hora?: number
          updated_at?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          accion: string
          created_at: string
          descripcion: string | null
          id: string
          metadata: Json | null
          user_id: string
        }
        Insert: {
          accion: string
          created_at?: string
          descripcion?: string | null
          id?: string
          metadata?: Json | null
          user_id: string
        }
        Update: {
          accion?: string
          created_at?: string
          descripcion?: string | null
          id?: string
          metadata?: Json | null
          user_id?: string
        }
        Relationships: []
      }
      cajas: {
        Row: {
          created_at: string
          diferencia: number | null
          estado: Database["public"]["Enums"]["caja_estado"]
          fecha_apertura: string
          fecha_cierre: string | null
          folio: number
          id: string
          monto_apertura: number
          monto_cierre: number | null
          notas_cierre: string | null
          updated_at: string
          usuario_id: string
        }
        Insert: {
          created_at?: string
          diferencia?: number | null
          estado?: Database["public"]["Enums"]["caja_estado"]
          fecha_apertura?: string
          fecha_cierre?: string | null
          folio?: number
          id?: string
          monto_apertura?: number
          monto_cierre?: number | null
          notas_cierre?: string | null
          updated_at?: string
          usuario_id: string
        }
        Update: {
          created_at?: string
          diferencia?: number | null
          estado?: Database["public"]["Enums"]["caja_estado"]
          fecha_apertura?: string
          fecha_cierre?: string | null
          folio?: number
          id?: string
          monto_apertura?: number
          monto_cierre?: number | null
          notas_cierre?: string | null
          updated_at?: string
          usuario_id?: string
        }
        Relationships: []
      }
      cancelaciones_items_sesion: {
        Row: {
          cantidad: number
          created_at: string
          decided_at: string | null
          decidido_por: string | null
          detalle_id: string | null
          estado: Database["public"]["Enums"]["cancelacion_item_estado"]
          id: string
          kds_item_id: string | null
          kds_order_id: string | null
          motivo: string
          nombre_producto: string
          notas_cocina: string | null
          paquete_id: string | null
          producto_id: string | null
          session_id: string
          solicitante_id: string
        }
        Insert: {
          cantidad: number
          created_at?: string
          decided_at?: string | null
          decidido_por?: string | null
          detalle_id?: string | null
          estado?: Database["public"]["Enums"]["cancelacion_item_estado"]
          id?: string
          kds_item_id?: string | null
          kds_order_id?: string | null
          motivo: string
          nombre_producto: string
          notas_cocina?: string | null
          paquete_id?: string | null
          producto_id?: string | null
          session_id: string
          solicitante_id: string
        }
        Update: {
          cantidad?: number
          created_at?: string
          decided_at?: string | null
          decidido_por?: string | null
          detalle_id?: string | null
          estado?: Database["public"]["Enums"]["cancelacion_item_estado"]
          id?: string
          kds_item_id?: string | null
          kds_order_id?: string | null
          motivo?: string
          nombre_producto?: string
          notas_cocina?: string | null
          paquete_id?: string | null
          producto_id?: string | null
          session_id?: string
          solicitante_id?: string
        }
        Relationships: []
      }
      categorias_maestras: {
        Row: {
          ambito: string
          created_at: string
          descripcion: string | null
          id: string
          nombre: string
          updated_at: string
        }
        Insert: {
          ambito?: string
          created_at?: string
          descripcion?: string | null
          id?: string
          nombre: string
          updated_at?: string
        }
        Update: {
          ambito?: string
          created_at?: string
          descripcion?: string | null
          id?: string
          nombre?: string
          updated_at?: string
        }
        Relationships: []
      }
      compras_insumos: {
        Row: {
          anulada: boolean
          anulada_at: string | null
          anulada_por: string | null
          cantidad_presentaciones: number
          cantidad_unidades: number
          costo_presentacion: number
          costo_total: number
          created_at: string
          fecha: string
          id: string
          insumo_id: string
          motivo_anulacion: string | null
          nota: string | null
          usuario_id: string
        }
        Insert: {
          anulada?: boolean
          anulada_at?: string | null
          anulada_por?: string | null
          cantidad_presentaciones?: number
          cantidad_unidades?: number
          costo_presentacion?: number
          costo_total?: number
          created_at?: string
          fecha?: string
          id?: string
          insumo_id: string
          motivo_anulacion?: string | null
          nota?: string | null
          usuario_id: string
        }
        Update: {
          anulada?: boolean
          anulada_at?: string | null
          anulada_por?: string | null
          cantidad_presentaciones?: number
          cantidad_unidades?: number
          costo_presentacion?: number
          costo_total?: number
          created_at?: string
          fecha?: string
          id?: string
          insumo_id?: string
          motivo_anulacion?: string | null
          nota?: string | null
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "compras_insumos_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "insumos"
            referencedColumns: ["id"]
          },
        ]
      }
      configuracion_ventas: {
        Row: {
          clave: string
          id: string
          updated_at: string
          valor: number
        }
        Insert: {
          clave: string
          id?: string
          updated_at?: string
          valor?: number
        }
        Update: {
          clave?: string
          id?: string
          updated_at?: string
          valor?: number
        }
        Relationships: []
      }
      coworking_reservaciones: {
        Row: {
          area_id: string
          cliente_nombre: string
          created_at: string
          duracion_horas: number
          estado: Database["public"]["Enums"]["reservacion_estado"]
          fecha_reserva: string
          hora_inicio: string
          id: string
          notas: string | null
          pax_count: number
          updated_at: string
          usuario_id: string
        }
        Insert: {
          area_id: string
          cliente_nombre: string
          created_at?: string
          duracion_horas?: number
          estado?: Database["public"]["Enums"]["reservacion_estado"]
          fecha_reserva: string
          hora_inicio: string
          id?: string
          notas?: string | null
          pax_count?: number
          updated_at?: string
          usuario_id: string
        }
        Update: {
          area_id?: string
          cliente_nombre?: string
          created_at?: string
          duracion_horas?: number
          estado?: Database["public"]["Enums"]["reservacion_estado"]
          fecha_reserva?: string
          hora_inicio?: string
          id?: string
          notas?: string | null
          pax_count?: number
          updated_at?: string
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coworking_reservaciones_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "areas_coworking"
            referencedColumns: ["id"]
          },
        ]
      }
      coworking_sessions: {
        Row: {
          area_id: string
          cliente_nombre: string
          created_at: string
          estado: Database["public"]["Enums"]["coworking_estado"]
          fecha_fin_estimada: string
          fecha_inicio: string
          fecha_salida_real: string | null
          id: string
          monto_acumulado: number
          pax_count: number
          tarifa_id: string | null
          tarifa_snapshot: Json | null
          updated_at: string
          usuario_id: string
        }
        Insert: {
          area_id: string
          cliente_nombre: string
          created_at?: string
          estado?: Database["public"]["Enums"]["coworking_estado"]
          fecha_fin_estimada: string
          fecha_inicio?: string
          fecha_salida_real?: string | null
          id?: string
          monto_acumulado?: number
          pax_count?: number
          tarifa_id?: string | null
          tarifa_snapshot?: Json | null
          updated_at?: string
          usuario_id: string
        }
        Update: {
          area_id?: string
          cliente_nombre?: string
          created_at?: string
          estado?: Database["public"]["Enums"]["coworking_estado"]
          fecha_fin_estimada?: string
          fecha_inicio?: string
          fecha_salida_real?: string | null
          id?: string
          monto_acumulado?: number
          pax_count?: number
          tarifa_id?: string | null
          tarifa_snapshot?: Json | null
          updated_at?: string
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coworking_sessions_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "areas_coworking"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coworking_sessions_tarifa_id_fkey"
            columns: ["tarifa_id"]
            isOneToOne: false
            referencedRelation: "tarifas_coworking"
            referencedColumns: ["id"]
          },
        ]
      }
      detalle_ventas: {
        Row: {
          cantidad: number
          coworking_session_id: string | null
          created_at: string
          descripcion: string | null
          id: string
          paquete_id: string | null
          paquete_nombre: string | null
          precio_unitario: number
          producto_id: string | null
          subtotal: number
          tipo_concepto: Database["public"]["Enums"]["tipo_concepto"]
          venta_id: string | null
        }
        Insert: {
          cantidad?: number
          coworking_session_id?: string | null
          created_at?: string
          descripcion?: string | null
          id?: string
          paquete_id?: string | null
          paquete_nombre?: string | null
          precio_unitario?: number
          producto_id?: string | null
          subtotal?: number
          tipo_concepto?: Database["public"]["Enums"]["tipo_concepto"]
          venta_id?: string | null
        }
        Update: {
          cantidad?: number
          coworking_session_id?: string | null
          created_at?: string
          descripcion?: string | null
          id?: string
          paquete_id?: string | null
          paquete_nombre?: string | null
          precio_unitario?: number
          producto_id?: string | null
          subtotal?: number
          tipo_concepto?: Database["public"]["Enums"]["tipo_concepto"]
          venta_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "detalle_ventas_coworking_session_id_fkey"
            columns: ["coworking_session_id"]
            isOneToOne: false
            referencedRelation: "coworking_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "detalle_ventas_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "productos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "detalle_ventas_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "ventas"
            referencedColumns: ["id"]
          },
        ]
      }
      insumos: {
        Row: {
          cantidad_por_presentacion: number
          categoria: string
          costo_presentacion: number
          costo_unitario: number
          created_at: string
          id: string
          nombre: string
          presentacion: string
          stock_actual: number
          stock_minimo: number
          unidad_medida: string
          updated_at: string
        }
        Insert: {
          cantidad_por_presentacion?: number
          categoria?: string
          costo_presentacion?: number
          costo_unitario?: number
          created_at?: string
          id?: string
          nombre: string
          presentacion?: string
          stock_actual?: number
          stock_minimo?: number
          unidad_medida?: string
          updated_at?: string
        }
        Update: {
          cantidad_por_presentacion?: number
          categoria?: string
          costo_presentacion?: number
          costo_unitario?: number
          created_at?: string
          id?: string
          nombre?: string
          presentacion?: string
          stock_actual?: number
          stock_minimo?: number
          unidad_medida?: string
          updated_at?: string
        }
        Relationships: []
      }
      kds_order_items: {
        Row: {
          cancel_qty: number
          cancel_requested: boolean
          cantidad: number
          created_at: string
          id: string
          kds_order_id: string
          nombre_producto: string
          notas: string | null
          producto_id: string | null
        }
        Insert: {
          cancel_qty?: number
          cancel_requested?: boolean
          cantidad?: number
          created_at?: string
          id?: string
          kds_order_id: string
          nombre_producto: string
          notas?: string | null
          producto_id?: string | null
        }
        Update: {
          cancel_qty?: number
          cancel_requested?: boolean
          cantidad?: number
          created_at?: string
          id?: string
          kds_order_id?: string
          nombre_producto?: string
          notas?: string | null
          producto_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kds_order_items_kds_order_id_fkey"
            columns: ["kds_order_id"]
            isOneToOne: false
            referencedRelation: "kds_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kds_order_items_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "productos"
            referencedColumns: ["id"]
          },
        ]
      }
      kds_orders: {
        Row: {
          coworking_session_id: string | null
          created_at: string
          estado: Database["public"]["Enums"]["kds_estado"]
          folio: number
          id: string
          tipo_consumo: string
          updated_at: string
          venta_id: string | null
        }
        Insert: {
          coworking_session_id?: string | null
          created_at?: string
          estado?: Database["public"]["Enums"]["kds_estado"]
          folio: number
          id?: string
          tipo_consumo?: string
          updated_at?: string
          venta_id?: string | null
        }
        Update: {
          coworking_session_id?: string | null
          created_at?: string
          estado?: Database["public"]["Enums"]["kds_estado"]
          folio?: number
          id?: string
          tipo_consumo?: string
          updated_at?: string
          venta_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kds_orders_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "ventas"
            referencedColumns: ["id"]
          },
        ]
      }
      mermas: {
        Row: {
          cantidad: number
          created_at: string
          fecha: string
          id: string
          insumo_id: string
          motivo: string
          usuario_id: string
        }
        Insert: {
          cantidad?: number
          created_at?: string
          fecha?: string
          id?: string
          insumo_id: string
          motivo: string
          usuario_id: string
        }
        Update: {
          cantidad?: number
          created_at?: string
          fecha?: string
          id?: string
          insumo_id?: string
          motivo?: string
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mermas_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "insumos"
            referencedColumns: ["id"]
          },
        ]
      }
      movimientos_caja: {
        Row: {
          caja_id: string
          created_at: string
          id: string
          monto: number
          motivo: string
          tipo: string
          usuario_id: string
        }
        Insert: {
          caja_id: string
          created_at?: string
          id?: string
          monto?: number
          motivo: string
          tipo: string
          usuario_id: string
        }
        Update: {
          caja_id?: string
          created_at?: string
          id?: string
          monto?: number
          motivo?: string
          tipo?: string
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "movimientos_caja_caja_id_fkey"
            columns: ["caja_id"]
            isOneToOne: false
            referencedRelation: "cajas"
            referencedColumns: ["id"]
          },
        ]
      }
      paquete_componentes: {
        Row: {
          cantidad: number
          created_at: string
          id: string
          paquete_id: string
          producto_id: string
        }
        Insert: {
          cantidad?: number
          created_at?: string
          id?: string
          paquete_id: string
          producto_id: string
        }
        Update: {
          cantidad?: number
          created_at?: string
          id?: string
          paquete_id?: string
          producto_id?: string
        }
        Relationships: []
      }
      paquete_grupos: {
        Row: {
          cantidad_incluida: number
          created_at: string
          es_obligatorio: boolean
          id: string
          nombre_grupo: string
          orden: number
          paquete_id: string
          updated_at: string
        }
        Insert: {
          cantidad_incluida?: number
          created_at?: string
          es_obligatorio?: boolean
          id?: string
          nombre_grupo: string
          orden?: number
          paquete_id: string
          updated_at?: string
        }
        Update: {
          cantidad_incluida?: number
          created_at?: string
          es_obligatorio?: boolean
          id?: string
          nombre_grupo?: string
          orden?: number
          paquete_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "paquete_grupos_paquete_id_fkey"
            columns: ["paquete_id"]
            isOneToOne: false
            referencedRelation: "productos"
            referencedColumns: ["id"]
          },
        ]
      }
      paquete_opciones_grupo: {
        Row: {
          created_at: string
          grupo_id: string
          id: string
          precio_adicional: number
          producto_id: string
        }
        Insert: {
          created_at?: string
          grupo_id: string
          id?: string
          precio_adicional?: number
          producto_id: string
        }
        Update: {
          created_at?: string
          grupo_id?: string
          id?: string
          precio_adicional?: number
          producto_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "paquete_opciones_grupo_grupo_id_fkey"
            columns: ["grupo_id"]
            isOneToOne: false
            referencedRelation: "paquete_grupos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paquete_opciones_grupo_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "productos"
            referencedColumns: ["id"]
          },
        ]
      }
      plataformas_delivery: {
        Row: {
          activo: boolean
          comision_porcentaje: number
          created_at: string
          id: string
          nombre: string
          updated_at: string
        }
        Insert: {
          activo?: boolean
          comision_porcentaje?: number
          created_at?: string
          id?: string
          nombre: string
          updated_at?: string
        }
        Update: {
          activo?: boolean
          comision_porcentaje?: number
          created_at?: string
          id?: string
          nombre?: string
          updated_at?: string
        }
        Relationships: []
      }
      producto_precios_delivery: {
        Row: {
          created_at: string
          id: string
          plataforma_id: string
          precio_venta: number
          producto_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          plataforma_id: string
          precio_venta?: number
          producto_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          plataforma_id?: string
          precio_venta?: number
          producto_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "producto_precios_delivery_plataforma_id_fkey"
            columns: ["plataforma_id"]
            isOneToOne: false
            referencedRelation: "plataformas_delivery"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "producto_precios_delivery_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "productos"
            referencedColumns: ["id"]
          },
        ]
      }
      productos: {
        Row: {
          activo: boolean
          categoria: string
          costo_total: number
          created_at: string
          id: string
          imagen_url: string | null
          instrucciones_preparacion: string | null
          margen: number
          nombre: string
          precio_upsell_coworking: number | null
          precio_venta: number
          requiere_preparacion: boolean
          tipo: string
          updated_at: string
        }
        Insert: {
          activo?: boolean
          categoria?: string
          costo_total?: number
          created_at?: string
          id?: string
          imagen_url?: string | null
          instrucciones_preparacion?: string | null
          margen?: number
          nombre: string
          precio_upsell_coworking?: number | null
          precio_venta?: number
          requiere_preparacion?: boolean
          tipo?: string
          updated_at?: string
        }
        Update: {
          activo?: boolean
          categoria?: string
          costo_total?: number
          created_at?: string
          id?: string
          imagen_url?: string | null
          instrucciones_preparacion?: string | null
          margen?: number
          nombre?: string
          precio_upsell_coworking?: number | null
          precio_venta?: number
          requiere_preparacion?: boolean
          tipo?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          id: string
          nombre: string
          password_encrypted: string | null
          updated_at: string
          username: string | null
        }
        Insert: {
          created_at?: string
          email?: string
          id: string
          nombre?: string
          password_encrypted?: string | null
          updated_at?: string
          username?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          nombre?: string
          password_encrypted?: string | null
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      recetas: {
        Row: {
          cantidad_necesaria: number
          created_at: string
          id: string
          insumo_id: string
          producto_id: string
        }
        Insert: {
          cantidad_necesaria?: number
          created_at?: string
          id?: string
          insumo_id: string
          producto_id: string
        }
        Update: {
          cantidad_necesaria?: number
          created_at?: string
          id?: string
          insumo_id?: string
          producto_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recetas_insumo_id_fkey"
            columns: ["insumo_id"]
            isOneToOne: false
            referencedRelation: "insumos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recetas_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "productos"
            referencedColumns: ["id"]
          },
        ]
      }
      solicitudes_cancelacion: {
        Row: {
          created_at: string
          estado: Database["public"]["Enums"]["solicitud_cancelacion_estado"]
          id: string
          motivo: string
          motivo_rechazo: string | null
          revisado_por: string | null
          solicitante_id: string
          updated_at: string
          venta_id: string
        }
        Insert: {
          created_at?: string
          estado?: Database["public"]["Enums"]["solicitud_cancelacion_estado"]
          id?: string
          motivo: string
          motivo_rechazo?: string | null
          revisado_por?: string | null
          solicitante_id: string
          updated_at?: string
          venta_id: string
        }
        Update: {
          created_at?: string
          estado?: Database["public"]["Enums"]["solicitud_cancelacion_estado"]
          id?: string
          motivo?: string
          motivo_rechazo?: string | null
          revisado_por?: string | null
          solicitante_id?: string
          updated_at?: string
          venta_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "solicitudes_cancelacion_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "ventas"
            referencedColumns: ["id"]
          },
        ]
      }
      solicitudes_cancelacion_sesiones: {
        Row: {
          created_at: string
          estado: Database["public"]["Enums"]["solicitud_cancelacion_sesion_estado"]
          id: string
          items_entregados: Json
          motivo: string
          motivo_rechazo: string | null
          revisado_por: string | null
          session_id: string
          solicitante_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          estado?: Database["public"]["Enums"]["solicitud_cancelacion_sesion_estado"]
          id?: string
          items_entregados?: Json
          motivo: string
          motivo_rechazo?: string | null
          revisado_por?: string | null
          session_id: string
          solicitante_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          estado?: Database["public"]["Enums"]["solicitud_cancelacion_sesion_estado"]
          id?: string
          items_entregados?: Json
          motivo?: string
          motivo_rechazo?: string | null
          revisado_por?: string | null
          session_id?: string
          solicitante_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "solicitudes_cancelacion_sesiones_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "coworking_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      tarifa_amenities_incluidos: {
        Row: {
          cantidad_incluida: number
          created_at: string
          id: string
          producto_id: string
          tarifa_id: string
        }
        Insert: {
          cantidad_incluida?: number
          created_at?: string
          id?: string
          producto_id: string
          tarifa_id: string
        }
        Update: {
          cantidad_incluida?: number
          created_at?: string
          id?: string
          producto_id?: string
          tarifa_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tarifa_amenities_incluidos_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "productos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tarifa_amenities_incluidos_tarifa_id_fkey"
            columns: ["tarifa_id"]
            isOneToOne: false
            referencedRelation: "tarifas_coworking"
            referencedColumns: ["id"]
          },
        ]
      }
      tarifa_upsells: {
        Row: {
          created_at: string
          id: string
          precio_especial: number
          producto_id: string
          tarifa_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          precio_especial?: number
          producto_id: string
          tarifa_id: string
        }
        Update: {
          created_at?: string
          id?: string
          precio_especial?: number
          producto_id?: string
          tarifa_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tarifa_upsells_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "productos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tarifa_upsells_tarifa_id_fkey"
            columns: ["tarifa_id"]
            isOneToOne: false
            referencedRelation: "tarifas_coworking"
            referencedColumns: ["id"]
          },
        ]
      }
      tarifas_coworking: {
        Row: {
          activo: boolean
          areas_aplicables: string[]
          created_at: string
          id: string
          metodo_fraccion: string | null
          minutos_tolerancia: number | null
          nombre: string
          precio_base: number
          tipo_cobro: Database["public"]["Enums"]["tipo_cobro"]
          updated_at: string
        }
        Insert: {
          activo?: boolean
          areas_aplicables?: string[]
          created_at?: string
          id?: string
          metodo_fraccion?: string | null
          minutos_tolerancia?: number | null
          nombre: string
          precio_base?: number
          tipo_cobro?: Database["public"]["Enums"]["tipo_cobro"]
          updated_at?: string
        }
        Update: {
          activo?: boolean
          areas_aplicables?: string[]
          created_at?: string
          id?: string
          metodo_fraccion?: string | null
          minutos_tolerancia?: number | null
          nombre?: string
          precio_base?: number
          tipo_cobro?: Database["public"]["Enums"]["tipo_cobro"]
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      ventas: {
        Row: {
          caja_id: string | null
          comisiones_bancarias: number
          coworking_session_id: string | null
          created_at: string
          estado: Database["public"]["Enums"]["venta_estado"]
          fecha: string
          folio: number
          id: string
          iva: number
          metodo_pago: Database["public"]["Enums"]["metodo_pago"]
          monto_efectivo: number
          monto_propina: number
          monto_tarjeta: number
          monto_transferencia: number
          motivo_cancelacion: string | null
          tipo_consumo: Database["public"]["Enums"]["tipo_consumo"]
          total_bruto: number
          total_neto: number
          updated_at: string
          usuario_id: string
        }
        Insert: {
          caja_id?: string | null
          comisiones_bancarias?: number
          coworking_session_id?: string | null
          created_at?: string
          estado?: Database["public"]["Enums"]["venta_estado"]
          fecha?: string
          folio?: number
          id?: string
          iva?: number
          metodo_pago?: Database["public"]["Enums"]["metodo_pago"]
          monto_efectivo?: number
          monto_propina?: number
          monto_tarjeta?: number
          monto_transferencia?: number
          motivo_cancelacion?: string | null
          tipo_consumo?: Database["public"]["Enums"]["tipo_consumo"]
          total_bruto?: number
          total_neto?: number
          updated_at?: string
          usuario_id: string
        }
        Update: {
          caja_id?: string | null
          comisiones_bancarias?: number
          coworking_session_id?: string | null
          created_at?: string
          estado?: Database["public"]["Enums"]["venta_estado"]
          fecha?: string
          folio?: number
          id?: string
          iva?: number
          metodo_pago?: Database["public"]["Enums"]["metodo_pago"]
          monto_efectivo?: number
          monto_propina?: number
          monto_tarjeta?: number
          monto_transferencia?: number
          motivo_cancelacion?: string | null
          tipo_consumo?: Database["public"]["Enums"]["tipo_consumo"]
          total_bruto?: number
          total_neto?: number
          updated_at?: string
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ventas_caja_id_fkey"
            columns: ["caja_id"]
            isOneToOne: false
            referencedRelation: "cajas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_coworking_session_id_fkey"
            columns: ["coworking_session_id"]
            isOneToOne: false
            referencedRelation: "coworking_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      actualizar_estado_kds_orden: {
        Args: {
          p_nuevo_estado: Database["public"]["Enums"]["kds_estado"]
          p_order_id: string
        }
        Returns: Json
      }
      ajustar_amenity_sesion: {
        Args: {
          p_nueva_cantidad: number
          p_producto_id: string
          p_session_id: string
        }
        Returns: Json
      }
      anular_compra_insumo: {
        Args: { p_compra_id: string; p_motivo: string }
        Returns: Json
      }
      aplicar_auditoria_inventario: { Args: { p_ajustes: Json }; Returns: Json }
      cancelar_sesion_coworking: {
        Args: {
          p_entregados: Json
          p_is_admin?: boolean
          p_motivo: string
          p_session_id: string
          p_solicitud_id?: string
        }
        Returns: Json
      }
      cerrar_cuenta_coworking: {
        Args: {
          p_audit?: Json
          p_detalles_nuevos: Json
          p_detalles_open_ids: string[]
          p_venta: Json
        }
        Returns: Json
      }
      crear_venta_completa: {
        Args: { p_audit?: Json; p_detalles: Json; p_venta: Json }
        Returns: Json
      }
      encrypt_and_save_password: {
        Args: { p_password: string; p_user_id: string; p_username: string }
        Returns: undefined
      }
      freeze_checkout_coworking: {
        Args: { p_session_id: string }
        Returns: {
          fecha_salida_real: string
          id: string
          was_frozen_now: boolean
        }[]
      }
      get_decrypted_password: { Args: { p_user_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      next_kds_coworking_folio: { Args: never; Returns: number }
      reabrir_sesion_coworking: {
        Args: { p_session_id: string }
        Returns: Json
      }
      recalcular_amenities_pax: {
        Args: { p_new_pax: number; p_session_id: string }
        Returns: Json
      }
      recalcular_costo_producto: {
        Args: { p_producto_id: string }
        Returns: Json
      }
      recalcular_costos_productos: {
        Args: { p_insumo_id?: string }
        Returns: number
      }
      registrar_amenity_sesion: {
        Args: {
          p_cantidad?: number
          p_producto_id: string
          p_session_id: string
        }
        Returns: Json
      }
      registrar_consumo_coworking: {
        Args: { p_items: Json; p_kds_items: Json; p_session_id: string }
        Returns: Json
      }
      registrar_merma: {
        Args: { p_cantidad: number; p_insumo_id: string; p_motivo: string }
        Returns: Json
      }
      resolver_cancelacion_item_sesion: {
        Args: { p_cancelacion_id: string; p_decision: string; p_notas?: string }
        Returns: Json
      }
      solicitar_cancelacion_item_sesion: {
        Args: {
          p_cantidad: number
          p_detalle_id: string
          p_motivo: string
          p_session_id: string
        }
        Returns: Json
      }
      unfreeze_checkout_coworking: {
        Args: { p_session_id: string }
        Returns: boolean
      }
      validar_stock_carrito: { Args: { p_items: Json }; Returns: Json }
      validar_stock_disponible: {
        Args: { p_cantidad: number; p_producto_id: string }
        Returns: Json
      }
      validar_stock_paquete: {
        Args: { p_cantidad: number; p_paquete_id: string }
        Returns: Json
      }
    }
    Enums: {
      app_role:
        | "administrador"
        | "supervisor"
        | "caja"
        | "barista"
        | "recepcion"
      caja_estado: "abierta" | "cerrada"
      cancelacion_item_estado:
        | "pendiente_decision"
        | "retornado_stock"
        | "merma"
        | "rechazado"
      coworking_estado: "activo" | "finalizado" | "cancelado" | "pendiente_pago"
      kds_estado: "pendiente" | "en_preparacion" | "listo" | "expirada"
      metodo_pago: "efectivo" | "tarjeta" | "transferencia" | "mixto"
      reservacion_estado:
        | "pendiente"
        | "confirmada"
        | "cancelada"
        | "completada"
      solicitud_cancelacion_estado: "pendiente" | "aprobada" | "rechazada"
      solicitud_cancelacion_sesion_estado:
        | "pendiente"
        | "aprobada"
        | "rechazada"
      tipo_cobro: "hora" | "dia" | "mes" | "paquete_horas"
      tipo_concepto: "producto" | "coworking" | "amenity"
      tipo_consumo: "sitio" | "para_llevar" | "delivery"
      venta_estado: "completada" | "cancelada"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["administrador", "supervisor", "caja", "barista", "recepcion"],
      caja_estado: ["abierta", "cerrada"],
      cancelacion_item_estado: [
        "pendiente_decision",
        "retornado_stock",
        "merma",
        "rechazado",
      ],
      coworking_estado: ["activo", "finalizado", "cancelado", "pendiente_pago"],
      kds_estado: ["pendiente", "en_preparacion", "listo", "expirada"],
      metodo_pago: ["efectivo", "tarjeta", "transferencia", "mixto"],
      reservacion_estado: [
        "pendiente",
        "confirmada",
        "cancelada",
        "completada",
      ],
      solicitud_cancelacion_estado: ["pendiente", "aprobada", "rechazada"],
      solicitud_cancelacion_sesion_estado: [
        "pendiente",
        "aprobada",
        "rechazada",
      ],
      tipo_cobro: ["hora", "dia", "mes", "paquete_horas"],
      tipo_concepto: ["producto", "coworking", "amenity"],
      tipo_consumo: ["sitio", "para_llevar", "delivery"],
      venta_estado: ["completada", "cancelada"],
    },
  },
} as const
