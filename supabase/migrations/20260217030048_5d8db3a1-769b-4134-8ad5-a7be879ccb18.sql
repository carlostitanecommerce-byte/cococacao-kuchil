
-- Fix permissive UPDATE policy - restrict to session owner or admin
DROP POLICY "Authenticated users can update sessions" ON public.coworking_sessions;

CREATE POLICY "Users can update own sessions or admin"
  ON public.coworking_sessions FOR UPDATE
  USING (auth.uid() = usuario_id OR public.has_role(auth.uid(), 'administrador'));
