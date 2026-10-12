/** Small genuine PDFs, generated without private course materials or a test-only parser mock. */
export function makePdf(pages: string[]): Uint8Array {
  const objects: string[] = ["<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const children: string[] = [];
  for (const text of pages) {
    const pageId = objects.length + 1;
    children.push(`${pageId} 0 R`);
    const chunks = text.match(/.{1,80}/g) ?? [""];
    const commands = chunks.map((chunk, index) => `${index ? "0 -1 Td " : ""}(${chunk.replace(/([\\()])/g, "\\$1")}) Tj`).join("\n");
    const stream = `BT /F1 12 Tf 72 720 Td ${commands} ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  objects[1] = `<< /Type /Pages /Count ${pages.length} /Kids [${children.join(" ")}] >>`;
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}
