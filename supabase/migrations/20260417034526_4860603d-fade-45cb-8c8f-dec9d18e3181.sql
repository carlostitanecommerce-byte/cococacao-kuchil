CREATE OR REPLACE FUNCTION public.replicate_to_destination()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  payload jsonb;
  edge_function_url text;
  anon_key text;
BEGIN
  edge_function_url := 'https://kswzpteyqiughimtmxal.supabase.co/functions/v1/replicate-data';
  anon_key := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtzd3pwdGV5cWl1Z2hpbXRteGFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMzUyOTAsImV4cCI6MjA5MTYxMTI5MH0.Sc6hqMScaKZTi4cBrGXDx_fPZoa6V4bYefSoxkkyZtI';

  payload := jsonb_build_object(
    'table', TG_TABLE_NAME,
    'type', TG_OP,
    'record', CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
    'old_record', CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END
  );

  BEGIN
    PERFORM net.http_post(
      url := edge_function_url,
      body := payload,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || anon_key,
        'apikey', anon_key
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Replicación falló para tabla %: %', TG_TABLE_NAME, SQLERRM;
  END;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;