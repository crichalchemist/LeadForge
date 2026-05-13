/**
 * Paginated list query helper.
 *
 * @param where - SQL WHERE clause fragment (e.g. "status = 'active'").
 *   WARNING: This is interpolated directly. Do NOT pass raw user input.
 * @param orderBy - SQL ORDER BY clause fragment (e.g. "created_at DESC").
 *   WARNING: This is interpolated directly. Do NOT pass raw user input.
 * @param table - Table name (interpolated). Must be a known table name.
 * @param columns - Column list (interpolated). Must be known column names.
 */
export async function paginatedList<T>(
  db: D1Database,
  table: string,
  columns: string,
  options: { page?: number; perPage?: number; where?: string; orderBy?: string }
): Promise<{ data: T[]; total: number; page: number; perPage: number }> {
  const page = options.page ?? 1;
  const perPage = options.perPage ?? 50;
  const offset = (page - 1) * perPage;
  const where = options.where ? `WHERE ${options.where}` : '';
  const orderBy = options.orderBy ? `ORDER BY ${options.orderBy}` : '';

  const countResult = await db.prepare(`SELECT COUNT(*) as count FROM ${table} ${where}`).first<{ count: number }>();
  const total = countResult?.count ?? 0;

  const data = await db
    .prepare(`SELECT ${columns} FROM ${table} ${where} ${orderBy} LIMIT ? OFFSET ?`)
    .bind(perPage, offset)
    .all<T>();

  return { data: data.results ?? [], total, page, perPage };
}

/**
 * Get a single row by its 'id' column.
 * Assumes the table has a TEXT PRIMARY KEY column named 'id'.
 */
export async function getById<T>(db: D1Database, table: string, id: string): Promise<T | null> {
  const result = await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first<T>();
  return result ?? null;
}

/**
 * Delete a single row by its 'id' column. Returns true if a row was deleted.
 */
export async function deleteById(db: D1Database, table: string, id: string): Promise<boolean> {
  const result = await db.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
  return result.meta.changes > 0;
}
