DO $$
DECLARE
  s RECORD;
  v_area RECORD;
  v_tarifa RECORD;
  v_snapshot jsonb;
BEGIN
  FOR s IN
    SELECT * FROM public.coworking_sessions
    WHERE tarifa_snapshot IS NULL
      AND estado IN ('activo'::coworking_estado, 'pendiente_pago'::coworking_estado)
  LOOP
    v_snapshot := NULL;
    IF s.tarifa_id IS NOT NULL THEN
      SELECT * INTO v_tarifa FROM public.tarifas_coworking WHERE id = s.tarifa_id;
      IF FOUND THEN
        v_snapshot := jsonb_build_object(
          'nombre', v_tarifa.nombre, 'precio_base', v_tarifa.precio_base,
          'tipo_cobro', v_tarifa.tipo_cobro::text,
          'metodo_fraccion', COALESCE(v_tarifa.metodo_fraccion,'15_min'),
          'minutos_tolerancia', COALESCE(v_tarifa.minutos_tolerancia,0),
          'amenities','[]'::jsonb,'upsells_disponibles','[]'::jsonb,
          'reconstruido', true, 'origen','tarifa_id','snapshot_at', now());
      END IF;
    END IF;
    IF v_snapshot IS NULL THEN
      SELECT * INTO v_area FROM public.areas_coworking WHERE id = s.area_id;
      v_snapshot := jsonb_build_object(
        'nombre','Tarifa por hora (' || COALESCE(v_area.nombre_area,'área') || ')',
        'precio_base', COALESCE(v_area.precio_por_hora,0),
        'tipo_cobro','hora','metodo_fraccion','15_min','minutos_tolerancia',0,
        'amenities','[]'::jsonb,'upsells_disponibles','[]'::jsonb,
        'reconstruido', true,'origen','area_fallback','snapshot_at', now());
    END IF;

    UPDATE public.coworking_sessions
       SET tarifa_snapshot = v_snapshot, updated_at = now()
     WHERE id = s.id;

    INSERT INTO public.audit_logs (user_id, accion, descripcion, metadata)
    VALUES (s.usuario_id, 'sanear_tarifa_snapshot_backfill',
      format('Backfill snapshot (%s) sesión %s', v_snapshot->>'origen', s.cliente_nombre),
      jsonb_build_object('session_id', s.id, 'origen', v_snapshot->>'origen',
        'snapshot', v_snapshot, 'transaccional', true));
  END LOOP;
END $$;
