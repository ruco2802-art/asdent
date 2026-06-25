import { GRAPH_API_VERSION } from "@/lib/whatsapp/send";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB safety limit

interface MetaMediaInfo {
  url: string;
  mime_type: string;
  file_size?: number;
}

/**
 * Downloads a media file from Meta's Graph API.
 * Step 1: Fetch media URL + metadata via /{media_id}.
 * Step 2: Download the binary from the CDN URL (also needs the Bearer token).
 */
export async function downloadMetaMedia(
  mediaId: string,
  accessToken: string
): Promise<{ buffer: Buffer; mimeType: string }> {
  const infoRes = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${mediaId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!infoRes.ok) {
    throw new Error(`Meta media info error: HTTP ${infoRes.status}`);
  }

  const info = (await infoRes.json()) as MetaMediaInfo;
  if (info.file_size && info.file_size > MAX_BYTES) {
    throw new Error(`Media too large: ${info.file_size} bytes`);
  }

  const dataRes = await fetch(info.url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!dataRes.ok) {
    throw new Error(`Meta media download error: HTTP ${dataRes.status}`);
  }

  const arrayBuffer = await dataRes.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_BYTES) {
    throw new Error(`Downloaded media too large: ${arrayBuffer.byteLength} bytes`);
  }

  return { buffer: Buffer.from(arrayBuffer), mimeType: info.mime_type };
}
