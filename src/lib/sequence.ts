import { prisma } from "./db";

export async function nextSequence(tenantId: string, key: string) {
  const seq = await prisma.sequence.upsert({
    where: { tenantId_key: { tenantId, key } },
    update: { value: { increment: 1 } },
    create: { tenantId, key, value: 1 },
  });
  return seq.value;
}

export function formatDeliveryNumber(
  date: Date,
  sequence: number,
): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const padded = `${sequence}`.padStart(6, "0");
  return `DEL-${year}${month}-${padded}`;
}

export async function nextDeliveryNumber(tenantId: string, date = new Date()) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const key = `delivery:${year}${month}`;
  const seq = await nextSequence(tenantId, key);
  return formatDeliveryNumber(date, seq);
}

export function formatInvoiceNumber(date: Date, sequence: number): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const padded = `${sequence}`.padStart(6, "0");
  return `INV-${year}${month}-${padded}`;
}

export async function nextInvoiceNumber(tenantId: string, date = new Date()) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const key = `invoice:${year}${month}`;
  const seq = await nextSequence(tenantId, key);
  return formatInvoiceNumber(date, seq);
}
