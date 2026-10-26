import assert from "node:assert/strict";
import { test } from "node:test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

function createOnePagePdf() {
  const content = "BT\n/F1 12 Tf\n72 720 Td\n(Hello PDF) Tj\nET\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let source = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(source));
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(source);
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  source += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  source += `trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return new Uint8Array(Buffer.from(source, "ascii"));
}

test("PDF.js loads and renders a generated one-page PDF", async () => {
  const loadingTask = getDocument({
    data: createOnePagePdf(),
    disableWorker: true,
  });
  const pdf = await loadingTask.promise;

  try {
    assert.equal(pdf.numPages, 1);
    const page = await pdf.getPage(1);
    assert.equal(page.pageNumber, 1);
    assert.deepEqual(
      [page.getViewport({ scale: 1 }).width, page.getViewport({ scale: 1 }).height],
      [612, 792],
    );
  } finally {
    await pdf.destroy();
  }
});
