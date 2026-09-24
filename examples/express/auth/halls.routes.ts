import { Router } from 'express';
import { z } from 'zod';
import { requireRole, validateBody } from './auth.middleware.js';

export const createHallSchema = z.object({
  name: z.string().trim().min(2).max(100),
  capacity: z.number().int().min(1).max(2000)
});

/** An Express router using both middlewares; the handler only ever sees a valid body. */
export function hallsRouter(saveHall: (hall: z.infer<typeof createHallSchema>) => Promise<{ id: number }>) {
  const router = Router();
  router.post('/', requireRole('admin'), validateBody(createHallSchema), async (req, res) => {
    const saved = await saveHall(req.body);
    res.status(201).json({ id: saved.id, ...req.body });
  });
  return router;
}
