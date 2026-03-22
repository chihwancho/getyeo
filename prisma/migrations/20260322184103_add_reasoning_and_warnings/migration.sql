-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('RESTAURANT', 'SIGHTSEEING', 'ACTIVITY', 'TRAVEL');

-- CreateEnum
CREATE TYPE "ActivityPriority" AS ENUM ('MUST_HAVE', 'NICE_TO_HAVE', 'FLEXIBLE');

-- CreateEnum
CREATE TYPE "TimeConstraint" AS ENUM ('SPECIFIC_TIME', 'MORNING', 'AFTERNOON', 'EVENING', 'ANYTIME');

-- CreateEnum
CREATE TYPE "ActivitySource" AS ENUM ('USER_ENTERED', 'AI_SUGGESTED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vacations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "parentVacationId" TEXT,
    "variant" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vacations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vacation_versions" (
    "id" TEXT NOT NULL,
    "vacationId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vacation_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "homestays" (
    "id" TEXT NOT NULL,
    "vacationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "coordinates" JSONB,
    "checkInDate" TIMESTAMP(3) NOT NULL,
    "checkOutDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "homestays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "days" (
    "id" TEXT NOT NULL,
    "vacationId" TEXT NOT NULL,
    "homestayId" TEXT,
    "date" DATE NOT NULL,
    "notes" TEXT,
    "aiWarnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" TEXT NOT NULL,
    "dayId" TEXT,
    "vacationId" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "coordinates" JSONB,
    "googlePlacesId" TEXT,
    "time" TEXT,
    "duration" INTEGER,
    "timeConstraint" "TimeConstraint" NOT NULL,
    "position" INTEGER,
    "priority" "ActivityPriority" NOT NULL,
    "source" "ActivitySource" NOT NULL DEFAULT 'USER_ENTERED',
    "notes" TEXT,
    "reasoning" TEXT,
    "travelTimeTo" JSONB,
    "estimatedCost" DOUBLE PRECISION,
    "metadata" JSONB,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "vacations_userId_idx" ON "vacations"("userId");

-- CreateIndex
CREATE INDEX "vacations_parentVacationId_idx" ON "vacations"("parentVacationId");

-- CreateIndex
CREATE INDEX "vacation_versions_vacationId_idx" ON "vacation_versions"("vacationId");

-- CreateIndex
CREATE UNIQUE INDEX "vacation_versions_vacationId_versionNumber_key" ON "vacation_versions"("vacationId", "versionNumber");

-- CreateIndex
CREATE INDEX "homestays_vacationId_idx" ON "homestays"("vacationId");

-- CreateIndex
CREATE INDEX "days_vacationId_idx" ON "days"("vacationId");

-- CreateIndex
CREATE INDEX "days_homestayId_idx" ON "days"("homestayId");

-- CreateIndex
CREATE UNIQUE INDEX "days_vacationId_date_key" ON "days"("vacationId", "date");

-- CreateIndex
CREATE INDEX "activities_dayId_idx" ON "activities"("dayId");

-- CreateIndex
CREATE INDEX "activities_vacationId_idx" ON "activities"("vacationId");

-- CreateIndex
CREATE INDEX "activities_googlePlacesId_idx" ON "activities"("googlePlacesId");

-- AddForeignKey
ALTER TABLE "vacations" ADD CONSTRAINT "vacations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacation_versions" ADD CONSTRAINT "vacation_versions_vacationId_fkey" FOREIGN KEY ("vacationId") REFERENCES "vacations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homestays" ADD CONSTRAINT "homestays_vacationId_fkey" FOREIGN KEY ("vacationId") REFERENCES "vacations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "days" ADD CONSTRAINT "days_vacationId_fkey" FOREIGN KEY ("vacationId") REFERENCES "vacations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "days" ADD CONSTRAINT "days_homestayId_fkey" FOREIGN KEY ("homestayId") REFERENCES "homestays"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "days"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_vacationId_fkey" FOREIGN KEY ("vacationId") REFERENCES "vacations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
