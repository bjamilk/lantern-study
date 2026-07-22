import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { optionalAuthMiddleware } from '../middleware/auth';
import { analyticsEventsRateLimit } from '../middleware/rateLimit';
import {
  isProductEventName,
  sanitizeEventProps,
  type ProductEventSurface,
} from '@lantern/shared/analytics';
import type { AuthenticatedRequest } from '../types';
import type { SupabaseService } from '../services/supabase';
import { logger } from '../utils/logger';

const MAX_BATCH = 25;

let supabaseService: SupabaseService;

export function initializeAnalyticsRoutes(service: SupabaseService): void {
  supabaseService = service;
}

const router = Router();

router.post(
  '/events',
  analyticsEventsRateLimit,
  optionalAuthMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    const body = req.body || {};
    const rawEvents = Array.isArray(body.events) ? body.events : [];
    if (rawEvents.length === 0) {
      return res.status(400).json({ success: false, error: 'events array is required.' });
    }
    if (rawEvents.length > MAX_BATCH) {
      return res.status(400).json({ success: false, error: `At most ${MAX_BATCH} events per request.` });
    }

    const defaultSurface: ProductEventSurface =
      body.surface === 'mobile' ? 'mobile' : 'web';
    const userId = req.user?.id ?? null;

    const rows: Array<{
      user_id: string | null;
      anon_id: string | null;
      session_id: string | null;
      event: string;
      surface: ProductEventSurface;
      props: Record<string, unknown>;
      campus: string | null;
    }> = [];

    for (const item of rawEvents) {
      if (!item || typeof item !== 'object') continue;
      const eventRaw = (item as { event?: unknown }).event;
      if (!isProductEventName(eventRaw)) continue;
      const eventName = eventRaw;

      const surface: ProductEventSurface =
        (item as { surface?: unknown }).surface === 'mobile' ? 'mobile' : defaultSurface;
      const props = sanitizeEventProps((item as { props?: unknown }).props);
      const campusRaw = (item as { campus?: unknown }).campus;
      const campus =
        typeof campusRaw === 'string' && campusRaw.trim()
          ? campusRaw.trim().slice(0, 120)
          : null;
      const anonRaw = (item as { anonId?: unknown }).anonId;
      const sessionRaw = (item as { sessionId?: unknown }).sessionId;
      const anon_id =
        typeof anonRaw === 'string' && anonRaw.trim()
          ? anonRaw.trim().slice(0, 80)
          : null;
      const session_id =
        typeof sessionRaw === 'string' && sessionRaw.trim()
          ? sessionRaw.trim().slice(0, 80)
          : null;

      // Guests must send anon_id; signed-in users may omit it.
      if (!userId && !anon_id) continue;

      rows.push({
        user_id: userId,
        anon_id,
        session_id,
        event: eventName,
        surface,
        props,
        campus,
      });
    }

    if (rows.length === 0) {
      return res.status(400).json({ success: false, error: 'No valid events in batch.' });
    }

    const { error } = await supabaseService.getClient().from('product_events').insert(rows);
    if (error) {
      logger.warn('product_events insert failed', { error: error.message, count: rows.length });
      return res.status(500).json({ success: false, error: 'Failed to record events.' });
    }

    res.json({ success: true, accepted: rows.length });
  })
);

export default router;
