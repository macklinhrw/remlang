import * as FileSystem from "expo-file-system/legacy";
import { defaultDatabaseDirectory } from "expo-sqlite";
import { Platform } from "react-native";

const DATABASE_NAME = "database.db";
const SQLITE_SIDE_CAR_SUFFIXES = ["", "-journal", "-shm", "-wal"];

function toFileUri(path: string): string {
	return path.startsWith("file://") ? path : `file://${path}`;
}

function getBundledDatabaseUri(): string | null {
	if (Platform.OS === "android") {
		return `asset:///${DATABASE_NAME}`;
	}

	if (Platform.OS === "ios") {
		if (!FileSystem.bundleDirectory) {
			throw new Error("Expo bundle directory is unavailable on iOS.");
		}

		return `${FileSystem.bundleDirectory}${DATABASE_NAME}`;
	}

	return null;
}

function getLocalDatabaseDirectoryUri(): string {
	if (typeof defaultDatabaseDirectory !== "string" || defaultDatabaseDirectory.length === 0) {
		throw new Error("Expo SQLite default database directory is unavailable.");
	}

	return toFileUri(defaultDatabaseDirectory);
}

function getLocalDatabaseUri(): string {
	const directoryUri = getLocalDatabaseDirectoryUri().replace(/\/+$/, "");
	return `${directoryUri}/${DATABASE_NAME}`;
}

export async function ensureBundledDatabaseAsync(): Promise<void> {
	const bundledDatabaseUri = getBundledDatabaseUri();

	if (!bundledDatabaseUri) {
		return;
	}

	const localDatabaseDirectoryUri = getLocalDatabaseDirectoryUri();
	const localDatabaseUri = getLocalDatabaseUri();

	await FileSystem.makeDirectoryAsync(localDatabaseDirectoryUri, {
		intermediates: true,
	});

	const [bundledInfo, localInfo] = await Promise.all([
		FileSystem.getInfoAsync(bundledDatabaseUri),
		FileSystem.getInfoAsync(localDatabaseUri),
	]);

	if (!bundledInfo.exists) {
		throw new Error(`Bundled database was not found at ${bundledDatabaseUri}`);
	}

	if (localInfo.exists) {
		return;
	}

	await Promise.all(
		SQLITE_SIDE_CAR_SUFFIXES.map((suffix) =>
			FileSystem.deleteAsync(`${localDatabaseUri}${suffix}`, {
				idempotent: true,
			}).catch(() => undefined),
		),
	);

	await FileSystem.copyAsync({
		from: bundledDatabaseUri,
		to: localDatabaseUri,
	});
}
