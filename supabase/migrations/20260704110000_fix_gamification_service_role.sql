-- Ensure service-role writes bypass gamification/wallet preservation triggers.

CREATE OR REPLACE FUNCTION public.is_service_role_caller()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(
    auth.role(),
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    current_setting('role', true)
  ) = 'service_role';
$$;

CREATE OR REPLACE FUNCTION public.preserve_gamification_profile_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF public.is_service_role_caller() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    NEW.points := OLD.points;
    NEW.badges := OLD.badges;
    NEW.stats := OLD.stats;
  ELSE
    NEW.points := COALESCE(NEW.points, 0);
    NEW.badges := COALESCE(NEW.badges, '[]'::jsonb);
    NEW.stats := COALESCE(NEW.stats, '{}'::jsonb);
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.preserve_wallet_preferences()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF public.is_service_role_caller() THEN
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
