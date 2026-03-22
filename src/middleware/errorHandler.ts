// middleware/errorHandler.ts
import { Request, Response, NextFunction } from 'express';
import { ErrorResponse } from '../types';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: Record<string, any>
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  console.error(err);

  if (err instanceof AppError) {
    const response: ErrorResponse = {
      error: err.name,
      message: err.message,
      ...(err.details && { details: err.details }),
    };
    return res.status(err.statusCode).json(response);
  }

  // Default error
  const response: ErrorResponse = {
    error: 'Internal Server Error',
    message: err.message || 'An unexpected error occurred',
  };

  res.status(500).json(response);
};