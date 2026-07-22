import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { trackPageView } from '../services/productAnalytics';

/** Fires consent-gated page_view events on client route changes. */
export function ProductAnalyticsRouteListener() {
  const location = useLocation();

  useEffect(() => {
    trackPageView(location.pathname);
  }, [location.pathname]);

  return null;
}

export default ProductAnalyticsRouteListener;
