import { PDFParse } from "pdf-parse";

const MAX_CHARS = 6000;

/**
 * Extracts plain text from a PDF buffer using pdf-parse v2 (PDFParse class API).
 * pdf-parse@2.x bundles pdfjs-dist and has no test-fixture loading issues.
 */
export async function extractPdfText(pdfBuffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: pdfBuffer });
  let text: string;
  try {
    const result = await parser.getText();
    text = result.text?.trim() ?? "";
  } finally {
    await parser.destroy().catch(() => {});
  }

  if (!text) throw new Error("No text extracted from PDF");
  return text.length > MAX_CHARS
    ? `${text.slice(0, MAX_CHARS)}… [texto truncado]`
    : text;
}
