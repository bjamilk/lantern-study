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
import { hydrateAppRoute } from './useRouteHydration';

export function useRouteSync() {
  const location = useLocation();
  const navigate = useNavigate();
  const currentUser = useAuthStore((s) => s.currentUser);
  const [routeHydrating, setRouteHydrating] = useState(false);
  const hydratingRef = useRef(false);
  const postLoginHandled = useRef(false);

  useEffect(() => {
    registerAppNavigator(navigate);
    return () => unregisterAppNavigator();
  }, [navigate]);

  useEffect(() => {
    if (!currentUser || postLoginHandled.current) return;
    const redirect = consumePostLoginRedirect();
    if (redirect && redirect !== location.pathname) {
      postLoginHandled.current = true;
      navigate(redirect, { replace: true });
    }
  }, [currentUser, location.pathname, navigate]);

  useEffect(() => {
    const parsed = parseAppRoute(location.pathname);

    if (location.pathname === '/' && currentUser) {
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
      if (!currentUser) {
        storePostLoginRedirect(location.pathname + location.search);
      }
      return;
    }

    if (isAuthAppPath(location.pathname)) {
      if (currentUser) {
        navigate('/dashboard', { replace: true });
      }
      return;
    }

    if (parsed.redirect) {
      if (currentUser) {
        navigate(parsed.redirect, { replace: true });
      }
      return;
    }

    if (!currentUser) {
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
      if (cancelled) return;
      hydratingRef.current = false;
      setRouteHydrating(false);

      if (result.redirect) {
        navigate(result.redirect, { replace: true });
        return;
      }
      if (result.mode) {
        useUIStore.getState().setAppModeDirect(result.mode);
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
    };
  }, [location.pathname, currentUser, navigate]);

  return { routeHydrating: routeHydrating || hydratingRef.current };
}
