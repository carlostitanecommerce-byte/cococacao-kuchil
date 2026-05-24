CREATE OR REPLACE FUNCTION public.guardar_paquete_grupos(p_paquete_id uuid, p_grupos jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g jsonb;
  o jsonb;
  v_grupo_id uuid;
BEGIN
  IF NOT has_role(auth.uid(), 'administrador'::app_role) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  DELETE FROM public.paquete_grupos WHERE paquete_id = p_paquete_id;

  FOR g IN SELECT * FROM jsonb_array_elements(p_grupos)
  LOOP
    INSERT INTO public.paquete_grupos (paquete_id, nombre_grupo, cantidad_incluida, es_obligatorio, orden)
    VALUES (
      p_paquete_id,
      g->>'nombre_grupo',
      COALESCE((g->>'cantidad_incluida')::int, 1),
      COALESCE((g->>'es_obligatorio')::boolean, true),
      COALESCE((g->>'orden')::int, 0)
    )
    RETURNING id INTO v_grupo_id;

    IF jsonb_array_length(COALESCE(g->'opciones', '[]'::jsonb)) > 0 THEN
      FOR o IN SELECT * FROM jsonb_array_elements(g->'opciones')
      LOOP
        INSERT INTO public.paquete_opciones_grupo (grupo_id, producto_id, precio_adicional)
        VALUES (
          v_grupo_id,
          (o->>'producto_id')::uuid,
          COALESCE((o->>'precio_adicional')::numeric, 0)
        );
      END LOOP;
    END IF;
  END LOOP;
END;
$$;