import express, { type Express } from 'express';

/**
 * A route that forwards to another service (a backend-for-frontend), like an admin API in front
 * of a core API: check the request, pass the caller's token on, translate the other service's
 * errors, and return only the fields the client needs.
 *
 * The app is built by a function and not started here: tests import createApp() and call it
 * with supertest, and server.ts (not shown) calls app.listen(). A file that both builds the app
 * and listens cannot be tested without starting a real server.
 */
export function createApp({ membersApiUrl }: { membersApiUrl: string }): Express {
  const app = express();

  app.get('/api/members/:id', async (req, res) => {
    if (!/^\d+$/.test(req.params.id)) {
      res.status(400).json({ error: 'Member id must be a number' });
      return;
    }
    const token = req.header('authorization');
    if (!token) {
      res.status(401).json({ error: 'Sign in first' });
      return;
    }

    try {
      const upstream = await fetch(`${membersApiUrl}/members/${req.params.id}`, {
        headers: { authorization: token }
      });
      if (upstream.status === 404) {
        res.status(404).json({ error: 'Member not found' });
        return;
      }
      if (!upstream.ok) {
        res.status(502).json({ error: 'The members service failed' });
        return;
      }
      const member = (await upstream.json()) as { id: number; name: string };
      res.json({ id: member.id, name: member.name });
    } catch {
      res.status(502).json({ error: 'The members service could not be reached' });
    }
  });

  return app;
}
