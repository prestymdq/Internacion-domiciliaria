-- Tenant isolation via RLS

ALTER TABLE "Tenant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Tenant" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_tenant
ON "Tenant"
USING (
  current_setting('app.is_superadmin', true) = 'true'
  OR "id" = current_setting('app.tenant_id', true)
)
WITH CHECK (
  current_setting('app.is_superadmin', true) = 'true'
  OR "id" = current_setting('app.tenant_id', true)
);

ALTER TABLE "Sequence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Sequence" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_sequence
ON "Sequence"
USING (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
)
WITH CHECK (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
);

ALTER TABLE "Patient" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Patient" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_patient
ON "Patient"
USING (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
)
WITH CHECK (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
);

ALTER TABLE "Episode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Episode" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_episode
ON "Episode"
USING (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
)
WITH CHECK (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
);

ALTER TABLE "Product" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Product" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_product
ON "Product"
USING (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
)
WITH CHECK (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
);

ALTER TABLE "Warehouse" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Warehouse" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_warehouse
ON "Warehouse"
USING (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
)
WITH CHECK (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
);

ALTER TABLE "Batch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Batch" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_batch
ON "Batch"
USING (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
)
WITH CHECK (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
);

ALTER TABLE "StockMovement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockMovement" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_stockmovement
ON "StockMovement"
USING (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
)
WITH CHECK (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
);

ALTER TABLE "KitTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KitTemplate" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_kittemplate
ON "KitTemplate"
USING (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
)
WITH CHECK (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
);

ALTER TABLE "ApprovedOrder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ApprovedOrder" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_approvedorder
ON "ApprovedOrder"
USING (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
)
WITH CHECK (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
);

ALTER TABLE "PickList" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PickList" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_picklist
ON "PickList"
USING (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
)
WITH CHECK (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
);

ALTER TABLE "Delivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Delivery" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_delivery
ON "Delivery"
USING (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
)
WITH CHECK (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
);

ALTER TABLE "Incident" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Incident" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_incident
ON "Incident"
USING (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
)
WITH CHECK (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
);

ALTER TABLE "Payer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payer" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_payer
ON "Payer"
USING (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
)
WITH CHECK (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
);

ALTER TABLE "PayerPlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayerPlan" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_payerplan
ON "PayerPlan"
USING (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
)
WITH CHECK (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
);

ALTER TABLE "PayerRequirement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayerRequirement" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_payerrequirement
ON "PayerRequirement"
USING (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
)
WITH CHECK (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
);

ALTER TABLE "Authorization" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Authorization" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_authorization
ON "Authorization"
USING (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
)
WITH CHECK (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
);

ALTER TABLE "AuthorizationRequirement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuthorizationRequirement" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_authorizationrequirement
ON "AuthorizationRequirement"
USING (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
)
WITH CHECK (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
);

ALTER TABLE "TenantSubscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantSubscription" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_tenantsubscription
ON "TenantSubscription"
USING (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
)
WITH CHECK (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
);

ALTER TABLE "TenantPolicy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantPolicy" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_tenantpolicy
ON "TenantPolicy"
USING (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
)
WITH CHECK (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
);

ALTER TABLE "Invoice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invoice" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_invoice
ON "Invoice"
USING (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
)
WITH CHECK (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
);

ALTER TABLE "DebitNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DebitNote" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_debitnote
ON "DebitNote"
USING (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
)
WITH CHECK (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
);

ALTER TABLE "Payment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_payment
ON "Payment"
USING (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
)
WITH CHECK (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
);

ALTER TABLE "BillingTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BillingTemplate" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_billingtemplate
ON "BillingTemplate"
USING (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
)
WITH CHECK (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
);

ALTER TABLE "Visit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Visit" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_visit
ON "Visit"
USING (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
)
WITH CHECK (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
);

ALTER TABLE "ClinicalNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClinicalNote" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_clinicalnote
ON "ClinicalNote"
USING (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
)
WITH CHECK (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
);

ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_auditlog
ON "AuditLog"
USING (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
)
WITH CHECK (
  current_setting('app.is_superadmin', true) = 'true'
  OR "tenantId" = current_setting('app.tenant_id', true)
);
