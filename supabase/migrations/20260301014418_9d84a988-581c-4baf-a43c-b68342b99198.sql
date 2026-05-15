
-- Change foreign keys to CASCADE on delete
ALTER TABLE recetas DROP CONSTRAINT recetas_insumo_id_fkey;
ALTER TABLE recetas ADD CONSTRAINT recetas_insumo_id_fkey
  FOREIGN KEY (insumo_id) REFERENCES insumos(id) ON DELETE CASCADE;

ALTER TABLE mermas DROP CONSTRAINT mermas_insumo_id_fkey;
ALTER TABLE mermas ADD CONSTRAINT mermas_insumo_id_fkey
  FOREIGN KEY (insumo_id) REFERENCES insumos(id) ON DELETE CASCADE;

ALTER TABLE compras_insumos DROP CONSTRAINT compras_insumos_insumo_id_fkey;
ALTER TABLE compras_insumos ADD CONSTRAINT compras_insumos_insumo_id_fkey
  FOREIGN KEY (insumo_id) REFERENCES insumos(id) ON DELETE CASCADE;
