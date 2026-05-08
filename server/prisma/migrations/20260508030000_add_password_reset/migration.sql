-- AddColumn resetToken and resetTokenExpiresAt to User table
ALTER TABLE "User" ADD COLUMN "resetToken" TEXT,
ADD COLUMN "resetTokenExpiresAt" TIMESTAMP(3);
