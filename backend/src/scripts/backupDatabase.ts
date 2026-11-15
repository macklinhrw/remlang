import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_BACKUP_DIR = path.resolve(process.cwd(), "backups", "cloud-db");

type ParsedArgs = {
  out: string | null;
};

const requireEnv = (name: string) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const parseArgs = (): ParsedArgs => {
  const args = process.argv.slice(2);
  let out: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--out") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Expected a path after --out");
      }
      out = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { out };
};

const formatTimestamp = (date: Date) =>
  [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
    "-",
    String(date.getUTCHours()).padStart(2, "0"),
    String(date.getUTCMinutes()).padStart(2, "0"),
    String(date.getUTCSeconds()).padStart(2, "0"),
  ].join("");

const ensurePgDumpAvailable = () => {
  const result = spawnSync("pg_dump", ["--version"], {
    stdio: "ignore",
  });

  if (result.error || result.status !== 0) {
    throw new Error("pg_dump is required but was not found in PATH.");
  }
};

const computeSha256 = async (filePath: string) => {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);

  for await (const chunk of stream) {
    hash.update(chunk);
  }

  return hash.digest("hex");
};

const resolveOutputPath = async (explicitOut: string | null) => {
  if (explicitOut) {
    const resolved = path.resolve(process.cwd(), explicitOut);
    await mkdir(path.dirname(resolved), { recursive: true });
    return resolved;
  }

  await mkdir(DEFAULT_BACKUP_DIR, { recursive: true });
  return path.join(
    DEFAULT_BACKUP_DIR,
    `cloud-db-${formatTimestamp(new Date())}.dump`,
  );
};

const writeMetadata = async ({
  databaseUrl,
  dumpPath,
  createdAt,
}: {
  databaseUrl: string;
  dumpPath: string;
  createdAt: string;
}) => {
  const url = new URL(databaseUrl);
  const dumpStats = await stat(dumpPath);
  const checksum = await computeSha256(dumpPath);
  const metadataPath = dumpPath.replace(/\.dump$/i, ".json");
  const metadata = {
    createdAt,
    dumpPath,
    database: {
      host: url.hostname,
      port: url.port || "5432",
      name: url.pathname.replace(/^\/+/, ""),
      user: decodeURIComponent(url.username),
      sslmode: url.searchParams.get("sslmode"),
      sslrootcert: url.searchParams.get("sslrootcert"),
    },
    file: {
      sizeBytes: dumpStats.size,
      sha256: checksum,
      format: "pg_dump custom",
    },
  };

  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

  return metadataPath;
};

const main = async () => {
  const { out } = parseArgs();
  const databaseUrl = requireEnv("DATABASE_URL");
  const createdAt = new Date().toISOString();
  const dumpPath = await resolveOutputPath(out);

  ensurePgDumpAvailable();

  await access(path.dirname(dumpPath));

  console.log(`Backing up cloud database to ${dumpPath}`);

  const result = spawnSync(
    "pg_dump",
    [
      `--dbname=${databaseUrl}`,
      "--format=custom",
      "--no-owner",
      "--no-privileges",
      `--file=${dumpPath}`,
    ],
    {
      stdio: "inherit",
      env: process.env,
    },
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`pg_dump failed with exit code ${result.status ?? "unknown"}.`);
  }

  const metadataPath = await writeMetadata({
    databaseUrl,
    dumpPath,
    createdAt,
  });

  console.log(`Backup complete: ${dumpPath}`);
  console.log(`Metadata: ${metadataPath}`);
};

void main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Cloud database backup failed.",
  );
  process.exitCode = 1;
});
