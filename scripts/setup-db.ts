import { promisify } from "node:util";
import { execFile as execFileCb } from "node:child_process";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { randomBytes as cryptoRandomBytes } from "node:crypto";

function generateRandomPassword(length = 32): string {
	return cryptoRandomBytes(length).toString("base64url").slice(0, length);
}

const execFile = promisify(execFileCb);

async function run(cmd: string, args: string[], silent = false): Promise<string> {
  const { stdout } = await execFile(cmd, args, { encoding: "utf8" });
  if (!silent) process.stdout.write(stdout);
  return stdout.trim();
}

async function findPort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, () => {
      const address = server.address();
      if (typeof address === "object" && address) {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        server.close();
        reject(new Error("Could not obtain random port"));
      }
    });
  });
}

async function ensureDocker() {
  try {
    await run("docker", ["--version"], true);
  } catch (err) {
    throw new Error("Docker CLI not found. Install Docker and ensure it is on PATH.");
  }
}

async function removeContainer(name: string) {
  try {
    await run("docker", ["rm", "-f", name], true);
  } catch (_err) {
    // ignore missing container
  }
}

async function waitForReady(name: string, user = "postgres") {
  const start = Date.now();
  const timeout = 60_000;
  while (Date.now() - start < timeout) {
    try {
      const out = await run("docker", ["exec", name, "pg_isready", "-U", user], true);
      if (out.includes("accepting connections")) return;
    } catch (_err) {
      // container not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Postgres container did not become ready within 60 seconds");
}

async function writeEnv(file: string, entries: Record<string, string>) {
  let content = "";
  if (existsSync(file)) {
    content = await readFile(file, "utf8");
  }

  for (const [key, value] of Object.entries(entries)) {
    const entry = `${key}=${value}`;
    const pattern = new RegExp(`^[ \t]*${key}=.*$`, "m");
    if (pattern.test(content)) {
      content = content.replace(pattern, entry);
    } else {
      if (content.length && !content.endsWith("\n")) {
        content += "\n";
      }
      content += entry + "\n";
    }
  }

  if (content.length && !content.endsWith("\n")) {
    content += "\n";
  }

  await writeFile(file, content, "utf8");
}

async function main() {
  await ensureDocker();

  const containerName = process.env.OPENCHAT_DB_CONTAINER || "openchat_pg";
  const desiredPort = process.env.OPENCHAT_DB_PORT
    ? Number(process.env.OPENCHAT_DB_PORT)
    : await findPort();

  if (!Number.isInteger(desiredPort) || desiredPort <= 0) {
    throw new Error("OPENCHAT_DB_PORT must be a valid positive integer");
  }

  // Handle Postgres credentials securely
  const postgresUser = process.env.POSTGRES_USER || "postgres";
  let postgresPassword = process.env.POSTGRES_PASSWORD;
  let usingDefaultCredentials = false;

  if (!postgresPassword) {
    // Generate a random password for local dev by default
    postgresPassword = generateRandomPassword();
    process.stdout.write("\n[setup-db] Generated random POSTGRES_PASSWORD for local development.\n");
  } else if (postgresPassword === "postgres") {
    // Warn if explicitly using the well-known default
    usingDefaultCredentials = true;
    process.stderr.write(
      "\n[setup-db] WARNING: Using default 'postgres' password. " +
      "This is insecure for non-local environments.\n" +
      "Set POSTGRES_PASSWORD to a strong value for shared or production use.\n\n"
    );
  }

  process.stdout.write(`[setup-db] Using host port ${desiredPort} for Postgres container\n`);

  await removeContainer(containerName);

  const args = [
    "run",
    "--name",
    containerName,
    "-d",
    "-p",
    `${desiredPort}:5432`,
    "-e",
    `POSTGRES_USER=${postgresUser}`,
    "-e",
    `POSTGRES_PASSWORD=${postgresPassword}`,
    "-e",
    "POSTGRES_DB=openchat_test",
    "postgres:16",
  ];

  process.stdout.write(`[setup-db] Starting container '${containerName}'...\n`);
  await run("docker", args, true);

  process.stdout.write("[setup-db] Waiting for Postgres to become ready...\n");
  await waitForReady(containerName, postgresUser);

  const databaseUrl = `postgres://${encodeURIComponent(postgresUser)}:${encodeURIComponent(postgresPassword)}@localhost:${desiredPort}/openchat_test`;
  process.env.DATABASE_URL = databaseUrl;
  process.stdout.write(`[setup-db] Ready!\n`);
  process.stdout.write(`DATABASE_URL=${databaseUrl}\n`);
  const envFile = process.env.OPENCHAT_ENV_FILE || ".env.local";
  const entries = {
    DATABASE_URL: databaseUrl,
    POSTGRES_PASSWORD: postgresPassword,
    NEXT_PUBLIC_DEV_BYPASS_AUTH: process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH || "1",
    NEXT_PUBLIC_DEV_USER_ID: process.env.NEXT_PUBLIC_DEV_USER_ID || "dev-user",
  } satisfies Record<string, string>;

  await writeEnv(envFile, entries);
  process.stdout.write(`\n[setup-db] Wrote DATABASE_URL, POSTGRES_PASSWORD, and dev auth flags to ${envFile}\n`);
  if (usingDefaultCredentials) {
    process.stderr.write("[setup-db] REMINDER: Default credentials detected. Update for non-local environments.\n");
  }
  process.stdout.write("Run your commands normally; Bun and Next.js will pick up the values automatically.\n");
}

main().catch((err) => {
  console.error("[setup-db] Error:", err.message || err);
  process.exit(1);
});
