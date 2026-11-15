import { createClerkClient } from "@clerk/backend";
import { config } from "./config";

export const clerkClient = createClerkClient({
  secretKey: config.clerkSecretKey,
  publishableKey: config.clerkPublishableKey,
});
