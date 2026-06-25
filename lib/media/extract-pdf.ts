import pdfParse from "pdf-parse";

const MAX_CHARS = 6000;

export async function extractPdfText(pdfBuffer: Buffer): Promise<string> {
  const result = await pdfParse(pdfBuffer);
  const text = result.text?.trim() ?? "";
  if (!text) throw new Error("No text extracted from PDF");
  return text.length > MAX_CHARS
    ? `${text.slice(0, MAX_CHARS)}… [texto truncado]`
    : text;
}
