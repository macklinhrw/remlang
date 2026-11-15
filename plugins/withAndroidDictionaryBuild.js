/**
 * Android build settings the 924 MB bundled dictionary needs. These used to be
 * hand edits in android/; as a config plugin they survive `expo prebuild --clean`
 * and EAS builds, so android/ can stay out of git (Continuous Native Generation).
 */
const { withAppBuildGradle, withGradleProperties } = require("expo/config-plugins");

const GRADLE_PROPERTIES = {
	// Packaging the DB asset runs out of heap with the 2 GB template default.
	"org.gradle.jvmargs": "-Xmx4096m -XX:MaxMetaspaceSize=1024m",
	// expo-updates 55 does not build with the Kotlin 2.2 toolchain yet.
	"android.kotlinVersion": "2.1.20",
	"android.kspVersion": "2.1.20-2.0.1",
};

const withGradlePropertiesPins = (config) =>
	withGradleProperties(config, (mod) => {
		for (const [key, value] of Object.entries(GRADLE_PROPERTIES)) {
			const existing = mod.modResults.find((item) => item.type === "property" && item.key === key);
			if (existing) existing.value = value;
			else mod.modResults.push({ type: "property", key, value });
		}
		return mod;
	});

// Store the SQLite asset uncompressed so it can be copied out of the APK quickly
// (and without inflating ~1 GB in memory) on first launch.
const withUncompressedDatabase = (config) =>
	withAppBuildGradle(config, (mod) => {
		const marker = 'noCompress += ["db"]';
		if (!mod.modResults.contents.includes(marker)) {
			mod.modResults.contents = mod.modResults.contents.replace(
				/androidResources\s*\{/,
				(match) => `${match}\n        ${marker}`,
			);
		}
		if (!mod.modResults.contents.includes(marker)) {
			throw new Error("withAndroidDictionaryBuild: could not find androidResources {} in app/build.gradle");
		}
		return mod;
	});

module.exports = (config) => withUncompressedDatabase(withGradlePropertiesPins(config));
