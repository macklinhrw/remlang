import React, { createContext, useContext } from "react";
import { ExpoSQLiteDatabase } from "drizzle-orm/expo-sqlite";
import * as schema from "./schema"; // Assuming schema is in the same directory

// Define the type for your Drizzle instance
export type DrizzleInstance = ExpoSQLiteDatabase<typeof schema>;

// Create the context with a default value (null or potentially a dummy object)
const DrizzleContext = createContext<DrizzleInstance | null>(null);

// Custom hook to use the Drizzle context
export const useDrizzle = () => {
  const context = useContext(DrizzleContext);
  if (!context) {
    throw new Error("useDrizzle must be used within a DrizzleProvider");
  }
  return context;
};

// Export the provider component itself if needed elsewhere,
// but we'll likely use it directly in _layout.tsx
export const DrizzleProvider = DrizzleContext.Provider;
