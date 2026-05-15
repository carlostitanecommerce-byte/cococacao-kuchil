
-- Add folio column to cajas
ALTER TABLE cajas ADD COLUMN folio integer;

-- Backfill existing rows by fecha_apertura order
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY fecha_apertura ASC)::integer as rn
  FROM cajas
)
UPDATE cajas SET folio = ordered.rn FROM ordered WHERE cajas.id = ordered.id;

-- Create sequence starting after max folio
DO $$
DECLARE max_folio integer;
BEGIN
  SELECT COALESCE(MAX(folio), 0) INTO max_folio FROM cajas;
  EXECUTE format('CREATE SEQUENCE cajas_folio_seq START WITH %s', max_folio + 1);
END $$;

-- Set default and constraints
ALTER TABLE cajas ALTER COLUMN folio SET DEFAULT nextval('cajas_folio_seq');
ALTER TABLE cajas ALTER COLUMN folio SET NOT NULL;
ALTER TABLE cajas ADD CONSTRAINT cajas_folio_key UNIQUE (folio);
