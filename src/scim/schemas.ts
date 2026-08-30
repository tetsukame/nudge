/**
 * NDG-115 (v0.26): SCIM 2.0 User リソース定義 + JSON 変換。
 *
 * RFC 7643 の User schema をベースに、Nudge が扱うフィールドだけを型付け
 * (email / userName / active / name.formatted / externalId / meta)。
 * displayName や locale 等は対応しない (今のところ利用者なし)。
 *
 * 目的:
 *   - IdP (Entra ID / Okta / Google Workspace / SCIM for Keycloak プラグイン等)
 *     から届く JSON を安全に型に絞る
 *   - Nudge の内部 User モデル (users テーブル行) を SCIM JSON に serialize
 *
 * 対応するのは User リソースのみ。Group は NDG-116 で追加。
 */

export const USER_SCHEMA_URN = 'urn:ietf:params:scim:schemas:core:2.0:User';

export type ScimError = {
  schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'];
  status: string;
  scimType?: string;
  detail?: string;
};

export type ScimListResponse<T> = {
  schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'];
  totalResults: number;
  Resources: T[];
  startIndex: number;
  itemsPerPage: number;
};

/** IdP から受け取る形 (create / put で有効なフィールドだけ許可) */
export type ScimUserInput = {
  schemas?: string[];
  userName: string;
  displayName?: string;
  externalId?: string;
  active?: boolean;
  name?: { formatted?: string; givenName?: string; familyName?: string };
  emails?: Array<{ value?: string; primary?: boolean; type?: string }>;
};

/** Nudge が返す形 (id / meta / active を含めて serialize) */
export type ScimUserResource = {
  schemas: [typeof USER_SCHEMA_URN];
  id: string;
  externalId?: string;
  userName: string;
  displayName: string;
  active: boolean;
  emails: Array<{ value: string; primary: true; type: 'work' }>;
  meta: {
    resourceType: 'User';
    created: string;
    lastModified: string;
    location: string;
  };
};

/** unknown → ScimUserInput 型に絞る。不足フィールドは validation エラー扱いで null 返却 */
export function parseScimUserInput(raw: unknown): ScimUserInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.userName !== 'string' || !r.userName.trim()) return null;
  const out: ScimUserInput = { userName: r.userName };
  if (typeof r.displayName === 'string') out.displayName = r.displayName;
  if (typeof r.externalId === 'string') out.externalId = r.externalId;
  if (typeof r.active === 'boolean') out.active = r.active;
  if (r.name && typeof r.name === 'object') {
    const n = r.name as Record<string, unknown>;
    out.name = {
      formatted: typeof n.formatted === 'string' ? n.formatted : undefined,
      givenName: typeof n.givenName === 'string' ? n.givenName : undefined,
      familyName: typeof n.familyName === 'string' ? n.familyName : undefined,
    };
  }
  if (Array.isArray(r.emails)) {
    out.emails = r.emails
      .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
      .map((e) => ({
        value: typeof e.value === 'string' ? e.value : undefined,
        primary: typeof e.primary === 'boolean' ? e.primary : undefined,
        type: typeof e.type === 'string' ? e.type : undefined,
      }));
  }
  return out;
}

/**
 * SCIM PATCH は独自 Operation 配列を使う (RFC 7644 §3.5.2)。
 * NDG-115 では Entra / Okta が最も頻繁に送る「active toggle」に絞って処理する。
 * 他 op は 204 で受けるが実際には何もしない (今後拡張)。
 */
export type ScimPatchOp = {
  op?: string;
  path?: string;
  value?: unknown;
};

export type ScimPatchRequest = {
  schemas: string[];
  Operations: ScimPatchOp[];
};

export function parseScimPatch(raw: unknown): ScimPatchRequest | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.Operations)) return null;
  return {
    schemas: Array.isArray(r.schemas)
      ? r.schemas.filter((s): s is string => typeof s === 'string')
      : [],
    Operations: r.Operations.filter(
      (o): o is Record<string, unknown> => !!o && typeof o === 'object',
    ).map((o) => ({
      op: typeof o.op === 'string' ? o.op : undefined,
      path: typeof o.path === 'string' ? o.path : undefined,
      value: o.value,
    })),
  };
}

/**
 * PATCH Operation 群から「active に対する更新」だけ抽出する。
 * 未指定なら null、明示的な true / false なら該当値。
 */
export function extractActiveFromPatch(
  patch: ScimPatchRequest,
): boolean | null {
  for (const op of patch.Operations) {
    const opName = op.op?.toLowerCase();
    if (opName !== 'replace' && opName !== 'add') continue;
    // path 指定 (path='active') or path 無しで value に { active: bool }
    if (op.path && op.path.toLowerCase() === 'active') {
      if (typeof op.value === 'boolean') return op.value;
      // Entra は { value: false } / { value: "False" } / "False" のバリエーションがある
      if (typeof op.value === 'string') {
        return op.value.toLowerCase() === 'true';
      }
    } else if (!op.path && op.value && typeof op.value === 'object') {
      const v = (op.value as Record<string, unknown>).active;
      if (typeof v === 'boolean') return v;
      if (typeof v === 'string') return v.toLowerCase() === 'true';
    }
  }
  return null;
}

export type NudgeUserRow = {
  id: string;
  externalId: string;
  email: string;
  displayName: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export function serializeUser(
  user: NudgeUserRow,
  location: string,
): ScimUserResource {
  return {
    schemas: [USER_SCHEMA_URN],
    id: user.id,
    externalId: user.externalId,
    userName: user.email,
    displayName: user.displayName,
    active: user.active,
    emails: [{ value: user.email, primary: true, type: 'work' }],
    meta: {
      resourceType: 'User',
      created: user.createdAt.toISOString(),
      lastModified: user.updatedAt.toISOString(),
      location,
    },
  };
}

export function scimError(
  status: number,
  detail: string,
  scimType?: string,
): ScimError {
  return {
    schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
    status: String(status),
    scimType,
    detail,
  };
}
