// controllers/homestayController.ts
import { Response } from 'express';
import { AuthRequest, HomestayInput, HomestayResponse } from '../types';
import { AppError } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';

const formatHomestayResponse = (homestay: {
  id: string;
  vacationId: string;
  name: string;
  address: string;
  coordinates: unknown;
  checkInDate: Date;
  checkOutDate: Date;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}): HomestayResponse => ({
  id: homestay.id,
  vacationId: homestay.vacationId,
  name: homestay.name,
  address: homestay.address,
  coordinates: homestay.coordinates as HomestayResponse['coordinates'],
  checkInDate: homestay.checkInDate.toISOString().split('T')[0],
  checkOutDate: homestay.checkOutDate.toISOString().split('T')[0],
  notes: homestay.notes ?? null,
  createdAt: homestay.createdAt.toISOString(),
  updatedAt: homestay.updatedAt.toISOString(),
});

// ============================================================================
// CREATE HOMESTAY
// ============================================================================

export const createHomestay = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      throw new AppError(401, 'Unauthorized');
    }

    const vacationId = Array.isArray(req.params.vacationId) ? req.params.vacationId[0] : req.params.vacationId;
    const { name, address, checkInDate, checkOutDate, notes } = req.body as HomestayInput;

    if (!name || !address || !checkInDate || !checkOutDate) {
      throw new AppError(400, 'Name, address, checkInDate, and checkOutDate are required');
    }

    const checkIn = new Date(checkInDate);
    const checkOut = new Date(checkOutDate);

    if (checkIn >= checkOut) {
      throw new AppError(400, 'Check-in date must be before check-out date');
    }

    const vacation = await prisma.vacation.findUnique({
      where: { id: vacationId },
    });

    if (!vacation) {
      throw new AppError(404, 'Vacation not found');
    }

    if (vacation.userId !== req.user.id) {
      throw new AppError(403, 'You do not have access to this vacation');
    }

    const homestay = await prisma.homestay.create({
      data: {
        vacationId,
        name,
        address,
        checkInDate: checkIn,
        checkOutDate: checkOut,
        notes: notes ?? null,
      },
    });

    res.status(201).json(formatHomestayResponse(homestay));
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(500, 'Failed to create homestay', { error });
  }
};

// ============================================================================
// GET ALL HOMESTAYS FOR VACATION
// ============================================================================

export const getHomestays = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      throw new AppError(401, 'Unauthorized');
    }

    const vacationId = Array.isArray(req.params.vacationId) ? req.params.vacationId[0] : req.params.vacationId;

    const vacation = await prisma.vacation.findUnique({
      where: { id: vacationId },
    });

    if (!vacation) {
      throw new AppError(404, 'Vacation not found');
    }

    if (vacation.userId !== req.user.id) {
      throw new AppError(403, 'You do not have access to this vacation');
    }

    const homestays = await prisma.homestay.findMany({
      where: { vacationId },
      orderBy: { checkInDate: 'asc' },
    });

    res.json(homestays.map(formatHomestayResponse));
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(500, 'Failed to fetch homestays', { error });
  }
};

// ============================================================================
// GET SINGLE HOMESTAY
// ============================================================================

export const getHomestay = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      throw new AppError(401, 'Unauthorized');
    }

    const vacationId = Array.isArray(req.params.vacationId) ? req.params.vacationId[0] : req.params.vacationId;
    const homestayId = Array.isArray(req.params.homestayId) ? req.params.homestayId[0] : req.params.homestayId;

    const vacation = await prisma.vacation.findUnique({
      where: { id: vacationId },
    });

    if (!vacation) {
      throw new AppError(404, 'Vacation not found');
    }

    if (vacation.userId !== req.user.id) {
      throw new AppError(403, 'You do not have access to this vacation');
    }

    const homestay = await prisma.homestay.findUnique({
      where: { id: homestayId },
    });

    if (!homestay) {
      throw new AppError(404, 'Homestay not found');
    }

    if (homestay.vacationId !== vacationId) {
      throw new AppError(404, 'Homestay not found in this vacation');
    }

    res.json(formatHomestayResponse(homestay));
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(500, 'Failed to fetch homestay', { error });
  }
};

// ============================================================================
// UPDATE HOMESTAY
// ============================================================================

export const updateHomestay = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      throw new AppError(401, 'Unauthorized');
    }

    const vacationId = Array.isArray(req.params.vacationId) ? req.params.vacationId[0] : req.params.vacationId;
    const homestayId = Array.isArray(req.params.homestayId) ? req.params.homestayId[0] : req.params.homestayId;
    const { name, address, checkInDate, checkOutDate, notes } = req.body as Partial<HomestayInput>;

    const vacation = await prisma.vacation.findUnique({
      where: { id: vacationId },
    });

    if (!vacation) {
      throw new AppError(404, 'Vacation not found');
    }

    if (vacation.userId !== req.user.id) {
      throw new AppError(403, 'You do not have access to this vacation');
    }

    const homestay = await prisma.homestay.findUnique({
      where: { id: homestayId },
    });

    if (!homestay) {
      throw new AppError(404, 'Homestay not found');
    }

    if (homestay.vacationId !== vacationId) {
      throw new AppError(404, 'Homestay not found in this vacation');
    }

    if (checkInDate && checkOutDate) {
      const checkIn = new Date(checkInDate);
      const checkOut = new Date(checkOutDate);

      if (checkIn >= checkOut) {
        throw new AppError(400, 'Check-in date must be before check-out date');
      }
    }

    const updated = await prisma.homestay.update({
      where: { id: homestayId },
      data: {
        ...(name && { name }),
        ...(address && { address }),
        ...(checkInDate && { checkInDate: new Date(checkInDate) }),
        ...(checkOutDate && { checkOutDate: new Date(checkOutDate) }),
        ...(notes !== undefined && { notes }),
      },
    });

    res.json(formatHomestayResponse(updated));
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(500, 'Failed to update homestay', { error });
  }
};

// ============================================================================
// DELETE HOMESTAY
// ============================================================================

export const deleteHomestay = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      throw new AppError(401, 'Unauthorized');
    }

    const vacationId = Array.isArray(req.params.vacationId) ? req.params.vacationId[0] : req.params.vacationId;
    const homestayId = Array.isArray(req.params.homestayId) ? req.params.homestayId[0] : req.params.homestayId;

    const vacation = await prisma.vacation.findUnique({
      where: { id: vacationId },
    });

    if (!vacation) {
      throw new AppError(404, 'Vacation not found');
    }

    if (vacation.userId !== req.user.id) {
      throw new AppError(403, 'You do not have access to this vacation');
    }

    const homestay = await prisma.homestay.findUnique({
      where: { id: homestayId },
    });

    if (!homestay) {
      throw new AppError(404, 'Homestay not found');
    }

    if (homestay.vacationId !== vacationId) {
      throw new AppError(404, 'Homestay not found in this vacation');
    }

    await prisma.homestay.delete({
      where: { id: homestayId },
    });

    res.json({ success: true, message: 'Homestay deleted' });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(500, 'Failed to delete homestay', { error });
  }
};
