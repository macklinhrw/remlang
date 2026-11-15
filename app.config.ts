import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * Identity is read from the environment so forks can build without touching
 * this file. Unset values fall back to safe local-development defaults.
 *
 *   APP_ID            iOS bundle identifier and Android package (default com.macklinrw.remlang)
 *   EXPO_OWNER        Expo account that owns the EAS project
 *   EAS_PROJECT_ID    EAS project id; enables EAS Build and EAS Update when set
 */
const APP_ID = process.env.APP_ID?.trim() || "com.macklinrw.remlang";
const EXPO_OWNER = process.env.EXPO_OWNER?.trim() || undefined;
const EAS_PROJECT_ID = process.env.EAS_PROJECT_ID?.trim() || undefined;

export default ({ config }: ConfigContext): ExpoConfig => ({
	...config,
	name: "remlang",
	slug: "remlang",
	owner: EXPO_OWNER,
	version: "1.0.0",
	runtimeVersion: "1.0.0",
	orientation: "portrait",
	icon: "./assets/images/icon.png",
	scheme: "remlang",
	userInterfaceStyle: "dark",
	ios: {
		supportsTablet: true,
		bundleIdentifier: APP_ID,
	},
	android: {
		package: APP_ID,
		adaptiveIcon: {
			foregroundImage: "./assets/images/adaptive-icon.png",
			backgroundColor: "#000000",
		},
	},
	web: {
		bundler: "metro",
		output: "static",
		favicon: "./assets/images/favicon.png",
	},
	plugins: [
		"expo-router",
		[
			"expo-splash-screen",
			{
				image: "./assets/images/splash-icon.png",
				imageWidth: 200,
				resizeMode: "contain",
				backgroundColor: "#000000",
			},
		],
		[
			"expo-sqlite",
			{
				version: 1,
				name: "remlang",
				enableFTS: true,
				customBuildFlags: ["-DSQLITE_ENABLE_MATH_FUNCTIONS=1"],
			},
		],
		// The prebuilt dictionary: `pnpm fetch:db`, or build it with `pnpm fetch:resources && pnpm seed`.
		["expo-asset", { assets: ["./assets/database.db"] }],
		"expo-font",
		"expo-web-browser",
		"@clerk/expo",
		"expo-secure-store",
		"./plugins/withAndroidDictionaryBuild",
	],
	experiments: {
		typedRoutes: true,
	},
	extra: {
		router: { origin: false },
		...(EAS_PROJECT_ID ? { eas: { projectId: EAS_PROJECT_ID } } : {}),
	},
	...(EAS_PROJECT_ID ? { updates: { url: `https://u.expo.dev/${EAS_PROJECT_ID}` } } : {}),
});
