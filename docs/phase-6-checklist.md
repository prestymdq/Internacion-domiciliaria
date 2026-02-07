# Fase 6 - Checklist tecnico

## Observabilidad
- [x] Health check (`/api/health`)
- [x] Metrics snapshot (`/api/metrics`)
- [x] Request ID + logging estructurado (middleware + logger)
- [ ] Integracion con proveedor externo de logs/metrics

## Backups y restore
- [x] Script backup (`npm run db:backup`)
- [x] Script restore (`npm run db:restore -- -InputFile ...`)
- [ ] Job automatico (cron/CI)
- [ ] Restore probado en entorno staging

## Performance y paginacion
- [x] Pacientes con paginado y busqueda
- [x] Episodios con filtros y paginado
- [x] Facturas con paginado
- [ ] Otras listas grandes (entregas, stock, visitas)

## Seguridad y acceso
- [x] RLS context en DB (`set_config app.tenant_id`)
- [x] Validacion de IDs externos en acciones criticas
- [x] Role checks en exports/APIs sensibles
- [ ] Revisar RLS policies en DB
- [ ] Revisar server actions restantes con IDs externos

## Tests
- [x] Smoke tests
- [x] Health route test
- [x] E2E login
- [x] E2E crear paciente/episodio/visita
- [ ] E2E facturacion completa

## UX de errores
- [x] Error boundary con mensajes consistentes
- [x] Mensajes de error mapeados a codigos
- [ ] Toasts o feedback inline por accion
