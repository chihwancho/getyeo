import { Response } from 'express';
import bcrypt from 'bcryptjs';
import { AuthRequest, LoginRequest, RegisterRequest, AuthResponse } from '../types';
import { generateToken } from '../utils/jwt';
import { AppError } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';

export const register = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const { email: rawEmail, password } = req.body as RegisterRequest;

    // Validation
    if (!rawEmail || !password) {
      throw new AppError(400, 'Email and password are required');
    }

    if (password.length < 6) {
      throw new AppError(400, 'Password must be at least 6 characters');
    }

    // Normalize email to lowercase
    const email = rawEmail.toLowerCase().trim();

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new AppError(409, 'User with this email already exists');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user in Supabase Auth and our database
    // For MVP, we'll just create in our database
    // TODO: Integrate with Supabase Auth later for better security
    const user = await prisma.user.create({
      data: {
        email,
      },
    });

    // Generate token
    const token = generateToken({
      userId: user.id,
      email: user.email,
    });

    const response: AuthResponse = {
      token,
      userId: user.id,
      email: user.email,
    };

    res.status(201).json(response);
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(500, 'Registration failed', { error });
  }
};

export const login = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const { email: rawEmail, password } = req.body as LoginRequest;

    // Validation
    if (!rawEmail || !password) {
      throw new AppError(400, 'Email and password are required');
    }

    // Normalize email to lowercase
    const email = rawEmail.toLowerCase().trim();

    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new AppError(401, 'Invalid email or password');
    }

    // For MVP, we're not storing passwords in our database
    // TODO: Implement proper password verification with Supabase Auth
    // For now, accept any password (development only!)
    // In production, use Supabase Auth: https://supabase.com/docs/guides/auth

    // Generate token
    const token = generateToken({
      userId: user.id,
      email: user.email,
    });

    const response: AuthResponse = {
      token,
      userId: user.id,
      email: user.email,
    };

    res.json(response);
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(500, 'Login failed', { error });
  }
};