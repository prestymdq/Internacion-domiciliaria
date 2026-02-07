const errorMessages: Record<string, string> = {
  UNAUTHORIZED: "Sesion expirada o sin acceso.",
  FORBIDDEN: "No tenes permisos para esta accion.",
  NOT_FOUND: "No se encontro el recurso solicitado.",
  VALIDATION_ERROR: "Datos invalidos. Revisá los campos.",
  FILE_REQUIRED: "Tenes que adjuntar un archivo.",
  FILE_TOO_LARGE: "El archivo supera el tamaño permitido.",
  UNSUPPORTED_FILE_TYPE: "Tipo de archivo no permitido.",
  STRIPE_NOT_CONFIGURED: "Stripe no esta configurado.",
  WORKFLOW_NOT_TERMINAL: "El episodio no esta en estado terminal.",
  DELIVERY_NOT_READY: "La entrega no esta lista para facturar.",
  EVIDENCE_REQUIRED: "Falta evidencia obligatoria.",
  DELIVERY_ALREADY_INVOICED: "La entrega ya fue facturada.",
  NO_BILLABLE_ITEMS: "No hay items facturables.",
  BILLING_RULE_MISSING: "Faltan reglas de facturacion para algun item.",
  AUTHORIZATION_NOT_FOUND: "Autorizacion no encontrada.",
  AUTHORIZATION_MISMATCH: "Autorizacion no corresponde al paciente.",
  AUTHORIZATION_NOT_ACTIVE: "Autorizacion no activa.",
  AUTHORIZATION_NOT_STARTED: "Autorizacion aun no vigente.",
  AUTHORIZATION_EXPIRED: "Autorizacion vencida.",
  AUTHORIZATION_REQUIREMENTS_PENDING: "Requisitos de autorizacion pendientes.",
  AUTHORIZATION_LIMIT_UNITS: "Se excede el limite de unidades.",
  AUTHORIZATION_LIMIT_AMOUNT: "Se excede el limite de monto.",
  CHECKLIST_INCOMPLETE: "Falta completar checklist obligatorio.",
  NOTE_REQUIRED: "Falta nota clinica.",
};

export function getErrorMessage(code?: string | null) {
  if (!code) return "Error inesperado.";
  return errorMessages[code] ?? `Error inesperado (${code}).`;
}
