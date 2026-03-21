import express, { type Request, type Response } from 'express';
import { PrismaClient } from '@prisma/client';

const app = express();
const prisma = new PrismaClient();

app.use(express.json());

// Routes will go here
app.get('/api/vacations', async (_req: Request, res: Response) => {
  const vacations = await prisma.vacation.findMany();
  res.json(vacations);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});