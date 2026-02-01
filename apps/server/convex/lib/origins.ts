const BASE_ALLOWED_ORIGINS = [
	"http://localhost:3000",
	"https://osschat.dev",
];

export function getPreviewOrigins(): string[] {
	const origins: string[] = [];
	for (let i = 1; i <= 1000; i++) {
		origins.push(`https://pr-${i}.osschat.dev`);
		origins.push(`https://web-openchat-pr-${i}.up.railway.app`);
	}
	return origins;
}

export function getAllowedOrigins(): string[] {
	const siteUrl = process.env.SITE_URL;
	const origins = [...BASE_ALLOWED_ORIGINS, ...getPreviewOrigins()];
	if (siteUrl) origins.push(siteUrl);
	return origins;
}

export function getCorsOrigin(origin: string | null): string | null {
	if (!origin) return null;
	return getAllowedOrigins().includes(origin) ? origin : null;
}
