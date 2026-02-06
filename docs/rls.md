# Estrategia RLS (PostgreSQL)

Objetivo: asegurar aislamiento por tenant a nivel DB además del filtro `tenantId` en backend.

Pasos sugeridos:
1. Habilitar RLS en tablas con `tenantId`.
2. Crear una política por tabla que compare `tenantId` con `current_setting('app.tenant_id')`.
3. En cada request, setear `SET LOCAL app.tenant_id = '<tenantId>'`.

Ejemplo:

```sql
ALTER TABLE "Patient" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_patient
ON "Patient"
USING ("tenantId" = current_setting('app.tenant_id')::text);
```

En el backend:

```ts
await prisma.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantId}'`);
```

Esto se aplicaría en un middleware/transaction wrapper para todas las queries de tenant.
