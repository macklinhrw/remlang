import { customAlphabet } from "nanoid/non-secure";

const nanoId = customAlphabet(
	"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
	15,
);

export const generateId = () => nanoId();
