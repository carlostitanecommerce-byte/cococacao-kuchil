
-- Add pricing column to areas_coworking
ALTER TABLE public.areas_coworking ADD COLUMN precio_por_hora numeric NOT NULL DEFAULT 0;

-- Create reservation status enum
CREATE TYPE public.reservacion_estado AS ENUM ('pendiente', 'confirmada', 'cancelada', 'completada');

-- Create reservations table
CREATE TABLE public.coworking_reservaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_nombre text NOT NULL,
  area_id uuid NOT NULL REFERENCES public.areas_coworking(id),
  pax_count integer NOT NULL DEFAULT 1,
  fecha_reserva date NOT NULL,
  hora_inicio time NOT NULL,
  duracion_horas numeric NOT NULL DEFAULT 1,
  estado public.reservacion_estado NOT NULL DEFAULT 'pendiente',
  usuario_id uuid NOT NULL,
  notas text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.coworking_reservaciones ENABLE ROW LEVEL SECURITY;

-- RLS policies for reservaciones
CREATE POLICY "Authenticated users can view reservaciones"
  ON public.coworking_reservaciones FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can insert reservaciones"
  ON public.coworking_reservaciones FOR INSERT
  WITH CHECK (auth.uid() = usuario_id);

CREATE POLICY "Users can update own reservaciones or admin"
  ON public.coworking_reservaciones FOR UPDATE
  USING (auth.uid() = usuario_id OR public.has_role(auth.uid(), 'administrador'));

CREATE POLICY "Admins can delete reservaciones"
  ON public.coworking_reservaciones FOR DELETE
  USING (public.has_role(auth.uid(), 'administrador'));

-- Trigger for updated_at
CREATE TRIGGER update_coworking_reservaciones_updated_at
  BEFORE UPDATE ON public.coworking_reservaciones
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.coworking_reservaciones;
