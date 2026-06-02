CREATE OR REPLACE FUNCTION public.get_decrypted_password(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT has_role(auth.uid(), 'administrador') THEN
    RETURN NULL;
  END IF;

  RETURN (
    SELECT extensions.pgp_sym_decrypt(password_encrypted, 'coco_y_cacao_secret_key')
    FROM public.profiles
    WHERE id = p_user_id
  );
END;
$function$;