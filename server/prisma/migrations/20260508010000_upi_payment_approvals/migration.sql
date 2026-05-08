-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "upiId" TEXT;

-- AlterTable
ALTER TABLE "Settlement" ADD COLUMN "approvedAt" TIMESTAMP(3);
ALTER TABLE "Settlement" ADD COLUMN "status" "SettlementStatus" NOT NULL DEFAULT 'APPROVED';

-- CreateIndex
CREATE INDEX "Settlement_status_idx" ON "Settlement"("status");

-- New settlement requests should start pending. Existing rows remain approved.
ALTER TABLE "Settlement" ALTER COLUMN "status" SET DEFAULT 'PENDING';
