const MAX_CHARS = 6000;

export async function extractPdfText(pdfBuffer: Buffer): Promise<string> {
  // Dynamic import evita que pdf-parse@1 intente cargar archivos de test
  // en tiempo de módulo, lo que rompe el build de Vercel
  const pdfParse = (await import("pdf-parse")).default;
  const result = await pdfParse(pdfBuffer);
  const text = result.text?.trim() ?? "";
  if (!text) throw new Error("No text extracted from PDF");
  return text.length > MAX_CHARS
    ? `${text.slice(0, MAX_CHARS)}… [texto truncado]`
    : text;
}
