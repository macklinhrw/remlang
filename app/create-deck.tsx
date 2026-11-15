import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { Input } from "@/components/ui/input";
import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { useRouter } from "expo-router";
import { useDrizzle } from "@/lib/database/DrizzleContext";
import { generateId } from "@/lib/id";
import {
	createDeck,
	decks$,
} from "@/lib/store/decksStore";
import { useAppLanguage } from "@/lib/store/appLanguageStore";
import { FolderPlus } from "lucide-react-native";

export default function CreateDeckPage() {
	const router = useRouter();
	const drizzle = useDrizzle();
	const { activeLanguageId, availableLanguages } = useAppLanguage();
	const activeLanguage =
		availableLanguages.find((language) => language.id === activeLanguageId) ?? null;
	const form = useForm({
		defaultValues: {
			name: "",
		},
		onSubmit: async (values) => {
			const { value } = values;
			// console.log("submitting create deck:", { value });
			const result = await createDeck(drizzle, {
				id: generateId(),
				name: value.name,
				languageId: activeLanguageId,
			});
			if (result) {
				decks$.addDeck(result);
				router.replace("/decks");
			}
		},
	});

	return (
		<View className="flex-1 bg-[#0F1012] px-4 pb-4 pt-3">
			<View className="border-b border-white/8 pb-4">
				<Text className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
					Decks
				</Text>
				<Text className="mt-2 text-[28px] font-semibold leading-8 text-zinc-100">
					Create Deck
				</Text>
				<Text className="mt-1 text-sm leading-5 text-zinc-400">
					Give this deck a clear name so it is easy to find when you start
					studying.
				</Text>
				{activeLanguage && (
					<View className="mt-3 self-start rounded-full border border-white/8 bg-white/[0.04] px-3 py-1.5">
						<Text className="text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-300">
							{activeLanguage.name}
						</Text>
					</View>
				)}
			</View>

			<View className="mt-5 rounded-[24px] border border-white/8 bg-[#141518] p-4">
				<View className="flex-row items-center gap-3">
					<View className="rounded-2xl border border-white/8 bg-white/[0.05] p-2.5">
						<FolderPlus size={18} color="#E4E4E7" />
					</View>
					<View className="flex-1">
						<Text className="text-base font-semibold text-zinc-100">
							New Deck
						</Text>
						<Text className="mt-0.5 text-sm leading-5 text-zinc-400">
							This deck will be scoped to the current app language.
						</Text>
					</View>
				</View>

				<form.Field name="name">
					{(field) => (
						<View className="mt-4 gap-2">
							<Text className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
								Deck Name
							</Text>
							<Input
								value={field.state.value}
								onChangeText={field.handleChange}
								placeholder="Example: HSK 1 Core"
								className="rounded-2xl border-white/8 bg-[#101114] px-4 py-3 text-base text-zinc-100"
							/>
							{field.state.meta.errors ? (
								<Text className="text-sm text-red-300">
									{field.state.meta.errors.join(", ")}
								</Text>
							) : (
								<Text className="text-sm text-zinc-500">
									Use a short name you will recognize quickly in your deck list.
								</Text>
							)}
						</View>
					)}
				</form.Field>

				<form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
					{([canSubmit, isSubmitting]) => (
						<View className="mt-5 flex-row gap-2">
							<Button
								onPress={() => form.handleSubmit()}
								disabled={!canSubmit}
								className="h-11 flex-1 rounded-2xl bg-zinc-100"
							>
								<Text className="font-medium text-zinc-900">
									{isSubmitting ? "Creating..." : "Create Deck"}
								</Text>
							</Button>
							<Button
								onPress={() => form.reset()}
								variant="secondary"
								className="h-11 rounded-2xl border border-white/8 bg-[#101114] px-4"
							>
								<Text className="font-medium text-zinc-200">Reset</Text>
							</Button>
						</View>
					)}
				</form.Subscribe>
			</View>
		</View>
	);
}
