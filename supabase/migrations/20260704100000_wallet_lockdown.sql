-- Prevent client-side manipulation of server-authoritative wallet fields in user_preferences.

CREATE OR REPLACE FUNCTION public.preserve_wallet_preferences()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  role_name text := COALESCE(auth.role(), current_setting('role', true));
BEGIN
  IF role_name = 'service_role' THEN
    RETURN NEW;
  END IF;

  NEW.preferences := COALESCE(NEW.preferences, '{}'::jsonb);

  IF TG_OP = 'UPDATE' AND OLD.preferences ? 'budgetExtras' THEN
    NEW.preferences := jsonb_set(
      COALESCE(NEW.preferences, '{}'::jsonb),
      '{budgetExtras}',
      COALESCE(NEW.preferences->'budgetExtras', '{}'::jsonb)
        || jsonb_build_object(
          'walletBalance', COALESCE(OLD.preferences->'budgetExtras'->'walletBalance', to_jsonb(0)),
          'walletAwards', COALESCE(OLD.preferences->'budgetExtras'->'walletAwards', '{}'::jsonb)
        ),
      true
    );
  ELSE
    IF NEW.preferences ? 'budgetExtras' THEN
      NEW.preferences := jsonb_set(
        NEW.preferences,
        '{budgetExtras}',
        (NEW.preferences->'budgetExtras') - 'walletBalance' - 'walletAwards',
        true
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.preserve_wallet_preferences() IS
  'Preserves walletBalance/walletAwards unless caller is service_role.';

DROP TRIGGER IF EXISTS user_preferences_preserve_wallet ON public.user_preferences;
CREATE TRIGGER user_preferences_preserve_wallet
  BEFORE INSERT OR UPDATE OF preferences ON public.user_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.preserve_wallet_preferences();
