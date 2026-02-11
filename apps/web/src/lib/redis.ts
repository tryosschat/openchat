import type { Redis as UpstashRedis } from "@upstash/redis";
import { upstashRedis } from "@/lib/upstash";

const STREAM_TTL_SECONDS = 3600;
const STREAM_ERROR_TTL_SECONDS = 600;
const TYPING_TTL_SECONDS = 3;
const PRESENCE_TTL_SECONDS = 60;
const ONLINE_WINDOW_MS = 60_000;

const keys = {
	stream: (chatId: string) => `chat:${chatId}:stream`,
	meta: (chatId: string) => `chat:${chatId}:meta`,
	typing: (chatId: string, userId: string) => `chat:${chatId}:typing:${userId}`,
	presence: (userId: string) => `presence:${userId}`,
	unread: (userId: string) => `user:${userId}:unread`,
};

export interface StreamToken {
	id: string;
	text: string;
	type: "text" | "reasoning" | "done" | "error";
	timestamp: number;
}

export interface StreamMeta {
	status: "streaming" | "completed" | "error";
	chatId: string;
	userId: string;
	messageId: string;
	startedAt: number;
	completedAt?: number;
	error?: string;
}

export function getRedisClient(): UpstashRedis | null {
	return upstashRedis;
}

export function isRedisAvailable(): boolean {
	return upstashRedis !== null;
}

export async function ensureRedisConnected(): Promise<boolean> {
	if (!upstashRedis) return false;
	try {
		await upstashRedis.ping();
		return true;
	} catch (error) {
		console.error("[Upstash Redis] Ping failed:", error);
		return false;
	}
}

async function getConnectedClient(): Promise<UpstashRedis | null> {
	return upstashRedis;
}

function parseStreamMeta(value: unknown): StreamMeta | null {
	if (!value) return null;
	if (typeof value === "string") {
		try {
			return JSON.parse(value) as StreamMeta;
		} catch {
			return null;
		}
	}
	if (typeof value === "object") {
		const candidate = value as Partial<StreamMeta>;
		if (
			(candidate.status === "streaming" ||
				candidate.status === "completed" ||
				candidate.status === "error") &&
			typeof candidate.chatId === "string" &&
			typeof candidate.userId === "string" &&
			typeof candidate.messageId === "string" &&
			typeof candidate.startedAt === "number"
		) {
			return candidate as StreamMeta;
		}
	}
	return null;
}

export async function initStream(
	chatId: string,
	userId: string,
	messageId: string,
): Promise<boolean> {
	const client = await getConnectedClient();
	if (!client) return false;

	const meta: StreamMeta = {
		status: "streaming",
		chatId,
		userId,
		messageId,
		startedAt: Date.now(),
	};

	await client.set(keys.meta(chatId), JSON.stringify(meta), {
		ex: STREAM_TTL_SECONDS,
	});
	return true;
}

export async function appendToken(
	chatId: string,
	text: string,
	type: StreamToken["type"] = "text",
): Promise<string | null> {
	const client = await getConnectedClient();
	if (!client) return null;

	const streamKey = keys.stream(chatId);
	const entryId = await client.xadd(streamKey, "*", {
		text,
		type,
		ts: Date.now().toString(),
	});
	await client.expire(streamKey, STREAM_TTL_SECONDS);
	return entryId;
}

export async function completeStream(chatId: string): Promise<void> {
	const client = await getConnectedClient();
	if (!client) return;

	await appendToken(chatId, "", "done");

	const metaKey = keys.meta(chatId);
	const meta = parseStreamMeta(await client.get(metaKey));
	if (!meta) return;

	meta.status = "completed";
	meta.completedAt = Date.now();
	await client.set(metaKey, JSON.stringify(meta), {
		ex: STREAM_TTL_SECONDS,
	});
}

export async function errorStream(chatId: string, error: string): Promise<void> {
	const client = await getConnectedClient();
	if (!client) return;

	await appendToken(chatId, error, "error");

	const metaKey = keys.meta(chatId);
	const meta = parseStreamMeta(await client.get(metaKey));
	if (!meta) return;

	meta.status = "error";
	meta.error = error;
	meta.completedAt = Date.now();
	await client.set(metaKey, JSON.stringify(meta), {
		ex: STREAM_ERROR_TTL_SECONDS,
	});
}

