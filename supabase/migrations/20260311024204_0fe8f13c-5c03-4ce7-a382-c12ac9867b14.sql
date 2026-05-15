-- Drop the partially created column from failed migration
ALTER TABLE ventas DROP COLUMN IF EXISTS folio;

-- Add column as integer, nullable first
ALTER TABLE ventas ADD COLUMN folio integer;

-- Backfill existing rows
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY fecha ASC)::integer as rn
  FROM ventas
)
UPDATE ventas SET folio = ordered.rn FROM ordered WHERE ventas.id = ordered.id;

-- Create sequence starting after max folio
DO $$
DECLARE max_folio integer;
BEGIN
  SELECT COALESCE(MAX(folio), 0) INTO max_folio FROM ventas;
  EXECUTE format('CREATE SEQUENCE ventas_folio_seq START WITH %s', max_folio + 1);
END $$;

-- Set default and not null
ALTER TABLE ventas ALTER COLUMN folio SET DEFAULT nextval('ventas_folio_seq');
ALTER TABLE ventas ALTER COLUMN folio SET NOT NULL;
ALTER TABLE ventas ADD CONSTRAINT ventas_folio_key UNIQUE (folio);