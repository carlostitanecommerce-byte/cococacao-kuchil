
DO $$
DECLARE
  v_users jsonb := '[
    {"username":"admin","nombre":"Admin","password":"Coco2024!","role":"administrador"},
    {"username":"supervisor","nombre":"Supervisor","password":"Coco2024!","role":"supervisor"},
    {"username":"caja","nombre":"Caja","password":"Coco2024!","role":"caja"},
    {"username":"barista","nombre":"Barista","password":"Coco2024!","role":"barista"},
    {"username":"recepcion","nombre":"Recepcion","password":"Coco2024!","role":"recepcion"}
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

    SELECT id INTO v_uid FROM auth.users WHERE email = v_email;
    IF v_uid IS NULL THEN CONTINUE; END IF;

    -- Actualizar password en auth
    UPDATE auth.users
       SET encrypted_password = extensions.crypt(v_password, extensions.gen_salt('bf')),
           email_confirmed_at = COALESCE(email_confirmed_at, now()),
           raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb)
                                || jsonb_build_object('nombre', v_nombre, 'username', v_username),
           updated_at = now()
     WHERE id = v_uid;

    -- Asegurar identity de email
    IF NOT EXISTS (
      SELECT 1 FROM auth.identities WHERE user_id = v_uid AND provider = 'email'
    ) THEN
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
    END IF;

    -- Profile
    INSERT INTO public.profiles (id, nombre, username)
    VALUES (v_uid, v_nombre, v_username)
    ON CONFLICT (id) DO UPDATE
      SET nombre = EXCLUDED.nombre,
          username = EXCLUDED.username;

    -- Contraseña simétrica interna
    PERFORM public.encrypt_and_save_password(v_uid, v_username, v_password);

    -- Rol
    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_uid, v_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  END LOOP;
END;
$$;
