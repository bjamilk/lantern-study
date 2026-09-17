import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useUIStore } from '../stores/uiStore';
import {
  isAuthAppPath,
  isPublicAppPath,
  parseAppRoute,
} from '../utils/appRoutes';
import {
  consumePostLoginRedirect,
  registerAppNavigator,
  storePostLoginRedirect,
  unregisterAppNavigator,
} from '../utils/appNavigation';
import {
  recordSurfaceVisit,
  syncOnboardingVisitedFromSettings,
} from '../utils/onboardingVisited';
import { hydrateAppRoute } from './useRouteHydration';

export function useRouteSync() {
  const location = useLocation();
  const navigate = useNavigate();
  /**
   * Route hydration keys on the OWNER, not on the user object.
   *
   * `currentUser` is replaced wholesale by every gamification sync, settings
   * write, avatar change and admin-flag refresh. The hydration effect below
   * depends on it, so each of those re-ran the effect and re-hydrated the
   * current route — and `/notes` hydrates by firing `loadFolders()` and
   * `loadNotes()`. Opening Notes therefore made roughly ten identical
   * GET /notes + GET /notes/folders pairs while the same student sat still.
   * The id changes exactly when the person does, which is what this effect
   * actually cares about.
   */
  const currentUserId = useAuthStore((s) => s.currentUser?.id ?? null);
  const [routeHydrating, setRouteHydrating] = useState(false);
  const hydratingRef = useRef(false);
  const postLoginHandled = useRef(false);

  useEffect(() => {
    registerAppNavigator(navigate);
    return () => unregisterAppNavigator();
  }, [navigate]);

  useEffect(() => {
    if (!currentUserId || postLoginHandled.current) return;
    const redirect = consumePostLoginRedirect();
    if (redirect && redirect !== location.pathname) {
      postLoginHandled.current = true;
      navigate(redirect, { replace: true });
    }
  }, [currentUserId, location.pathname, navigate]);

  /**
   * Pull the account's checklist flags down when the student changes.
   *
   * The profile arrives with `currentUser`, so reading it once here is enough,
   * and the merge is an OR — a flag ticked on another device appears, and
   * nothing this device already knows is lost. Keyed on the id alone, for the
   * same reason the hydration effect below is: `currentUser` is replaced by
   * every settings write, and this must not re-run on each one.
   */
  useEffect(() => {
    if (!currentUserId) return;
    const user = useAuthStore.getState().currentUser;
    if (user?.id !== currentUserId) return;
    syncOnboardingVisitedFromSettings(currentUserId, user.settings);
  }, [currentUserId]);

  useEffect(() => {
    const parsed = parseAppRoute(location.pathname);

    if (location.pathname === '/' && currentUserId) {
      navigate('/dashboard', { replace: true });
      return;
    }

    if (parsed.inviteId || parsed.shareToken) {
      return;
    }

    // `/me` is a real destination App.tsx renders from the path. It has no
    // AppMode, so it must not fall through to the "unknown path" bounce below —
    // and it must not disturb the mode the student came from, so Back returns
    // them to the screen they left.
    if (parsed.standalone) {
      if (!currentUserId) {
        const path = location.pathname.replace(/\/$/, '') || '/';
        // Guest /teach is the instructor marketing page, not a login wall.
        if (!(parsed.standalone === 'teach' && path === '/teach')) {
          storePostLoginRedirect(location.pathname + location.search);
        }
      }
      return;
    }

    if (isAuthAppPath(location.pathname)) {
      if (currentUserId) {
        navigate('/dashboard', { replace: true });
      }
      return;
    }

    if (parsed.redirect) {
      if (currentUserId) {
        navigate(parsed.redirect, { replace: true });
      }
      return;
    }

    if (!currentUserId) {
      if (!isPublicAppPath(location.pathname) && parsed.mode) {
        storePostLoginRedirect(location.pathname + location.search);
      }
      return;
    }

    if (!parsed.mode) {
      if (!isPublicAppPath(location.pathname)) {
        navigate('/dashboard', { replace: true });
      }
      return;
    }

    let cancelled = false;
    let settled = false;

    void hydrateAppRoute(parsed).then((result) => {
      settled = true;
      hydratingRef.current = false;
      if (cancelled) return;
      setRouteHydrating(false);

      if (result.redirect) {
        navigate(result.redirect, { replace: true });
        return;
      }
      if (result.mode) {
        useUIStore.getState().setAppModeDirect(result.mode);
        // "Has ever opened" for the Home onboarding checklist (issue #68).
        // This is the one place every routed landing passes through, and the
        // checklist only renders on Home, so it could never see these itself.
        // The local cache is written synchronously and the account copy is
        // sent afterwards, on the first visit only — navigation never waits
        // for that write and never fails because of it.
        recordSurfaceVisit(currentUserId, result.mode);
      }
    });

    // The hydrating flag swaps the whole screen for a spinner, which unmounts
    // whatever the user is looking at. Routes that hydrate synchronously never
    // need that: the Library rewriting its own path on a tab click is one, and
    // blanking the note list — losing its scroll position — to confirm a tab
    // switch is worse than not confirming it. Their `then` above is already
    // queued, so it runs first and this sees `settled`. Routes that really
    // fetch still raise the spinner, one microtask later, which is not a delay
    // a person can see.
    void Promise.resolve().then(() => {
      if (cancelled || settled) return;
      hydratingRef.current = true;
      setRouteHydrating(true);
    });

    return () => {
      cancelled = true;
      hydratingRef.current = false;
    };
  }, [location.pathname, currentUserId, navigate]);

  return { routeHydrating };
}
