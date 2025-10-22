import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { createDatabaseLogger } from "../observability/logger";

config({
  path: ".env.local",
});

const runMigrate = async () => {
  const logger = createDatabaseLogger('migration');

  if (!process.env.POSTGRES_URL) {
    logger.error("POSTGRES_URL is not defined");
    throw new Error("POSTGRES_URL is not defined");
  }

  logger.info("Starting database migrations");

  const connection = postgres(process.env.POSTGRES_URL, { max: 1 });
  const db = drizzle(connection);

  console.log("⏳ Running migrations...");
  logger.info("Running database migrations", {
    migrationsFolder: "./lib/db/migrations"
  });

  const start = Date.now();

  try {
    await migrate(db, { migrationsFolder: "./lib/db/migrations" });
    const duration = Date.now() - start;

    console.log("✅ Migrations completed in", duration, "ms");
    logger.info("Database migrations completed successfully", { duration });

    await connection.end();
    process.exit(0);
  } catch (error) {
    const duration = Date.now() - start;
    logger.error("Database migration failed", error as Error, { duration });
    throw error;
  }
};

runMigrate().catch((err) => {
  const logger = createDatabaseLogger('migration');
  console.error("❌ Migration failed");
  console.error(err);
  logger.error("Database migration process failed", err);
  process.exit(1);
});
