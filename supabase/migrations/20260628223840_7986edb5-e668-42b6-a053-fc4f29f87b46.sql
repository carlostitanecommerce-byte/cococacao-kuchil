
-- ============================================================
-- Fix: configuracion_ventas_public_read
-- Re-create all policies currently bound to role "public" so they
-- target only "authenticated", preventing anonymous access.
-- ============================================================

-- categorias_maestras
DROP POLICY IF EXISTS "Admins can manage categorias" ON public.categorias_maestras;
CREATE POLICY "Admins can manage categorias" ON public.categorias_maestras FOR ALL TO authenticated USING (has_role(auth.uid(), 'administrador'::app_role));
DROP POLICY IF EXISTS "Authenticated users can view categorias" ON public.categorias_maestras;
CREATE POLICY "Authenticated users can view categorias" ON public.categorias_maestras FOR SELECT TO authenticated USING (true);

-- compras_insumos
DROP POLICY IF EXISTS "Admins can manage compras" ON public.compras_insumos;
CREATE POLICY "Admins can manage compras" ON public.compras_insumos FOR ALL TO authenticated USING (has_role(auth.uid(), 'administrador'::app_role));
DROP POLICY IF EXISTS "Authenticated users can view compras" ON public.compras_insumos;
CREATE POLICY "Authenticated users can view compras" ON public.compras_insumos FOR SELECT TO authenticated USING (true);

-- configuracion_ventas
DROP POLICY IF EXISTS "Admins can manage config" ON public.configuracion_ventas;
CREATE POLICY "Admins can manage config" ON public.configuracion_ventas FOR ALL TO authenticated USING (has_role(auth.uid(), 'administrador'::app_role));
DROP POLICY IF EXISTS "Authenticated can view config" ON public.configuracion_ventas;
CREATE POLICY "Authenticated can view config" ON public.configuracion_ventas FOR SELECT TO authenticated USING (true);

-- coworking_reservaciones
DROP POLICY IF EXISTS "Admins can delete reservaciones" ON public.coworking_reservaciones;
CREATE POLICY "Admins can delete reservaciones" ON public.coworking_reservaciones FOR DELETE TO authenticated USING (has_role(auth.uid(), 'administrador'::app_role));
DROP POLICY IF EXISTS "Authenticated users can insert reservaciones" ON public.coworking_reservaciones;
CREATE POLICY "Authenticated users can insert reservaciones" ON public.coworking_reservaciones FOR INSERT TO authenticated WITH CHECK (auth.uid() = usuario_id);
DROP POLICY IF EXISTS "Authenticated users can view reservaciones" ON public.coworking_reservaciones;
CREATE POLICY "Authenticated users can view reservaciones" ON public.coworking_reservaciones FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Users can update own reservaciones or admin" ON public.coworking_reservaciones;
CREATE POLICY "Users can update own reservaciones or admin" ON public.coworking_reservaciones FOR UPDATE TO authenticated USING ((auth.uid() = usuario_id) OR has_role(auth.uid(), 'administrador'::app_role));

-- coworking_sessions
DROP POLICY IF EXISTS "Admins can delete sessions" ON public.coworking_sessions;
CREATE POLICY "Admins can delete sessions" ON public.coworking_sessions FOR DELETE TO authenticated USING (has_role(auth.uid(), 'administrador'::app_role));
DROP POLICY IF EXISTS "Authenticated users can insert sessions" ON public.coworking_sessions;
CREATE POLICY "Authenticated users can insert sessions" ON public.coworking_sessions FOR INSERT TO authenticated WITH CHECK (auth.uid() = usuario_id);
DROP POLICY IF EXISTS "Authenticated users can view sessions" ON public.coworking_sessions;
CREATE POLICY "Authenticated users can view sessions" ON public.coworking_sessions FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Users can update own sessions or admin" ON public.coworking_sessions;
CREATE POLICY "Users can update own sessions or admin" ON public.coworking_sessions FOR UPDATE TO authenticated USING ((auth.uid() = usuario_id) OR has_role(auth.uid(), 'administrador'::app_role));

-- detalle_ventas
DROP POLICY IF EXISTS "Authenticated users can view detalle_ventas" ON public.detalle_ventas;
CREATE POLICY "Authenticated users can view detalle_ventas" ON public.detalle_ventas FOR SELECT TO authenticated USING (true);

