import { Router } from 'express';
import { requireSelfOrRole } from './auth.middleware.js';

/** A user's own bookings: readable by that user and by admins, nobody else. */
export function userBookingsRouter(listBookings: (userId: number) => Promise<unknown[]>) {
  const router = Router();
  router.get('/:userId/bookings', requireSelfOrRole('admin'), async (req, res) => {
    res.json(await listBookings(Number(req.params.userId)));
  });
  return router;
}
