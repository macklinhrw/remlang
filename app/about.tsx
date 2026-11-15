import { Linking, Pressable, ScrollView, View } from "react-native";
import { ChevronRight, ExternalLink } from "lucide-react-native";
import { Text } from "@/components/ui/text";
import {
	ATTRIBUTION_SECTIONS,
	type AttributionItem,
} from "@/lib/about/attributions";

export default function AboutPage() {
	return (
		<ScrollView
			className="flex-1 bg-[#0F1012]"
			contentContainerClassName="px-4 pb-6 pt-3"
			showsVerticalScrollIndicator={false}
		>
			<View className="border-b border-white/8 pb-4">
				<Text className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
					About
				</Text>
				<Text className="mt-2 text-[28px] font-semibold leading-8 text-zinc-100">
					Data & Attributions
				</Text>
				<Text className="mt-1 text-sm leading-5 text-zinc-400">
					Remlang uses a mix of dictionary, kanji, frequency, and stroke data
					sources. This page lists the source families used in the app and the
					license or reuse terms tracked in the repo.
				</Text>
			</View>
			<View className="mt-4 gap-4">
				{ATTRIBUTION_SECTIONS.map((section) => (
					<View key={section.id} className="gap-2.5">
						<View className="gap-1">
							<Text className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
								{section.title}
							</Text>
							<Text className="text-sm leading-5 text-zinc-400">
								{section.description}
							</Text>
						</View>

						<View className="gap-2">
							{section.items.map((item) => (
								<AttributionCard key={item.id} item={item} />
							))}
						</View>
					</View>
				))}
			</View>
		</ScrollView>
	);
}

const AttributionCard = ({ item }: { item: AttributionItem }) => (
	<View className="rounded-[24px] border border-white/8 bg-[#121315] px-4 py-4">
		<View className="min-w-0">
			<Text className="text-[18px] font-semibold leading-7 text-zinc-100">
				{item.name}
			</Text>
			<Text className="mt-1 text-sm leading-5 text-zinc-400">{item.role}</Text>
			<View className="mt-3 rounded-2xl border border-white/8 bg-[#17191c] px-3.5 py-3">
				<Text className="text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-500">
					License
				</Text>
				<Text className="mt-1 text-sm leading-5 text-zinc-200">{item.license}</Text>
			</View>
		</View>

		<Text className="mt-3 text-sm leading-6 text-zinc-300">{item.notes}</Text>

		{item.links.length > 0 ? (
			<View className="mt-3 gap-2">
				{item.links.map((link) => (
					<Pressable
						key={`${item.id}-${link.url}`}
						onPress={() => {
							void Linking.openURL(link.url);
						}}
						className="flex-row items-center justify-between rounded-2xl border border-white/8 bg-[#141518] px-3.5 py-3"
					>
						<View className="min-w-0 flex-1 gap-0.5">
							<Text className="text-sm font-medium text-zinc-100">{link.label}</Text>
							<Text className="text-xs leading-4 text-zinc-500" numberOfLines={1}>
								{link.url}
							</Text>
						</View>
						<View className="ml-3 flex-row items-center gap-2">
							<ExternalLink size={14} color="#A1A1AA" />
							<ChevronRight size={16} color="#71717A" />
						</View>
					</Pressable>
				))}
			</View>
		) : null}
	</View>
);