-- insumos
DROP POLICY IF EXISTS "Admins can manage insumos" ON public.insumos;
CREATE POLICY "Admins can manage insumos" ON public.insumos FOR ALL TO authenticated USING (has_role(auth.uid(), 'administrador'::app_role));
DROP POLICY IF EXISTS "Authenticated users can view insumos" ON public.insumos;
CREATE POLICY "Authenticated users can view insumos" ON public.insumos FOR SELECT TO authenticated USING (true);

-- mermas
DROP POLICY IF EXISTS "Admins and supervisors can view mermas" ON public.mermas;
CREATE POLICY "Admins and supervisors can view mermas" ON public.mermas FOR SELECT TO authenticated USING (has_role(auth.uid(), 'administrador'::app_role) OR has_role(auth.uid(), 'supervisor'::app_role));
DROP POLICY IF EXISTS "Admins can delete mermas" ON public.mermas;
CREATE POLICY "Admins can delete mermas" ON public.mermas FOR DELETE TO authenticated USING (has_role(auth.uid(), 'administrador'::app_role));
DROP POLICY IF EXISTS "Authenticated users can insert mermas" ON public.mermas;
CREATE POLICY "Authenticated users can insert mermas" ON public.mermas FOR INSERT TO authenticated WITH CHECK (auth.uid() = usuario_id);

-- movimientos_caja
DROP POLICY IF EXISTS "Admins can delete movimientos" ON public.movimientos_caja;
CREATE POLICY "Admins can delete movimientos" ON public.movimientos_caja FOR DELETE TO authenticated USING (has_role(auth.uid(), 'administrador'::app_role));
DROP POLICY IF EXISTS "Authenticated users can view movimientos" ON public.movimientos_caja;
CREATE POLICY "Authenticated users can view movimientos" ON public.movimientos_caja FOR SELECT TO authenticated USING (true);

-- productos
DROP POLICY IF EXISTS "Admins can manage productos" ON public.productos;
CREATE POLICY "Admins can manage productos" ON public.productos FOR ALL TO authenticated USING (has_role(auth.uid(), 'administrador'::app_role));
DROP POLICY IF EXISTS "Authenticated users can view productos" ON public.productos;
CREATE POLICY "Authenticated users can view productos" ON public.productos FOR SELECT TO authenticated USING (true);

-- recetas
DROP POLICY IF EXISTS "Admins can manage recetas" ON public.recetas;
CREATE POLICY "Admins can manage recetas" ON public.recetas FOR ALL TO authenticated USING (has_role(auth.uid(), 'administrador'::app_role));
DROP POLICY IF EXISTS "Authenticated users can view recetas" ON public.recetas;
CREATE POLICY "Authenticated users can view recetas" ON public.recetas FOR SELECT TO authenticated USING (true);

-- solicitudes_cancelacion
DROP POLICY IF EXISTS "Admins and supervisors can update solicitudes" ON public.solicitudes_cancelacion;
CREATE POLICY "Admins and supervisors can update solicitudes" ON public.solicitudes_cancelacion FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'administrador'::app_role) OR has_role(auth.uid(), 'supervisor'::app_role));
DROP POLICY IF EXISTS "Admins and supervisors can view all solicitudes" ON public.solicitudes_cancelacion;
CREATE POLICY "Admins and supervisors can view all solicitudes" ON public.solicitudes_cancelacion FOR SELECT TO authenticated USING (has_role(auth.uid(), 'administrador'::app_role) OR has_role(auth.uid(), 'supervisor'::app_role));
DROP POLICY IF EXISTS "Users can insert own solicitudes" ON public.solicitudes_cancelacion;
CREATE POLICY "Users can insert own solicitudes" ON public.solicitudes_cancelacion FOR INSERT TO authenticated WITH CHECK (auth.uid() = solicitante_id);
DROP POLICY IF EXISTS "Users can view own solicitudes" ON public.solicitudes_cancelacion;
CREATE POLICY "Users can view own solicitudes" ON public.solicitudes_cancelacion FOR SELECT TO authenticated USING (auth.uid() = solicitante_id);

