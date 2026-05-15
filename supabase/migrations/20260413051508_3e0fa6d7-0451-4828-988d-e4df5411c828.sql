
-- Enable pgcrypto
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- 1. Create trigger on auth.users for future users
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- 2. Backfill profiles for existing users
INSERT INTO public.profiles (id, nombre, email)
SELECT id, COALESCE(raw_user_meta_data->>'nombre', ''), email
FROM auth.users
WHERE id NOT IN (SELECT id FROM public.profiles)
ON CONFLICT (id) DO NOTHING;

-- 3. Set username and encrypted password directly (avoid function that references pgp_sym_encrypt without schema)
UPDATE public.profiles p
SET username = u.raw_user_meta_data->>'username',
    password_encrypted = extensions.pgp_sym_encrypt(
      CASE u.raw_user_meta_data->>'username'
        WHEN 'daria' THEN 'Dari26'
        WHEN 'grissel' THEN 'Gris26'
        ELSE 'Coco2024!'
      END,
      'coco_y_cacao_secret_key'
    )::bytea
FROM auth.users u
WHERE p.id = u.id;

-- 4. Fix folio sequences
ALTER SEQUENCE ventas_folio_seq RESTART WITH 632;
ALTER SEQUENCE cajas_folio_seq RESTART WITH 56;
