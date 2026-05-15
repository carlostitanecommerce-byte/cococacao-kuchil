
-- Enable pgcrypto
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Rename column
ALTER TABLE public.profiles RENAME COLUMN password_visible TO password_encrypted;

-- Encrypt existing plaintext passwords
UPDATE public.profiles
SET password_encrypted = encode(pgp_sym_encrypt(password_encrypted, 'coco_y_cacao_secret_key')::bytea, 'base64')
WHERE password_encrypted IS NOT NULL;

-- Alter column type to bytea for proper storage
ALTER TABLE public.profiles ALTER COLUMN password_encrypted TYPE bytea USING decode(password_encrypted, 'base64');

-- Function to encrypt and save password (called from Edge Function)
CREATE OR REPLACE FUNCTION public.encrypt_and_save_password(p_user_id uuid, p_username text, p_password text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE profiles
  SET username = p_username,
      password_encrypted = pgp_sym_encrypt(p_password, 'coco_y_cacao_secret_key')::bytea
  WHERE id = p_user_id;
END;
$$;

-- Function to decrypt password (admin only)
CREATE OR REPLACE FUNCTION public.get_decrypted_password(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'administrador') THEN
    RETURN NULL;
  END IF;

  RETURN (
    SELECT pgp_sym_decrypt(password_encrypted, 'coco_y_cacao_secret_key')
    FROM profiles
    WHERE id = p_user_id
  );
END;
$$;
