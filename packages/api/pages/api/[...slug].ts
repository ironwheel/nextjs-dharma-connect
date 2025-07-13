// packages/api/pages/api/[...slug].ts
import { NextApiRequest, NextApiResponse } from 'next';
import nextConnect from 'next-connect';
import { apiMiddleware } from '../../lib/apiMiddleware';
import { dispatch } from '../../lib/dispatch';

export default nextConnect<NextApiRequest, NextApiResponse>()
  .use(apiMiddleware)
  .all(async (req, res) => {
    const slug = (req.query.slug as string[]) || [];
    try {
      await dispatch(slug, req, res);
    } catch (err: any) {
      res.status(500).json({ message: err.stack });
    }
  });
