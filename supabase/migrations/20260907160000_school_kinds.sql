-- Instructor affiliation is not limited to named universities.
-- Primary and secondary schools may be registered; the student `institutions`
-- view stays tertiary-only so student onboarding is unchanged.

ALTER TABLE public.marketplace_campuses DROP CONSTRAINT IF EXISTS marketplace_campuses_kind_check;
ALTER TABLE public.marketplace_campuses
  ADD CONSTRAINT marketplace_campuses_kind_check
  CHECK (kind IN ('university', 'polytechnic', 'college', 'primary', 'secondary', 'other'));

CREATE OR REPLACE VIEW public.institutions
  WITH (security_invoker = true) AS
  SELECT id, name, city, state, country_code, slug, kind, geopolitical_zone, active
  FROM public.marketplace_campuses
  WHERE kind IN ('university', 'polytechnic', 'college')
    AND active = TRUE;

GRANT SELECT ON public.institutions TO anon, authenticated, service_role;
