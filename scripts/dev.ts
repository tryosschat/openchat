type ExitCode = number | null;

function sanitizeNodeOptions(nodeOptions: string | undefined): string | undefined {
	if (!nodeOptions) return nodeOptions;

	const tokens = nodeOptions.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
	const sanitized: string[] = [];

	for (let index = 0; index < tokens.length; index++) {
		const token = tokens[index];
		if (token === "--localstorage-file") {
			index += 1;
			continue;
		}
		if (token.startsWith("--localstorage-file=")) {
			continue;
		}
		sanitized.push(token);
	}

	return sanitized.join(" ").trim();
}

async function run(command: string[], env: NodeJS.ProcessEnv): Promise<ExitCode> {
	const process = Bun.spawn({
		cmd: command,
		env,
		stdio: ["inherit", "inherit", "inherit"],
	});
	return process.exited;
}

const env: NodeJS.ProcessEnv = {
	...process.env,
	BASELINE_BROWSER_MAPPING_IGNORE_OLD_DATA:
		process.env.BASELINE_BROWSER_MAPPING_IGNORE_OLD_DATA ?? "true",
	BROWSERSLIST_IGNORE_OLD_DATA: process.env.BROWSERSLIST_IGNORE_OLD_DATA ?? "true",
	NODE_NO_WARNINGS: process.env.NODE_NO_WARNINGS ?? "1",
};

const sanitizedNodeOptions = sanitizeNodeOptions(process.env.NODE_OPTIONS);
env.NODE_OPTIONS = [sanitizedNodeOptions, "--disable-warning=localstorage-file"]
	.filter((value) => value && value.length > 0)
	.join(" ");

const checkRedisExit = await run(["bun", "./scripts/check-redis.ts"], env);
if (checkRedisExit !== 0) {
	process.exit(checkRedisExit ?? 1);
}

const devExit = await run(["bunx", "turbo", "-F", "web", "-F", "server", "dev"], env);
process.exit(devExit ?? 1);
