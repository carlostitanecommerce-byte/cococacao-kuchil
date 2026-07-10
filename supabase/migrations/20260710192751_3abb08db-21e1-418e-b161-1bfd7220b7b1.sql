ALTER TABLE public.coworking_sessions
  ADD COLUMN membresia_id UUID NULL
  REFERENCES public.coworking_membresias(id) ON DELETE SET NULL;

CREATE INDEX idx_coworking_sessions_membresia_id
  ON public.coworking_sessions(membresia_id);