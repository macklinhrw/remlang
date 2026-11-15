import "react-native-gesture-handler";

import "~/css/global.css";

import {
	Theme,
	ThemeProvider,
	DarkTheme,
	useTheme,
} from "@react-navigation/native";
import { Drawer } from "expo-router/drawer";
import { StatusBar } from "expo-status-bar";
import * as React from "react";
import { Platform, Pressable, View } from "react-native";
import {
	BarChart3,
	BookOpen,
	Layers,
	Library,
	Search,
	Settings,
	Trash2,
} from "lucide-react-native";
import { NAV_THEME } from "~/lib/constants";
import { useColorScheme } from "~/lib/useColorScheme";

import { SQLiteProvider, useSQLiteContext } from "expo-sqlite";
import { drizzle } from "drizzle-orm/expo-sqlite";
import { useMigrations } from "drizzle-orm/expo-sqlite/migrator";
import migrations from "~/drizzle/migrations.js";
import * as schema from "~/lib/database/schema";
import { Text } from "~/components/ui/text";
import { DrizzleProvider } from "~/lib/database/DrizzleContext";
import { AccountProvider } from "@/lib/auth/account";
import { bootCryptoPolyfill } from "@/lib/crypto-polyfill";
import { ensureBundledDatabaseAsync } from "@/lib/database/bootstrap";
import { repairDeckFolderTrashSchemaAsync } from "@/lib/database/migrationRepair";
import { AppLanguageProvider, useAppLanguage } from "@/lib/store/appLanguageStore";
import { AutoSyncManager } from "@/lib/sync/auto-sync-manager";

import {
	DrawerContentScrollView,
	type DrawerContentComponentProps,
} from "@react-navigation/drawer";

// polyfill for nanoid
bootCryptoPolyfill();

const DARK_THEME: Theme = {
	...DarkTheme,
	colors: NAV_THEME.dark,
};
export {
	// Catch any errors thrown by the Layout component.
	ErrorBoundary,
} from "expo-router";

export default function RootLayout() {
	const [databaseReady, setDatabaseReady] = React.useState(Platform.OS === "web");
	const [databaseError, setDatabaseError] = React.useState<Error | null>(null);

	React.useEffect(() => {
		if (Platform.OS === "web") {
			return;
		}

		let isCancelled = false;

		async function prepareDatabase() {
			try {
				await ensureBundledDatabaseAsync();

				if (!isCancelled) {
					setDatabaseReady(true);
				}
			} catch (error) {
				if (!isCancelled) {
					setDatabaseError(
						error instanceof Error
							? error
							: new Error("Unable to prepare bundled database."),
					);
				}
			}
		}

		prepareDatabase();

		return () => {
			isCancelled = true;
		};
	}, []);

	if (databaseError) {
		return (
			<ThemeProvider value={DARK_THEME}>
				<View
					style={{
						flex: 1,
						justifyContent: "center",
						alignItems: "center",
						backgroundColor: DARK_THEME.colors.background,
					}}
				>
					<Text>Database Error: {databaseError.message}</Text>
				</View>
			</ThemeProvider>
		);
	}

	if (!databaseReady) {
		return (
			<ThemeProvider value={DARK_THEME}>
				<View
					style={{
						flex: 1,
						justifyContent: "center",
						alignItems: "center",
						backgroundColor: DARK_THEME.colors.background,
					}}
				>
					<Text>Preparing database...</Text>
				</View>
			</ThemeProvider>
		);
	}

	return (
		<AccountProvider>
			<SQLiteProvider databaseName="database.db">
				<ThemeProvider value={DARK_THEME}>
					<AppContent />
				</ThemeProvider>
			</SQLiteProvider>
		</AccountProvider>
	);
}

