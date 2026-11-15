export const hasStrokeEligibleCharacters = (value: string | null | undefined) =>
	Boolean(value && /\p{Script=Han}/u.test(value));
