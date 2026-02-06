import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import PDFDocument from "pdfkit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    return new Response("UNAUTHORIZED", { status: 401 });
  }

  const delivery = await prisma.delivery.findFirst({
    where: { id: params.id, tenantId: session.user.tenantId },
    include: {
      approvedOrder: { include: { patient: true } },
      pickList: { include: { items: { include: { product: true } } } },
    },
  });

  if (!delivery) {
    return new Response("NOT_FOUND", { status: 404 });
  }

  const doc = new PDFDocument({ size: "A4", margin: 40 });
  const chunks: Uint8Array[] = [];

  doc.on("data", (chunk) => chunks.push(chunk));

  doc.fontSize(18).text("Remito / Acta de Entrega", { align: "center" });
  doc.moveDown();
  doc.fontSize(12).text(`Entrega: ${delivery.deliveryNumber}`);
  doc.text(`Estado: ${delivery.status}`);
  doc.text(
    `Paciente: ${delivery.approvedOrder.patient.lastName}, ${delivery.approvedOrder.patient.firstName}`,
  );
  doc.text(
    `DNI: ${delivery.approvedOrder.patient.dni} - Dirección: ${delivery.approvedOrder.patient.address ?? "-"}`,
  );
  doc.moveDown();

  doc.fontSize(12).text("Detalle de items", { underline: true });
  doc.moveDown(0.5);
  delivery.pickList.items.forEach((item) => {
    doc.text(
      `${item.product.name} - Req: ${item.requestedQty} / Pick: ${item.pickedQty}`,
    );
  });

  doc.moveDown();
  doc.text("Firmas", { underline: true });
  doc.text(
    `Retirante: ${delivery.carrierName ?? "-"} DNI: ${delivery.carrierDni ?? "-"}`,
  );
  doc.text(
    `Receptor: ${delivery.receiverName ?? "-"} DNI: ${delivery.receiverDni ?? "-"}`,
  );
  doc.text(`Vínculo: ${delivery.receiverRelation ?? "-"}`);

  doc.end();

  const buffer = await new Promise<Buffer>((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${delivery.deliveryNumber}.pdf"`,
    },
  });
}