// Inner component that has access to the SQLite context
function AppContent() {
	const hasMounted = React.useRef(false);
	const { setColorScheme } = useColorScheme(); // Use only what's needed
	const [isColorSchemeLoaded, setIsColorSchemeLoaded] = React.useState(false);
	const [isSchemaRepairReady, setIsSchemaRepairReady] = React.useState(Platform.OS === "web");
	const [schemaRepairError, setSchemaRepairError] = React.useState<Error | null>(null);

	const expoDb = useSQLiteContext(); // Get the DB instance from the provider

	useIsomorphicLayoutEffect(() => {
		if (hasMounted.current) {
			return;
		}
		if (Platform.OS === "web") {
			document.documentElement.classList.add("bg-background");
		}
		setColorScheme("dark");
		setIsColorSchemeLoaded(true);
		hasMounted.current = true;
	}, [setColorScheme]); // Include setColorScheme in dependency array

	React.useEffect(() => {
		if (Platform.OS === "web") {
			return;
		}

		let isCancelled = false;

		async function repairSchema() {
			try {
				await repairDeckFolderTrashSchemaAsync(expoDb);
				if (!isCancelled) {
					setIsSchemaRepairReady(true);
				}
			} catch (error) {
				if (!isCancelled) {
					setSchemaRepairError(
						error instanceof Error
							? error
							: new Error("Unable to repair local database schema."),
					);
				}
			}
		}

		void repairSchema();

		return () => {
			isCancelled = true;
		};
	}, [expoDb]);

	if (!isColorSchemeLoaded) {
		return null; // Keep loading state for color scheme
	}

	if (schemaRepairError) {
		return (
			<View
				style={{
					flex: 1,
					justifyContent: "center",
					alignItems: "center",
					backgroundColor: DARK_THEME.colors.background,
				}}
			>
				<Text>Schema Repair Error: {schemaRepairError.message}</Text>
			</View>
		);
	}

	if (!isSchemaRepairReady) {
		return (
			<View
				style={{
					flex: 1,
					justifyContent: "center",
					alignItems: "center",
					backgroundColor: DARK_THEME.colors.background,
				}}
			>
				<Text>Preparing database schema...</Text>
			</View>
		);
	}

	return <MigratedAppContent expoDb={expoDb} />;
}

function MigratedAppContent({ expoDb }: { expoDb: ReturnType<typeof useSQLiteContext> }) {
	const db = React.useMemo(() => drizzle(expoDb, { schema }), [expoDb]);
	const { success: migrationSuccess, error: migrationError } = useMigrations(
		db,
		migrations,
	);

	if (migrationError) {
		return (
			<View
				style={{
					flex: 1,
					justifyContent: "center",
					alignItems: "center",
					backgroundColor: DARK_THEME.colors.background,
				}}
			>
				<Text>Migration Error: {migrationError.message}</Text>
			</View>
		);
	}

	if (!migrationSuccess) {
		return (
			<View
				style={{
					flex: 1,
					justifyContent: "center",
					alignItems: "center",
					backgroundColor: DARK_THEME.colors.background,
				}}
			>
				<Text>Running migrations...</Text>
			</View>
		);
	}

	return (
		<DrizzleProvider value={db}>
			<AppLanguageProvider>
				<AutoSyncManager />
				<RootLayoutNav />
			</AppLanguageProvider>
		</DrizzleProvider>
	);
}

function RootLayoutNav() {
	const theme = useTheme();
	const chromeBackgroundColor = theme.dark ? "#000000" : theme.colors.background;

	return (
		<View
			style={{
				flex: 1,
				backgroundColor: chromeBackgroundColor,
			}}
		>
			<StatusBar
				style={theme.dark ? "light" : "dark"}
				backgroundColor={chromeBackgroundColor}
			/>
			<Drawer
				initialRouteName="decks"
				drawerContent={(props) => <AppDrawerContent {...props} />}
				screenOptions={{
					headerShown: true,
					lazy: true,
					freezeOnBlur: true,
					sceneStyle: {
						backgroundColor: theme.colors.background,
					},
					drawerStyle: {
						backgroundColor: "#0F1012",
						width: 256,
						borderRightWidth: 1,
						borderRightColor: "rgba(255,255,255,0.08)",
					},
					overlayColor: "rgba(0,0,0,0.42)",
					headerStyle: {
						backgroundColor: chromeBackgroundColor,
					},
					headerTintColor: theme.colors.text,
					drawerItemStyle: {
						display: "none",
					},
				}}
			>
				<Drawer.Screen
					name="(auth)"
					options={{
						headerShown: false,
						drawerItemStyle: { display: "none" },
					}}
				/>
				<Drawer.Screen
					name="index"
					options={{
						drawerItemStyle: { display: "none" },
					}}
				/>
				<Drawer.Screen
					name="decks"
					options={{
						title: "Decks",
						drawerLabel: "Decks",
					}}
				/>
				<Drawer.Screen
					name="knowledge"
					options={{
						title: "Knowledge",
						drawerLabel: "Knowledge",
					}}
				/>
				<Drawer.Screen
					name="dictionary"
					options={{
						title: "Dictionary",
						drawerLabel: "Dictionary",
					}}
				/>
				<Drawer.Screen
					name="premade-decks"
					options={{
						title: "Premade Decks",
						drawerLabel: "Premade Decks",
					}}
				/>
				<Drawer.Screen
					name="trash"
					options={{
						title: "Trash",
						drawerLabel: "Trash",
					}}
				/>
				<Drawer.Screen
					name="statistics"
					options={{
						title: "Statistics",
						drawerLabel: "Statistics",
					}}
				/>
				<Drawer.Screen
					name="settings"
					options={{
						title: "Settings",
						drawerLabel: "Settings",
					}}
				/>
				<Drawer.Screen
					name="about"
					options={{
						title: "About",
						drawerLabel: "About",
					}}
				/>
				<Drawer.Screen
					name="create-deck"
					options={{
						title: "Create Deck",
						drawerItemStyle: { display: "none" },
					}}
				/>
				<Drawer.Screen
					name="add-from-dictionary-to-deck"
					options={{
						title: "Select Senses",
						drawerItemStyle: { display: "none" },
					}}
				/>
				<Drawer.Screen
					name="select-card-type"
					options={{
						title: "Card Type",
						drawerItemStyle: { display: "none" },
					}}
				/>
				<Drawer.Screen
					name="select-deck"
					options={{
						title: "Choose Deck",
						drawerItemStyle: { display: "none" },
					}}
				/>
				<Drawer.Screen
					name="knowledge/[id]"
					options={{
						title: "Knowledge",
						drawerItemStyle: { display: "none" },
					}}
				/>
				<Drawer.Screen
					name="character"
					options={{
						title: "Entry",
						drawerItemStyle: { display: "none" },
					}}
				/>
				<Drawer.Screen
					name="draw-character"
					options={{
						title: "Draw Character",
						drawerItemStyle: { display: "none" },
					}}
				/>
				<Drawer.Screen
					name="deck/[id]"
					options={{
						title: "Deck",
						drawerItemStyle: { display: "none" },
					}}
				/>
				<Drawer.Screen
					name="deck/[id]/review"
					options={{
						title: "Review",
						drawerItemStyle: { display: "none" },
					}}
				/>
				<Drawer.Screen
					name="folder/[id]/review"
					options={{
						title: "Folder Review",
						drawerItemStyle: { display: "none" },
					}}
				/>
				<Drawer.Screen
					name="deck/[id]/create-linked-deck"
					options={{
						title: "Create Linked Deck",
						drawerItemStyle: { display: "none" },
					}}
				/>
				<Drawer.Screen
					name="premade-decks/[id]"
					options={{
						title: "Premade Deck",
						drawerItemStyle: { display: "none" },
					}}
				/>
			</Drawer>
		</View>
	);
}

