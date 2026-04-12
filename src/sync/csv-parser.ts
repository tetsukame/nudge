import { parse } from 'csv-parse/sync';

export type CsvRow = {
  employee_id: string;
  email: string;
  display_name: string;
  org_path: string;
  is_primary: boolean;
  status: 'active' | 'inactive';
  lineNumber: number;
};

export type CsvParseResult =
  | { ok: true; rows: CsvRow[] }
  | { ok: false; errors: { line: number; message: string }[] };

export function parseSyncCsv(content: string): CsvParseResult {
  const cleaned = content.replace(/^\uFEFF/, '');

  let records: Record<string, string>[];
  try {
    records = parse(cleaned, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });
  } catch (err) {
    return {
      ok: false,
      errors: [{ line: 1, message: `CSV parse error: ${(err as Error).message}` }],
    };
  }

  const errors: { line: number; message: string }[] = [];
  const rows: CsvRow[] = [];
  const MAX_ERRORS = 10;

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const line = i + 2;
    if (errors.length >= MAX_ERRORS) break;
    if (!r.employee_id?.trim()) { errors.push({ line, message: 'missing employee_id' }); continue; }
    if (!r.email?.trim()) { errors.push({ line, message: 'missing email' }); continue; }
    if (!r.display_name?.trim()) { errors.push({ line, message: 'missing display_name' }); continue; }
    if (!r.org_path?.trim()) { errors.push({ line, message: 'missing org_path' }); continue; }
    if (!r.org_path.startsWith('/')) { errors.push({ line, message: 'org_path must start with /' }); continue; }

    const isPrimaryRaw = (r.is_primary ?? '').trim().toLowerCase();
    const is_primary = isPrimaryRaw === 'false' ? false : true;
    const statusRaw = (r.status ?? '').trim().toLowerCase();
    const status = statusRaw === 'inactive' ? 'inactive' as const : 'active' as const;

    rows.push({
      employee_id: r.employee_id.trim(),
      email: r.email.trim(),
      display_name: r.display_name.trim(),
      org_path: r.org_path.trim(),
      is_primary,
      status,
      lineNumber: line,
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, rows };
}
