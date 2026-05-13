import type { Bindings, Business, LeadScore } from '../types';

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

export async function getById<T>(db: D1Database, table: string, id: string): Promise<T | null> {
  const result = await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first<T>();
  return result ?? null;
}

export async function deleteById(db: D1Database, table: string, id: string): Promise<boolean> {
  const result = await db.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
  return result.meta.changes > 0;
}
