/**
 * NDG-88 (A2 E2 / A3 P5): WHERE 句を組み立てる軽量ビルダ。
 *
 * 動機: NDG-81 race の遠因となった `clause === ''` で WHERE/AND を判定する
 * パターンを、安全に拡張できる形に置換する。
 *
 * 使い方:
 *   const wb = new WhereBuilder();
 *   wb.add('r.created_by_user_id = ?', actor.userId);
 *   wb.add('r.title ILIKE ?', `%${q}%`);
 *   wb.addRaw(`r.status <> 'draft'`);
 *   const sql = `SELECT * FROM request r ${wb.whereClause()}`;
 *   await client.query(sql, wb.values());
 *
 * - `?` はパラメータ占有プレースホルダ。`$N` に自動採番される
 * - パラメータを追加せず固定値だけの条件は `addRaw` (注: SQL injection 注意。
 *   呼び出し側が安全と保証できるリテラルのみ)
 * - LIMIT / OFFSET / 追加パラメータが必要なら `pushValue(v)` で参照番号を取る
 */
export class WhereBuilder {
  private readonly conditions: string[] = [];
  private readonly params: unknown[] = [];

  /**
   * 条件を追加する。`?` プレースホルダの数と values の数は一致必須。
   */
  add(condition: string, ...values: unknown[]): this {
    let consumed = 0;
    const rewritten = condition.replace(/\?/g, () => {
      const placeholder = `$${this.params.length + consumed + 1}`;
      consumed += 1;
      return placeholder;
    });
    if (consumed !== values.length) {
      throw new Error(
        `WhereBuilder.add: placeholder count mismatch (? × ${consumed} vs values × ${values.length})`,
      );
    }
    this.conditions.push(rewritten);
    for (const v of values) this.params.push(v);
    return this;
  }

  /**
   * パラメータを伴わないリテラル条件を追加する。SQL injection を避けるため、
   * 呼び出し側で文字列が動的入力を含まないことを保証すること。
   */
  addRaw(condition: string): this {
    this.conditions.push(condition);
    return this;
  }

  /**
   * 値を 1 個追加し、参照すべきプレースホルダ文字列 (例: "$3") を返す。
   * LIMIT / OFFSET 等で生 SQL に値を埋め込みたい時用。
   */
  pushValue(value: unknown): string {
    this.params.push(value);
    return `$${this.params.length}`;
  }

  /** "WHERE a AND b" 形式の文字列。条件が空なら空文字列。 */
  whereClause(): string {
    if (this.conditions.length === 0) return '';
    return `WHERE ${this.conditions.join(' AND ')}`;
  }

  /** "a AND b" 形式（先頭の WHERE なし）。CTE 等で組み込みやすい形。 */
  andClause(): string {
    return this.conditions.join(' AND ');
  }

  /** 現在保持しているパラメータ配列。query の 2 引数にそのまま渡す。 */
  values(): unknown[] {
    return [...this.params];
  }

  /** 現在のパラメータ数。デバッグ用。 */
  size(): number {
    return this.params.length;
  }
}
