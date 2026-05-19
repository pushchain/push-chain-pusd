/**
 * usePageView — fires a GA4 page_view on initial mount and on every route
 * change. Paired with `send_page_view: false` on the gtag config in
 * index.html so the auto-pageview doesn't double-count with our manual one.
 */

import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { analytics } from '../lib/analytics';

export function usePageView(): void {
  const location = useLocation();
  useEffect(() => {
    analytics.pageView(location.pathname + location.search, document.title);
  }, [location.pathname, location.search]);
}
