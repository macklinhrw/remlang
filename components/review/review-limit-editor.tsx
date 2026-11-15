import * as React from "react";
import { Pressable, View } from "react-native";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import type { ReviewLimitSettings } from "@/lib/review/reviewLimits";

export const DEFAULT_NEW_REVIEW_LIMIT = 20;
export const DEFAULT_TOTAL_REVIEW_LIMIT = 100;

const sanitizePositiveInteger = (value: string) =>
	value.replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, "");

const LimitField = ({
	label,
	description,
	enabled,
	limit,
	defaultLimit,
	onToggle,
	onChangeLimit,
}: {
	label: string;
	description: string;
	enabled: boolean;
	limit: number | null;
	defaultLimit: number;
	onToggle: (enabled: boolean) => void;
	onChangeLimit: (value: number | null) => void;
}) => {
	const stringValue = limit === null ? "" : String(limit);

	return (
		<View className="rounded-2xl border border-white/8 bg-[#17191c] p-3">
			<View className="flex-row items-start justify-between gap-3">
				<View className="min-w-0 flex-1">
					<Text className="text-base font-medium text-zinc-100">{label}</Text>
					<Text className="mt-1 text-sm leading-5 text-zinc-400">
						{description}
					</Text>
				</View>
				<Pressable
					onPress={() => {
						const nextEnabled = !enabled;
						onToggle(nextEnabled);
						if (nextEnabled && limit === null) {
							onChangeLimit(defaultLimit);
						}
					}}
					className={`rounded-full border px-3 py-1.5 ${
						enabled
							? "border-emerald-400/30 bg-emerald-400/15"
							: "border-white/8 bg-[#101114]"
					}`}
				>
					<Text
						className={`text-xs font-medium uppercase tracking-[0.16em] ${
							enabled ? "text-emerald-100" : "text-zinc-400"
						}`}
					>
						{enabled ? "On" : "Off"}
					</Text>
				</Pressable>
			</View>
			<View className="mt-3">
				<Input
					value={stringValue}
					onChangeText={(value) => {
						const sanitized = sanitizePositiveInteger(value);
						onChangeLimit(sanitized ? Number.parseInt(sanitized, 10) : null);
					}}
					editable={enabled}
					keyboardType="number-pad"
					placeholder={enabled ? "Enter daily limit" : "Disabled"}
					placeholderTextColor="#71717a"
					className="rounded-2xl border border-white/8 bg-[#101114] px-4 py-3 text-base text-zinc-100"
				/>
			</View>
		</View>
	);
};

export const ReviewLimitEditor = ({
	value,
	onChange,
}: {
	value: ReviewLimitSettings;
	onChange: (value: ReviewLimitSettings) => void;
}) => {
	const setField = React.useCallback(
		(nextValue: Partial<ReviewLimitSettings>) =>
			onChange({
				...value,
				...nextValue,
			}),
		[onChange, value],
	);

	return (
		<View className="gap-3">
			<LimitField
				label="New reviews"
				description="Caps cards reviewed today whose FSRS state is marked New."
				enabled={value.newLimitEnabled}
				limit={value.newLimit}
				defaultLimit={DEFAULT_NEW_REVIEW_LIMIT}
				onToggle={(enabled) => setField({ newLimitEnabled: enabled })}
				onChangeLimit={(newLimit) => setField({ newLimit })}
			/>
			<LimitField
				label="Total reviews"
				description="Caps the full number of reviews shown for the day."
				enabled={value.totalLimitEnabled}
				limit={value.totalLimit}
				defaultLimit={DEFAULT_TOTAL_REVIEW_LIMIT}
				onToggle={(enabled) => setField({ totalLimitEnabled: enabled })}
				onChangeLimit={(totalLimit) => setField({ totalLimit })}
			/>
		</View>
	);
};