const DRAWER_ITEMS = [
	{
		name: "decks",
		label: "Decks",
		icon: Layers,
	},
	{
		name: "knowledge",
		label: "Knowledge",
		icon: BookOpen,
	},
	{
		name: "dictionary",
		label: "Dictionary",
		icon: Search,
	},
	{
		name: "premade-decks",
		label: "Premade Decks",
		icon: Library,
	},
	{
		name: "statistics",
		label: "Statistics",
		icon: BarChart3,
	},
	{
		name: "trash",
		label: "Trash",
		icon: Trash2,
	},
	{
		name: "settings",
		label: "Settings",
		icon: Settings,
	},
] as const;

function AppDrawerContent(props: DrawerContentComponentProps) {
	const theme = useTheme();
	const { activeLanguageId, availableLanguages } = useAppLanguage();
	const activeRouteName = props.state.routeNames[props.state.index] ?? "decks";
	const activeLanguage =
		availableLanguages.find((language) => language.id === activeLanguageId) ?? null;

	return (
		<DrawerContentScrollView
			{...props}
			contentContainerStyle={{
				flexGrow: 1,
				paddingTop: 0,
				paddingStart: 0,
				paddingEnd: 0,
				paddingHorizontal: 0,
				backgroundColor: theme.colors.background,
			}}
		>
			<View className="flex-1 bg-[#0F1012] px-3 pb-4 pt-5">
				<View className="flex-row items-center gap-2.5 px-1 pb-4">
					<View className="h-8 w-8 items-center justify-center rounded-lg border border-white/8 bg-white/[0.05]">
						<BookOpen size={14} color="#A1A1AA" />
					</View>
					<View className="min-w-0 flex-1">
						<Text className="text-sm font-semibold text-zinc-100">Remlang</Text>
						{activeLanguage ? (
							<Text className="text-[11px] text-zinc-500">{activeLanguage.name}</Text>
						) : null}
					</View>
				</View>

				<View className="gap-1 pt-1">
					{DRAWER_ITEMS.map((item) => {
						const focused = activeRouteName === item.name;
						const Icon = item.icon;
						return (
							<Pressable
								key={item.name}
								onPress={() => props.navigation.navigate(item.name)}
								className={`flex-row items-center gap-3 rounded-xl px-3 py-4 ${
									focused ? "bg-white/[0.06]" : ""
								}`}
							>
								<Icon
									size={20}
									color={focused ? "#E4E4E7" : "#71717A"}
								/>
								<Text
									className={`text-base ${
										focused ? "font-semibold text-zinc-100" : "text-zinc-400"
									}`}
								>
									{item.label}
								</Text>
							</Pressable>
						);
					})}
				</View>
			</View>
		</DrawerContentScrollView>
	);
}

const useIsomorphicLayoutEffect =
	Platform.OS === "web" && typeof window === "undefined"
		? React.useEffect
		: React.useLayoutEffect;
