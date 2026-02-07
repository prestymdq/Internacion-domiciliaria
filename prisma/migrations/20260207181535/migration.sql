-- AlterTable
ALTER TABLE "ClinicalNote" ADD COLUMN     "structured" JSONB;

-- AlterTable
ALTER TABLE "Episode" ADD COLUMN     "workflowStageId" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "authorizationId" TEXT,
ADD COLUMN     "planId" TEXT;

-- AlterTable
ALTER TABLE "InvoiceItem" ADD COLUMN     "honorarium" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PickList" ADD COLUMN     "stockCommittedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PickListItem" ADD COLUMN     "warehouseId" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "reorderPoint" INTEGER;

-- AlterTable
ALTER TABLE "VisitItem" ADD COLUMN     "warehouseId" TEXT;

-- CreateTable
CREATE TABLE "BillingRule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "payerId" TEXT NOT NULL,
    "planId" TEXT,
    "productId" TEXT NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "honorarium" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EpisodeCarePlan" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "summary" TEXT,
    "frequency" TEXT,
    "objectives" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EpisodeCarePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EpisodeWorkflowStage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isTerminal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EpisodeWorkflowStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitChecklistItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicalAttachment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "episodeId" TEXT,
    "visitId" TEXT,
    "noteId" TEXT,
    "fileKey" TEXT NOT NULL,
    "fileUrl" TEXT,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClinicalAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BillingRule_tenantId_payerId_planId_idx" ON "BillingRule"("tenantId", "payerId", "planId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingRule_tenantId_payerId_planId_productId_key" ON "BillingRule"("tenantId", "payerId", "planId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "EpisodeCarePlan_episodeId_key" ON "EpisodeCarePlan"("episodeId");

-- CreateIndex
CREATE INDEX "EpisodeCarePlan_tenantId_episodeId_idx" ON "EpisodeCarePlan"("tenantId", "episodeId");

-- CreateIndex
CREATE INDEX "EpisodeWorkflowStage_tenantId_sortOrder_idx" ON "EpisodeWorkflowStage"("tenantId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "EpisodeWorkflowStage_tenantId_name_key" ON "EpisodeWorkflowStage"("tenantId", "name");

-- CreateIndex
CREATE INDEX "VisitChecklistItem_tenantId_idx" ON "VisitChecklistItem"("tenantId");

-- CreateIndex
CREATE INDEX "VisitChecklistItem_visitId_idx" ON "VisitChecklistItem"("visitId");

-- CreateIndex
CREATE INDEX "ClinicalAttachment_tenantId_patientId_idx" ON "ClinicalAttachment"("tenantId", "patientId");

-- CreateIndex
CREATE INDEX "ClinicalAttachment_visitId_idx" ON "ClinicalAttachment"("visitId");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_authorizationId_idx" ON "Invoice"("tenantId", "authorizationId");

-- CreateIndex
CREATE INDEX "PickListItem_pickListId_idx" ON "PickListItem"("pickListId");

-- AddForeignKey
ALTER TABLE "Episode" ADD CONSTRAINT "Episode_workflowStageId_fkey" FOREIGN KEY ("workflowStageId") REFERENCES "EpisodeWorkflowStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickListItem" ADD CONSTRAINT "PickListItem_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_planId_fkey" FOREIGN KEY ("planId") REFERENCES "PayerPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_authorizationId_fkey" FOREIGN KEY ("authorizationId") REFERENCES "Authorization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingRule" ADD CONSTRAINT "BillingRule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingRule" ADD CONSTRAINT "BillingRule_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "Payer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingRule" ADD CONSTRAINT "BillingRule_planId_fkey" FOREIGN KEY ("planId") REFERENCES "PayerPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingRule" ADD CONSTRAINT "BillingRule_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitItem" ADD CONSTRAINT "VisitItem_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpisodeCarePlan" ADD CONSTRAINT "EpisodeCarePlan_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpisodeCarePlan" ADD CONSTRAINT "EpisodeCarePlan_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpisodeWorkflowStage" ADD CONSTRAINT "EpisodeWorkflowStage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitChecklistItem" ADD CONSTRAINT "VisitChecklistItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitChecklistItem" ADD CONSTRAINT "VisitChecklistItem_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitChecklistItem" ADD CONSTRAINT "VisitChecklistItem_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalAttachment" ADD CONSTRAINT "ClinicalAttachment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalAttachment" ADD CONSTRAINT "ClinicalAttachment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalAttachment" ADD CONSTRAINT "ClinicalAttachment_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalAttachment" ADD CONSTRAINT "ClinicalAttachment_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalAttachment" ADD CONSTRAINT "ClinicalAttachment_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "ClinicalNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalAttachment" ADD CONSTRAINT "ClinicalAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
