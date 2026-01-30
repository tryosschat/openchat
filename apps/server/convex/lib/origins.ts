const BASE_ALLOWED_ORIGINS = [
	"http://localhost:3000",
	"https://osschat.dev",
];

export function getPreviewOrigins(): string[] {
	const origins: string[] = [];
	for (let i = 1; i <= 200; i++) {
		origins.push(`https://pr-${i}.osschat.dev`);
	}
	return origins;
}

export function getAllowedOrigins(): string[] {
	return [...BASE_ALLOWED_ORIGINS, ...getPreviewOrigins()];
}

export function getCorsOrigin(origin: string | null): string | null {
	if (!origin) return null;
	return getAllowedOrigins().includes(origin) ? origin : null;
}
