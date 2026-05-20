
-- 1) Asegurar que la función de encriptación encuentre pgp_sym_encrypt (vive en schema 'extensions')
CREATE OR REPLACE FUNCTION public.encrypt_and_save_password(p_user_id uuid, p_username text, p_password text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $fn$
BEGIN
  UPDATE public.profiles
  SET username = p_username,
      password_encrypted = extensions.pgp_sym_encrypt(p_password, 'coco_y_cacao_secret_key')::bytea
  WHERE id = p_user_id;
END;
$fn$;

-- 2) Crear los 8 usuarios (idempotente)
DO $$
DECLARE
  v_users jsonb := '[
    {"username":"admin","nombre":"Admin","password":"Coco2024!","role":"administrador"},
    {"username":"supervisor","nombre":"Supervisor","password":"Coco2024!","role":"supervisor"},
    {"username":"caja","nombre":"Caja","password":"Coco2024!","role":"caja"},
    {"username":"barista","nombre":"Barista","password":"Coco2024!","role":"barista"},
    {"username":"recepcion","nombre":"Recepcion","password":"Coco2024!","role":"recepcion"},
    {"username":"carlos123","nombre":"Carlos123","password":"Coco2024!","role":"administrador"},
    {"username":"daria","nombre":"Daria","password":"Dari26","role":"caja"},
    {"username":"grissel","nombre":"Grissel","password":"Gris26","role":"caja"}
  ]'::jsonb;
  u jsonb;
  v_uid uuid;
  v_email text;
  v_username text;
  v_nombre text;
  v_password text;
  v_role app_role;
BEGIN
  FOR u IN SELECT * FROM jsonb_array_elements(v_users) LOOP
    v_username := u->>'username';
    v_nombre   := u->>'nombre';
    v_password := u->>'password';
    v_role     := (u->>'role')::app_role;
    v_email    := v_username || '@cocoycacao.local';

    IF EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
      CONTINUE;
    END IF;

    v_uid := gen_random_uuid();

    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token,
      email_change_token_new, email_change
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_uid, 'authenticated', 'authenticated',
      v_email, extensions.crypt(v_password, extensions.gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('nombre', v_nombre, 'username', v_username),
      now(), now(), '', '', '', ''
    );

    INSERT INTO auth.identities (
      id, user_id, identity_data, provider, provider_id,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), v_uid,
      jsonb_build_object('sub', v_uid::text, 'email', v_email,
                         'email_verified', true, 'phone_verified', false),
      'email', v_uid::text,
      now(), now(), now()
    );

    INSERT INTO public.profiles (id, nombre, username)
    VALUES (v_uid, v_nombre, v_username)
    ON CONFLICT (id) DO UPDATE
      SET nombre = EXCLUDED.nombre,
          username = EXCLUDED.username;

    PERFORM public.encrypt_and_save_password(v_uid, v_username, v_password);

    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_uid, v_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  END LOOP;
END;
$$;
