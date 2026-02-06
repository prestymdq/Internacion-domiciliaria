import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTenantModuleAccess } from "@/lib/tenant-access";
import PDFDocument from "pdfkit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  const tenantId = session?.user?.tenantId;
  if (!tenantId) {
    return new Response("UNAUTHORIZED", { status: 401 });
  }

  const access = await getTenantModuleAccess(tenantId, "BILLING");
  if (!access.allowed) {
    return new Response("FORBIDDEN", { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const payerId = searchParams.get("payerId") ?? undefined;
  const format = searchParams.get("format") ?? "csv";

  const invoices = await prisma.invoice.findMany({
    where: { tenantId, payerId },
    include: {
      payer: true,
      patient: true,
      items: { include: { product: true } },
    },
    orderBy: { issuedAt: "desc" },
  });

  if (format === "pdf") {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks: Uint8Array[] = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.fontSize(16).text("Exportación de facturas", { align: "center" });
    doc.moveDown();

    invoices.forEach((invoice) => {
      doc.fontSize(12).text(`Factura: ${invoice.invoiceNumber}`);
      doc.text(`Payer: ${invoice.payer.name}`);
      doc.text(
        `Paciente: ${invoice.patient.lastName}, ${invoice.patient.firstName}`,
      );
      doc.text(`Total: ${invoice.totalAmount.toFixed(2)} ARS`);
      doc.moveDown(0.5);
      invoice.items.forEach((item) => {
        doc.text(
          `${item.product.name} x ${item.quantity} @ ${item.unitPrice.toFixed(
            2,
          )} = ${item.total.toFixed(2)}`,
        );
      });
      doc.moveDown();
    });

    doc.end();
    const buffer = await new Promise<Buffer>((resolve) => {
      doc.on("end", () => resolve(Buffer.concat(chunks)));
    });

    return new Response(buffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "attachment; filename=facturas.pdf",
      },
    });
  }

  const header = [
    "Factura",
    "Payer",
    "Paciente",
    "FechaEmision",
    "Total",
    "Item",
    "Cantidad",
    "PrecioUnitario",
    "Subtotal",
  ];

  const rows = invoices.flatMap((invoice) =>
    invoice.items.map((item) => [
      invoice.invoiceNumber,
      invoice.payer.name,
      `${invoice.patient.lastName}, ${invoice.patient.firstName}`,
      invoice.issuedAt.toISOString(),
      invoice.totalAmount,
      item.product.name,
      item.quantity,
      item.unitPrice,
      item.total,
    ]),
  );

  const csv = [header, ...rows]
    .map((row) =>
      row
        .map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`)
        .join(","),
    )
    .join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=facturas.csv",
    },
  });
}
