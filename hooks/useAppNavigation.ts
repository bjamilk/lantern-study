import { useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppMode } from '../types';
import { AppRouteParams } from '../utils/appRoutes';
import {
  applyPreNavigationEffects,
  buildParamsFromState,
  navigateForAppMode,
  registerAppNavigator,
  unregisterAppNavigator,
} from '../utils/appNavigation';
import { buildAppPath } from '../utils/appRoutes';
import { useUIStore } from '../stores/uiStore';

export function useAppNavigation() {
  const navigate = useNavigate();

  useEffect(() => {
    registerAppNavigator(navigate);
    return () => unregisterAppNavigator();
  }, [navigate]);

  const navigateTo = useCallback(
    (mode: AppMode, params?: AppRouteParams, options?: { replace?: boolean }) => {
      const resolvedParams = params ?? buildParamsFromState(mode);
      applyPreNavigationEffects(mode, resolvedParams);
      const path = buildAppPath(mode, resolvedParams);
      if (path) {
        navigate(path, { replace: options?.replace ?? false });
        useUIStore.getState().setAppModeDirect(mode);
      } else {
        navigateForAppMode(mode, params, options);
      }
    },
    [navigate]
  );

  const navigateToPath = useCallback(
    (path: string, options?: { replace?: boolean }) => {
      navigate(path, { replace: options?.replace ?? false });
    },
    [navigate]
  );

  return { navigateTo, navigateToPath };
}