export async function readStream(
	chatId: string,
	lastId: string = "0",
): Promise<Array<StreamToken>> {
	const client = await getConnectedClient();
	if (!client) return [];

	const entries = await client.xrange(
		keys.stream(chatId),
		lastId === "0" ? "-" : `(${lastId}`,
		"+",
	);
	if (!entries || typeof entries !== "object") {
		return [];
	}

	return Object.entries(entries).map(([id, message]) => ({
		id,
		text: typeof message.text === "string" ? message.text : "",
		type:
			message.type === "reasoning" ||
			message.type === "done" ||
			message.type === "error"
				? message.type
				: "text",
		timestamp:
			typeof message.ts === "string"
				? Number.parseInt(message.ts, 10)
				: Date.now(),
	}));
}

export async function getStreamMeta(chatId: string): Promise<StreamMeta | null> {
	const client = await getConnectedClient();
	if (!client) return null;
	return parseStreamMeta(await client.get(keys.meta(chatId)));
}

export async function hasActiveStream(chatId: string): Promise<boolean> {
	const meta = await getStreamMeta(chatId);
	return meta?.status === "streaming";
}

export async function setTyping(
	chatId: string,
	userId: string,
	isTyping: boolean,
): Promise<void> {
	const client = await getConnectedClient();
	if (!client) return;

	const key = keys.typing(chatId, userId);
	if (isTyping) {
		await client.set(key, "1", { ex: TYPING_TTL_SECONDS });
		return;
	}
	await client.del(key);
}

export async function getTypingUsers(chatId: string): Promise<Array<string>> {
	const client = await getConnectedClient();
	if (!client) return [];

	const pattern = `chat:${chatId}:typing:*`;
	const users = new Set<string>();
	let cursor: string | number = "0";

	do {
		const [nextCursor, keysFound]: [string, Array<string>] = await client.scan(cursor, {
			match: pattern,
			count: 100,
		});
		cursor = nextCursor;
		for (const key of keysFound) {
			const userId = key.split(":").pop();
			if (userId) {
				users.add(userId);
			}
		}
	} while (String(cursor) !== "0");

	return [...users];
}

export async function updatePresence(userId: string): Promise<void> {
	const client = await getConnectedClient();
	if (!client) return;
	await client.set(keys.presence(userId), Date.now().toString(), {
		ex: PRESENCE_TTL_SECONDS,
	});
}

export async function isUserOnline(userId: string): Promise<boolean> {
	const client = await getConnectedClient();
	if (!client) return false;

	const lastSeen = await client.get<string>(keys.presence(userId));
	if (!lastSeen) return false;
	return Date.now() - Number.parseInt(lastSeen, 10) < ONLINE_WINDOW_MS;
}

export async function incrementUnread(userId: string, chatId: string): Promise<void> {
	const client = await getConnectedClient();
	if (!client) return;
	await client.hincrby(keys.unread(userId), chatId, 1);
}

export async function clearUnread(userId: string, chatId: string): Promise<void> {
	const client = await getConnectedClient();
	if (!client) return;
	await client.hdel(keys.unread(userId), chatId);
}

export async function getUnreadCounts(userId: string): Promise<Record<string, number>> {
	const client = await getConnectedClient();
	if (!client) return {};

	const counts = await client.hgetall<Record<string, string>>(keys.unread(userId));
	const result: Record<string, number> = {};
	for (const [chatId, count] of Object.entries(counts ?? {})) {
		result[chatId] = Number.parseInt(count, 10);
	}
	return result;
}

export const redis = {
	getClient: getRedisClient,
	isAvailable: isRedisAvailable,
	ensureConnected: ensureRedisConnected,
	stream: {
		init: initStream,
		append: appendToken,
		complete: completeStream,
		error: errorStream,
		read: readStream,
		getMeta: getStreamMeta,
		hasActive: hasActiveStream,
	},
	typing: {
		set: setTyping,
		getUsers: getTypingUsers,
	},
	presence: {
		update: updatePresence,
		isOnline: isUserOnline,
	},
	unread: {
		increment: incrementUnread,
		clear: clearUnread,
		getAll: getUnreadCounts,
	},
};
