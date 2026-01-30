const ENCRYPTION_ALGORITHM = "AES-GCM";
const IV_LENGTH = 12;
const TAG_LENGTH_BYTES = 16;

function bytesToBase64(bytes: Uint8Array): string {
	if (typeof btoa !== "function") {
		throw new Error("Base64 encoding is not available in this runtime");
	}
	let binary = "";
	const chunkSize = 0x8000;
	for (let i = 0; i < bytes.length; i += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
	}
	return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
	if (typeof atob !== "function") {
		throw new Error("Base64 decoding is not available in this runtime");
	}
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}


async function getEncryptionKey(): Promise<CryptoKey> {
	const rawKey = process.env.OPENROUTER_ENCRYPTION_KEY;
	if (!rawKey) {
		throw new Error("OPENROUTER_ENCRYPTION_KEY environment variable is not set");
	}
	const keyBytes = base64ToBytes(rawKey);
	if (keyBytes.length !== 32) {
		throw new Error("OPENROUTER_ENCRYPTION_KEY must be 32 bytes (base64 encoded)");
	}
	// TS expects ArrayBuffer (not SharedArrayBuffer). Normalize.
	const keyData = keyBytes.buffer.slice(
		keyBytes.byteOffset,
		keyBytes.byteOffset + keyBytes.byteLength,
	) as ArrayBuffer;
	return await crypto.subtle.importKey(
		"raw",
		keyData,
		{ name: ENCRYPTION_ALGORITHM },
		false,
		["encrypt", "decrypt"],
	);
}

export async function encryptSecret(value: string): Promise<string> {
	const key = await getEncryptionKey();
	const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
	const encoded = new TextEncoder().encode(value);
	const result = await crypto.subtle.encrypt(
		{ name: ENCRYPTION_ALGORITHM, iv, tagLength: TAG_LENGTH_BYTES * 8 },
		key,
		encoded.buffer.slice(
			encoded.byteOffset,
			encoded.byteOffset + encoded.byteLength,
		) as ArrayBuffer,
	);
	const out = new Uint8Array(result);
	if (out.length < TAG_LENGTH_BYTES) {
		throw new Error("Invalid encryption result");
	}
	const encrypted = out.slice(0, out.length - TAG_LENGTH_BYTES);
	const tag = out.slice(out.length - TAG_LENGTH_BYTES);
	return `${bytesToBase64(iv)}.${bytesToBase64(tag)}.${bytesToBase64(encrypted)}`;
}

export async function decryptSecret(payload: string): Promise<string> {
	const key = await getEncryptionKey();
	const [ivPart, tagPart, encryptedPart] = payload.split(".");
	if (!ivPart || !tagPart || !encryptedPart) {
		throw new Error("Invalid encrypted payload");
	}
	const iv = base64ToBytes(ivPart);
	const tag = base64ToBytes(tagPart);
	const encrypted = base64ToBytes(encryptedPart);
	if (tag.length !== TAG_LENGTH_BYTES) {
		throw new Error("Invalid encrypted payload");
	}
	const combined = new Uint8Array(encrypted.length + tag.length);
	combined.set(encrypted, 0);
	combined.set(tag, encrypted.length);
	const ivData = iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer;
	const decrypted = await crypto.subtle.decrypt(
		{ name: ENCRYPTION_ALGORITHM, iv: ivData, tagLength: TAG_LENGTH_BYTES * 8 },
		key,
		combined.buffer.slice(
			combined.byteOffset,
			combined.byteOffset + combined.byteLength,
		) as ArrayBuffer,
	);
	return new TextDecoder().decode(new Uint8Array(decrypted));
}
