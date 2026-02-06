import { prisma } from "./db";

export async function nextSequence(tenantId: string, key: string) {
  const seq = await prisma.sequence.upsert({
    where: { tenantId_key: { tenantId, key } },
    update: { value: { increment: 1 } },
    create: { tenantId, key, value: 1 },
  });
  return seq.value;
}

export async function nextDeliveryNumber(tenantId: string, date = new Date()) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const key = `delivery:${year}${month}`;
  const seq = await nextSequence(tenantId, key);
  const padded = `${seq}`.padStart(6, "0");
  return `DEL-${year}${month}-${padded}`;
}
