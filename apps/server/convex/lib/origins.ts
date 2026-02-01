const ALLOWED_ORIGINS = [
	"http://localhost:3000",
	"https://osschat.dev",
	"*.osschat.dev",
	"*.up.railway.app",
];

export function getAllowedOrigins(): string[] {
	const siteUrl = process.env.SITE_URL;
	const origins = [...ALLOWED_ORIGINS];
	if (siteUrl) origins.push(siteUrl);
	return origins;
}

export function getCorsOrigin(origin: string | null): string | null {
	if (!origin) return null;
	const allowed = getAllowedOrigins();
	for (const pattern of allowed) {
		if (pattern === origin) return origin;
		if (pattern.startsWith("*.")) {
			const wildcardDomain = pattern.slice(1);
			const rootDomain = pattern.slice(2);
			try {
				const url = new URL(origin);
				if (
					url.protocol === "https:" &&
					(url.hostname.endsWith(wildcardDomain) || url.hostname === rootDomain)
				) {
					return origin;
				}
			} catch {
				continue;
			}
		}
	}
	return null;
}
