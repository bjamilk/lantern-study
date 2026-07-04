import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useUIStore } from '../stores/uiStore';
import {
  isAuthAppPath,
  isEphemeralAppMode,
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
    const ephemeral = isEphemeralAppMode(useUIStore.getState().appMode);
    if (ephemeral) return;

    const parsed = parseAppRoute(location.pathname);

    if (location.pathname === '/' && currentUser) {
      navigate('/dashboard', { replace: true });
      return;
    }

    if (parsed.inviteId) {
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
    hydratingRef.current = true;
    setRouteHydrating(true);

    void hydrateAppRoute(parsed).then((result) => {
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

    return () => {
      cancelled = true;
    };
  }, [location.pathname, currentUser, navigate]);

  return { routeHydrating: routeHydrating || hydratingRef.current };
}
