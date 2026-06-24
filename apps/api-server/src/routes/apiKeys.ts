import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { jwtOnlyAuthMiddleware } from '../middleware/auth';
import {
  handleValidationErrors,
  validateApiKeyCreation,
  validateKeyId,
} from '../middleware/validation';
import { requireAuthUserId } from '../utils/requestAuth';
import { apiKeyService } from '../services/apiKey';
import { clientErrorMessage } from '../utils/safeError';

const router = Router();

router.use(jwtOnlyAuthMiddleware);

router.get(
  '/',
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const keys = await apiKeyService.listKeys(userId);
    res.json({ success: true, data: keys });
  })
);

router.post(
  '/',
  validateApiKeyCreation,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const { name, permissions } = req.body;
    try {
      const created = await apiKeyService.createKey(userId, name, permissions);
      res.status(201).json({
        success: true,
        data: {
          id: created.id,
          name: created.name,
          keyPrefix: created.keyPrefix,
          permissions: created.permissions,
          expiresAt: created.expiresAt,
          createdAt: created.createdAt,
          secret: created.secret,
        },
        message: 'Store this secret now; it will not be shown again.',
      });
    } catch (error: any) {
      res.status(400).json({ success: false, error: clientErrorMessage(error, 'Could not create API key') });
    }
  })
);

router.delete(
  '/:keyId',
  validateKeyId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    await apiKeyService.revokeKey(userId, req.params.keyId);
    res.json({ success: true });
  })
);

router.post(
  '/:keyId/rotate',
  validateKeyId,
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    try {
      const rotated = await apiKeyService.rotateKey(userId, req.params.keyId, req.body?.name);
      res.json({
        success: true,
        data: {
          id: rotated.id,
          name: rotated.name,
          keyPrefix: rotated.keyPrefix,
          permissions: rotated.permissions,
          expiresAt: rotated.expiresAt,
          createdAt: rotated.createdAt,
          secret: rotated.secret,
        },
        message: 'Store this secret now; it will not be shown again.',
      });
    } catch (error: any) {
      res.status(400).json({ success: false, error: clientErrorMessage(error, 'Could not rotate API key') });
    }
  })
);

export default router;
