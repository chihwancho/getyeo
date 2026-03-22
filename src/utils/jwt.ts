// utils/jwt.ts
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRY = '7d';

export interface JWTPayload {
  userId: string;
  email: string;
}

export const generateToken = (payload: JWTPayload): string => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
};

export const verifyToken = (token: string): JWTPayload | null => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload;
    return decoded;
  } catch (error) {
    return null;
  }
};

export const extractTokenFromHeader = (authHeader?: string): string | null => {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7);
};