-- solicitudes_cancelacion_sesiones
DROP POLICY IF EXISTS "Admins can update solicitudes_sesiones" ON public.solicitudes_cancelacion_sesiones;
CREATE POLICY "Admins can update solicitudes_sesiones" ON public.solicitudes_cancelacion_sesiones FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'administrador'::app_role));
DROP POLICY IF EXISTS "Admins can view all solicitudes_sesiones" ON public.solicitudes_cancelacion_sesiones;
CREATE POLICY "Admins can view all solicitudes_sesiones" ON public.solicitudes_cancelacion_sesiones FOR SELECT TO authenticated USING (has_role(auth.uid(), 'administrador'::app_role));
DROP POLICY IF EXISTS "Users can insert own solicitudes_sesiones" ON public.solicitudes_cancelacion_sesiones;
CREATE POLICY "Users can insert own solicitudes_sesiones" ON public.solicitudes_cancelacion_sesiones FOR INSERT TO authenticated WITH CHECK (auth.uid() = solicitante_id);
DROP POLICY IF EXISTS "Users can view own solicitudes_sesiones" ON public.solicitudes_cancelacion_sesiones;
CREATE POLICY "Users can view own solicitudes_sesiones" ON public.solicitudes_cancelacion_sesiones FOR SELECT TO authenticated USING (auth.uid() = solicitante_id);

-- tarifa_amenities_incluidos
DROP POLICY IF EXISTS "Admins can manage amenities" ON public.tarifa_amenities_incluidos;
CREATE POLICY "Admins can manage amenities" ON public.tarifa_amenities_incluidos FOR ALL TO authenticated USING (has_role(auth.uid(), 'administrador'::app_role));
DROP POLICY IF EXISTS "Authenticated users can view amenities" ON public.tarifa_amenities_incluidos;
CREATE POLICY "Authenticated users can view amenities" ON public.tarifa_amenities_incluidos FOR SELECT TO authenticated USING (true);

-- tarifa_upsells
DROP POLICY IF EXISTS "Admins can manage upsells" ON public.tarifa_upsells;
CREATE POLICY "Admins can manage upsells" ON public.tarifa_upsells FOR ALL TO authenticated USING (has_role(auth.uid(), 'administrador'::app_role));
DROP POLICY IF EXISTS "Authenticated users can view upsells" ON public.tarifa_upsells;
CREATE POLICY "Authenticated users can view upsells" ON public.tarifa_upsells FOR SELECT TO authenticated USING (true);

-- tarifas_coworking
DROP POLICY IF EXISTS "Admins can manage tarifas" ON public.tarifas_coworking;
CREATE POLICY "Admins can manage tarifas" ON public.tarifas_coworking FOR ALL TO authenticated USING (has_role(auth.uid(), 'administrador'::app_role));
DROP POLICY IF EXISTS "Authenticated users can view tarifas" ON public.tarifas_coworking;
CREATE POLICY "Authenticated users can view tarifas" ON public.tarifas_coworking FOR SELECT TO authenticated USING (true);

-- ventas
DROP POLICY IF EXISTS "Authenticated users can view ventas" ON public.ventas;
CREATE POLICY "Authenticated users can view ventas" ON public.ventas FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Users can insert own ventas" ON public.ventas;
CREATE POLICY "Users can insert own ventas" ON public.ventas FOR INSERT TO authenticated WITH CHECK (auth.uid() = usuario_id);
DROP POLICY IF EXISTS "Users can update own ventas or admin" ON public.ventas;
CREATE POLICY "Users can update own ventas or admin" ON public.ventas FOR UPDATE TO authenticated USING ((auth.uid() = usuario_id) OR has_role(auth.uid(), 'administrador'::app_role));


-- ============================================================
-- Fix: realtime_messages_no_rls
-- Enable RLS on realtime.messages and restrict broadcast/presence
-- access to authenticated users only. This prevents anonymous
-- clients from subscribing to any channel topic.
-- ============================================================
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read realtime messages" ON realtime.messages;
CREATE POLICY "Authenticated can read realtime messages"
ON realtime.messages
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Authenticated can send realtime messages" ON realtime.messages;
CREATE POLICY "Authenticated can send realtime messages"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (true);
