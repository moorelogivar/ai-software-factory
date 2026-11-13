import { pool, closeDatabase } from "../../../packages/database/src/client";

async function main() {
  try {
    const result = await pool.query(`
      SELECT
        current_database() AS database,
        current_user AS username,
        NOW() AS server_time
    `);

    console.log("DATABASE CONNECTION: SUCCESS");
    console.table(result.rows);
  } catch (error) {
    console.error("DATABASE CONNECTION: FAILED", error);
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
}

main();
