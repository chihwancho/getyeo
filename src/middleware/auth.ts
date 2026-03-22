// middleware/auth.ts
import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { extractTokenFromHeader, verifyToken } from '../utils/jwt';

export const authMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = extractTokenFromHeader(req.headers.authorization);

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized', message: 'No token provided' });
  }

  const payload = verifyToken(token);

  if (!payload) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or expired token' });
  }

  req.user = {
    id: payload.userId,
    email: payload.email,
  };

  next();
};