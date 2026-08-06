-- AlterEnum
ALTER TYPE "TxnType" ADD VALUE 'ADDON_DEBIT';
ALTER TYPE "TxnType" ADD VALUE 'PLAN_FEE';

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "billingGstin" TEXT,
ADD COLUMN     "billingHsnSac" TEXT,
ADD COLUMN     "billingPlaceOfSupply" TEXT;

-- CreateTable
CREATE TABLE "AddOnPurchase" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "monthlyPricePaise" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "AddOnPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AddOnPurchase_workspaceId_idx" ON "AddOnPurchase"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "AddOnPurchase_workspaceId_code_key" ON "AddOnPurchase"("workspaceId", "code");

-- ForeignKey
ALTER TABLE "AddOnPurchase" ADD CONSTRAINT "AddOnPurchase_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
