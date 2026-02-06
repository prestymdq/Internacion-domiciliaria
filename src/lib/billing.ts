import { prisma } from "@/lib/db";
import { InvoiceStatus } from "@prisma/client";

export async function recalcInvoiceStatus(invoiceId: string) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      items: true,
      debitNotes: true,
      payments: true,
    },
  });

  if (!invoice) {
    return null;
  }

  const totalItems = invoice.items.reduce((sum, item) => sum + item.total, 0);
  const totalDebits = invoice.debitNotes.reduce(
    (sum, debit) => sum + debit.amount,
    0,
  );
  const totalPayments = invoice.payments.reduce(
    (sum, payment) => sum + payment.amount,
    0,
  );

  const netDue = Math.max(totalItems - totalDebits, 0);
  let status: InvoiceStatus = InvoiceStatus.ISSUED;

  if (netDue === 0) {
    status = InvoiceStatus.PAID;
  } else if (totalPayments >= netDue) {
    status = InvoiceStatus.PAID;
  } else if (totalPayments > 0) {
    status = InvoiceStatus.PARTIAL;
  }

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      totalAmount: totalItems,
      status,
    },
  });

  return { totalItems, totalDebits, totalPayments, netDue, status };
}
