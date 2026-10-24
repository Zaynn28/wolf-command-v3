import type { PgliteDatabase } from "drizzle-orm/pglite";
import type * as schema from "./schema";

export type AuthDatabase = PgliteDatabase<typeof schema>;
