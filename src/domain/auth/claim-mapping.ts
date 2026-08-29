import { logger } from '../../lib/logger';
import type { UserClaims } from '../../auth/provider/types';

/**
 * NDG-112 (v0.26): OIDC claim → user 属性 / role マッピング。
 *
 * tenant_auth_config.claim_mapping JSONB に格納される設定を型付きで扱う。
 * すべてオプショナルで、未設定なら既存のハードコード挙動 (email / name /
 * preferred_username / groups) と同じデフォルトになる。
 *
 * ## 設定例
 *   {
 *     "user": {
 *       "emailClaim": "email",
 *       "displayNameClaim": "name",
 *       "displayNameFallbackClaim": "preferred_username"
 *     },
 *     "roles": {
 *       "claim": "groups",
 *       "map": {
 *         "admins": "tenant_admin",
 *         "managers": "manager"
 *       }
 *     }
 *   }
 *
 * roles.map のキー = IdP 側の値、値 = Nudge 内部 role 名。map に無い IdP 値は
 * 無視 (ログには出す)。ここで返される roleAssignments は "IdP が所有すべき
 * 役割の完全な集合" として callback route が user_role テーブルに sync する。
 */

const NUDGE_ROLES = new Set([
  'tenant_admin',
  'manager',
  'tenant_wide_requester',
  'auditor',
]);

export type ClaimMappingConfig = {
  user?: {
    emailClaim?: string;
    displayNameClaim?: string;
    displayNameFallbackClaim?: string;
  };
  roles?: {
    /** どの claim key から role 情報を取るか (通常 "groups" or "roles") */
    claim?: string;
    /** claim value → Nudge role 名。map に無い値は無視 */
    map?: Record<string, string>;
  };
};

export type MappedUser = {
  email: string;
  displayName: string;
  /** IdP claim から解決された Nudge role の集合 (重複除去済み) */
  roleAssignments: Set<string>;
};

/** JSONB を安全に ClaimMappingConfig 型に絞る (unknown → 型付き) */
export function parseClaimMapping(raw: unknown): ClaimMappingConfig {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: ClaimMappingConfig = {};
  if (r.user && typeof r.user === 'object') {
    const u = r.user as Record<string, unknown>;
    out.user = {
      emailClaim: typeof u.emailClaim === 'string' ? u.emailClaim : undefined,
      displayNameClaim:
        typeof u.displayNameClaim === 'string' ? u.displayNameClaim : undefined,
      displayNameFallbackClaim:
        typeof u.displayNameFallbackClaim === 'string'
          ? u.displayNameFallbackClaim
          : undefined,
    };
  }
  if (r.roles && typeof r.roles === 'object') {
    const ro = r.roles as Record<string, unknown>;
    const map: Record<string, string> = {};
    if (ro.map && typeof ro.map === 'object') {
      for (const [k, v] of Object.entries(ro.map as Record<string, unknown>)) {
        if (typeof v === 'string') map[k] = v;
      }
    }
    out.roles = {
      claim: typeof ro.claim === 'string' ? ro.claim : undefined,
      map,
    };
  }
  return out;
}

function readStringClaim(
  claims: UserClaims,
  key: string,
): string | undefined {
  const v = claims.raw[key];
  return typeof v === 'string' ? v : undefined;
}

function readArrayClaim(claims: UserClaims, key: string): string[] {
  const v = claims.raw[key];
  if (Array.isArray(v))
    return v.filter((x): x is string => typeof x === 'string');
  // 単一値の string を単一要素配列として扱う (IdP 実装差の吸収)
  if (typeof v === 'string') return [v];
  return [];
}

/**
 * 生 claims + mapping ルール → { email, displayName, roleAssignments }。
 * 未マッピングの claim value と、未知の role name は logger.warn に出すが
 * 例外は投げない (login フロー継続を優先)。
 */
export function mapClaims(
  claims: UserClaims,
  mapping: ClaimMappingConfig,
  tenantId: string,
): MappedUser {
  const emailClaim = mapping.user?.emailClaim ?? 'email';
  const displayNameClaim = mapping.user?.displayNameClaim ?? 'name';
  const fallbackClaim =
    mapping.user?.displayNameFallbackClaim ?? 'preferred_username';

  const email = readStringClaim(claims, emailClaim) ?? claims.email ?? '';
  const displayName =
    readStringClaim(claims, displayNameClaim) ??
    readStringClaim(claims, fallbackClaim) ??
    claims.displayName ??
    email;

  const roleAssignments = new Set<string>();
  const roleClaim = mapping.roles?.claim ?? 'groups';
  const roleMap = mapping.roles?.map ?? {};
  const idpValues = readArrayClaim(claims, roleClaim);
  const unmapped: string[] = [];
  for (const v of idpValues) {
    const mapped = roleMap[v];
    if (!mapped) {
      unmapped.push(v);
      continue;
    }
    if (!NUDGE_ROLES.has(mapped)) {
      logger.warn(
        { tenantId, unknownRole: mapped, sourceValue: v },
        'claim mapping produced unknown Nudge role, skipping',
      );
      continue;
    }
    roleAssignments.add(mapped);
  }
  if (unmapped.length > 0) {
    logger.debug(
      { tenantId, roleClaim, unmapped },
      'unmapped IdP role values (add to claim_mapping.roles.map to activate)',
    );
  }

  return { email, displayName, roleAssignments };
}

/** テスト・呼び出し側の依存を避けるため export しておく */
export function knownNudgeRoles(): ReadonlySet<string> {
  return NUDGE_ROLES;
}
