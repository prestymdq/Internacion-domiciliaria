# Manual de usuario - Internacion Domiciliaria
Fecha: 7 de febrero de 2026

## 1) Proposito del sistema
Esta plataforma permite gestionar internacion domiciliaria de punta a punta: pacientes, episodios y visitas clinicas, inventario, logistica de entregas, autorizaciones con obras sociales y facturacion.

## 2) Ingreso y navegacion
- Ingreso: usa tu email y password en /login.
- Menu lateral: contiene los modulos segun tu rol y tu plan.
- Tenant: en la parte superior se indica la empresa/tenant activo.
- Si ves "Acceso restringido" o un modulo no aparece, puede ser por rol, plan o mora.

## 3) Roles (resumen)
- Admin Tenant: acceso general al tenant.
- Coordinacion: operaciones clinicas y autorizaciones.
- Profesional: agenda y atencion clinica.
- Deposito: inventario y logistica interna.
- Logistica: entregas y estados de despacho.
- Facturacion: reglas, facturas, pagos y debitos.
- Auditor: lectura (segun configuracion).
- Superadmin: administracion de tenants.

## 4) Modulos clinicos
### 4.1 Dashboard
Que muestra: un pulso operativo del dia (pacientes activos, episodios, visitas, entregas, incidentes).
Como usar: revisa indicadores para detectar desvio o atrasos.

### 4.2 Pacientes
Para que sirve: alta y mantenimiento de pacientes.
Como usar:
- Completa nombre, apellido, DNI y datos opcionales.
- Usa la lista para verificar datos basicos.

### 4.3 Episodios
Para que sirve: apertura de internacion domiciliaria por paciente y su plan de cuidado.
Como usar:
- Crea episodio con paciente, fecha de inicio y diagnostico.
- Configura estados de workflow del episodio.
- Carga/actualiza el plan de cuidado (frecuencia y objetivos).
- Da el alta cuando el workflow este en estado terminal.

### 4.4 Detalle de episodio
Para que sirve: ver historial clinico del episodio.
Incluye: resumen, plan de cuidado, timeline, visitas, notas, consumos y adjuntos.

### 4.5 Agenda
Para que sirve: programar y ejecutar visitas clinicas.
Como usar:
- Programar visita: selecciona episodio, profesional, fecha/hora y notas.
- Check-in: inicia la visita programada.
- Checklist: completa los items obligatorios.
- Nota clinica: registra el resumen y el formato SOAP (opcional).
- Consumibles: registra insumos usados (impacta stock).
- Adjuntos: sube imagen o PDF (max 10MB) como evidencia clinica.
- Completar visita: requiere checklist completo y nota clinica.
- Cancelar visita: si no se realiza.

## 5) Modulos de inventario
### 5.1 Productos
Para que sirve: catalogo de insumos.
Como usar:
- Crear productos con unidad y reposicion minima.
- Ajustar reposicion minima para alertas de stock.

### 5.2 Depositos
Para que sirve: ubicaciones de stock.
Como usar:
- Crea depositos y su ubicacion.

### 5.3 Movimientos de stock
Para que sirve: registrar entradas, salidas y ajustes.
Como usar:
- Crea lotes con codigo y vencimiento.
- Registra movimientos (IN, OUT, ADJUSTMENT).
- Revisa alertas de stock bajo y vencimientos.

## 6) Modulos de logistica
### 6.1 Ordenes y kits
Para que sirve: preparar ordenes y kits de insumos.
Como usar:
- Crea plantillas de kit y agrega items.
- Crea orden aprobada para un paciente.
- Agrega items a la orden.
- Genera picklist desde la orden (una sola vez).

### 6.2 Picklists
Para que sirve: preparar el despacho.
Como usar:
- Asigna deposito a cada item.
- Congela la picklist para reservar stock.
- Reporta incidentes si no hay stock (reduce cantidad).
- Marca como packed cuando esta lista.
- Crea la entrega cuando esta packed.

### 6.3 Entregas
Para que sirve: despacho con doble firma y evidencia.
Como usar:
- Subir evidencia (foto, PDF u otro archivo).
- Marcar en transito con datos del retirante.
- Marcar entregado con datos del receptor.
- Cerrar entrega cuando finaliza.
- Descargar PDF de remito.

## 7) Obras sociales y autorizaciones
### 7.1 Obras sociales (Payers)
Para que sirve: administrar pagadores, planes y requisitos.
Como usar:
- Crea obras sociales.
- Agrega planes y requisitos (obligatorios u opcionales).

### 7.2 Autorizaciones
Para que sirve: registrar autorizaciones por paciente y controlar requisitos.
Como usar:
- Crea autorizacion con numero, fechas y limites.
- Sube adjuntos de requisitos.
- Actualiza estado de autorizacion y requisitos.

## 8) Facturacion y finanzas
### 8.1 Billing (plan)
Para que sirve: ver plan, estado y portal de pagos.
Como usar:
- Selecciona plan (Stripe checkout).
- Abre portal Stripe para administrar suscripcion.
- Configura bloqueos por mora.

### 8.2 Pre-liquidacion
Para que sirve: comparar autorizado vs realizado vs evidenciado.
Como usar:
- Revisa tabla y descarga CSV.

### 8.3 Facturas
Para que sirve: generar y exportar facturas.
Como usar:
- Configura reglas de facturacion antes de emitir.
- Selecciona entrega y autorizacion valida.
- Requisitos para facturar:
- Entrega en estado DELIVERED o CLOSED.
- Evidencia minima cargada.
- Autorizacion activa, vigente y sin requisitos pendientes.
- Exporta facturas por obra social (CSV o PDF).

### 8.4 Reglas de facturacion
Para que sirve: definir precios y honorarios por obra social y plan.
Como usar:
- Crea regla por producto (toma prioridad si hay plan).
- Ajusta precios y honorarios cuando sea necesario.

### 8.5 Debitos
Para que sirve: registrar rechazos o debitos sobre facturas.
Como usar:
- Selecciona factura, ingresa monto y motivo.

### 8.6 Pagos
Para que sirve: registrar cobros y conciliacion.
Como usar:
- Selecciona factura, ingresa monto, metodo y referencia.

### 8.7 Aging
Para que sirve: ver saldos por antiguedad.
Como usar:
- Revisa rangos 0-30, 31-60, 61-90 y 90+ dias.

## 9) KPIs
Para que sirve: analitica clinica, logistica y financiera.
Como usar:
- Filtra por rango de fechas, profesional o payer.
- Revisa alertas criticas (visitas vencidas, entregas atrasadas, stock bajo, etc).
- Exporta CSV.

## 10) Administracion (superadmin)
### 10.1 Onboarding
Para que sirve: crear tenants y admins.
Como usar:
- Alta de tenant con plan y slug.
- Alta de admin del tenant.

### 10.2 Tenants
Para que sirve: monitoreo basico de clientes (plan, status, trial).

## 11) Flujos principales (resumen)
- Clinico: Paciente -> Episodio -> Agenda (visitas + notas + adjuntos) -> Alta.
- Logistica: Orden -> Picklist -> Congelar -> Packed -> Entrega -> Evidencia -> Entregado -> Cierre.
- Facturacion: Reglas -> Autorizacion activa -> Entrega entregada -> Factura -> Pagos/Debitos -> Aging.

## 12) Soporte
Si necesitas acceso a un modulo o rol, solicita al administrador del tenant.
