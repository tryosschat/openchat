import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getEncryptionKey(): Buffer {
	const rawKey = process.env.OPENROUTER_ENCRYPTION_KEY;
	if (!rawKey) {
		throw new Error("OPENROUTER_ENCRYPTION_KEY environment variable is not set");
	}
	const key = Buffer.from(rawKey, "base64");
	if (key.length !== 32) {
		throw new Error("OPENROUTER_ENCRYPTION_KEY must be 32 bytes (base64 encoded)");
	}
	return key;
}

export function encryptSecret(value: string): string {
	const key = getEncryptionKey();
	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
	const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
	const tag = cipher.getAuthTag();
	return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

export function decryptSecret(payload: string): string {
	const key = getEncryptionKey();
	const [ivPart, tagPart, encryptedPart] = payload.split(".");
	if (!ivPart || !tagPart || !encryptedPart) {
		throw new Error("Invalid encrypted payload");
	}
	const iv = Buffer.from(ivPart, "base64");
	const tag = Buffer.from(tagPart, "base64");
	const encrypted = Buffer.from(encryptedPart, "base64");
	const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
	decipher.setAuthTag(tag);
	const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
	return decrypted.toString("utf8");
}
