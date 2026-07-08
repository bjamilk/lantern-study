import { Router } from 'express';
import { body } from 'express-validator';
import { asyncHandler } from '../middleware/errorHandler';
import { handleValidationErrors } from '../middleware/validation';
import { optionalAuthMiddleware } from '../middleware/auth';
import { contactFormRateLimit } from '../middleware/rateLimit';
import { validateContactForm, CONTACT_CATEGORIES } from '@lantern/shared/contactForm';
import { sendContactFormEmail, isContactMailConfigured } from '../services/contactMail';
import { resolveClientIp } from '../middleware/rateLimit';
import type { AuthenticatedRequest } from '../types';
import { logger } from '../utils/logger';

const router = Router();

router.post(
  '/',
  contactFormRateLimit,
  optionalAuthMiddleware,
  body('name').isString().trim().isLength({ min: 2, max: 100 }),
  body('email').isEmail().normalizeEmail().isLength({ max: 254 }),
  body('subject').isString().trim().isLength({ min: 3, max: 120 }),
  body('message').isString().trim().isLength({ min: 20, max: 2000 }),
  body('category').isIn([...CONTACT_CATEGORIES]),
  body('source').optional().isIn(['web', 'mobile']),
  body('_hp').optional({ values: 'null' }).isString(),
  handleValidationErrors,
  asyncHandler(async (req: AuthenticatedRequest, res: any) => {
    if (!isContactMailConfigured()) {
      logger.warn('Contact form submitted but email is not configured');
      return res.status(503).json({
        success: false,
        error: 'Contact form is temporarily unavailable. Email support@lanternstudy.com directly.',
      });
    }

    const parsed = validateContactForm(req.body);
    if (!parsed.ok) {
      return res.status(400).json({ success: false, error: parsed.error });
    }

    const source = req.body.source === 'mobile' ? 'mobile' : 'web';

    await sendContactFormEmail({
      payload: parsed.value,
      source,
      userId: req.user?.id ?? null,
      clientIp: resolveClientIp(req),
    });

    res.json({
      success: true,
      message: 'Thanks — we received your message and will reply by email.',
    });
  })
);

export default router;
