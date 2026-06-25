import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // 96-bit IV, recomendado para GCM

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error("ENCRYPTION_KEY env var is not set");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32)
    throw new Error("ENCRYPTION_KEY must decode to exactly 32 bytes");
  return key;
}

// Formato del ciphertext: <iv_b64>:<authTag_b64>:<ciphertext_b64>
// Base64 no contiene ':', así que ':' es un separador seguro.
export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decrypt(value: string): string {
  const parts = value.split(":");
  if (parts.length !== 3) throw new Error("Ciphertext format invalid");
  const [ivB64, authTagB64, encB64] = parts;
  const decipher = createDecipheriv(
    ALGORITHM,
    getKey(),
    Buffer.from(ivB64, "base64")
  );
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  return (
    decipher.update(Buffer.from(encB64, "base64")).toString("utf8") +
    decipher.final("utf8")
  );
}
