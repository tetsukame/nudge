# Nudge DB 設計（ERD）v0.1

- 作成日: 2026-04-11
- 対象: Nudge 要件定義書 v0.1（Notion）に基づく初期 DB 設計
- ステータス: ドラフト（ユーザー承認済み論点のみで構成）

## 1. 目的とスコープ

Nudge v0.1 の永続化層の ERD（エンティティ・リレーション設計）を確定させる。対象は以下:

- マルチテナント基盤（PostgreSQL 17 + RLS）
- ユーザー／組織階層／グループ
- 依頼（Request）／ターゲット指定／ユーザー単位の割当（Assignment）／ステータス遷移履歴
- 通知（Notification）のキュー・履歴・ルール・設定
- 権限（Role）と監査ログ

対象外（別スペックで扱う）:

- API 設計・画面設計・ワイヤーフレーム
- 通知スケジューラーの実装詳細（ワーカープロセスの動作以外）
- Keycloak Realm のプロビジョニング手順
- テンプレート管理の詳細（本文テキストの国際化等）

## 2. アーキテクチャ上の前提

### 2.1 マルチテナント分離

- **全テーブルに `tenant_id` 列を持つ**（ルートの `tenant` テーブルを除く）
- PostgreSQL Row Level Security でテナント境界を強制する
- 各セッションは `SET LOCAL app.tenant_id = '<uuid>'` を実行し、RLS ポリシーは `current_setting('app.tenant_id')::uuid = tenant_id` で照合する
- Next.js 側の DB アクセス層で、リクエストごとに必ず `SET LOCAL` を実行してからクエリを発行する
- スキーマ分離は採用しない（東京都・基礎自治体規模での運用管理コストが高すぎるため）

### 2.2 Keycloak / OIDC

- 1 テナント = 1 Keycloak Realm を前提とする
- 認証は Keycloak、認可はアプリ DB（役割分離）
- ユーザーはアプリ DB にローカルミラー（`users` テーブル、`keycloak_sub` で OIDC の sub クレームを保持）
- 1 ユーザーは 1 テナントにのみ所属する。実質同一人物でもテナントごとにメールアドレスが異なることがほとんどであり、クロステナントのアカウント統合は想定しない
- テナント識別はパスプレフィックス（`/t/<tenant.code>/...`）を基本とし、1 ホスト 1 テナント運用も可能とする

### 2.3 組織階層

- `org_unit` を adjacency list（`parent_id` 自己参照）でモデリング
- 祖先⇔子孫の高速検索のために **Closure Table パターン**（`org_unit_closure` 補助テーブル）を併用
- PostgreSQL 依存拡張（ltree 等）は使用しない。再帰 CTE も通常クエリでは使わず、closure の単純 JOIN で済ませる
- 標準の 3 階層（本部 → 部 → 課）に縛られず、任意階層を許容する

### 2.4 依頼・ターゲット・割当の 2 層モデル

1. **ターゲット指定（宣言）**: `request_target` に「組織 / グループ / 個人」の指定内容をそのまま保存（監査・画面表示用）
2. **割当（実体）**: `assignment` に作成時点のスナップショットを展開し、ユーザー単位の状態管理を行う
3. 組織変更やメンバー追加は原則として既存の依頼には反映しない（スナップショット方式 A1）

### 2.5 ステータス遷移と履歴

- 現在ステータスは `assignment.status` に冗長化（クエリ高速化）
- 全遷移は `assignment_status_history` に記録（監査・トレース）
- 「対応不可」の理由、「代理完了」の実行者、「免除」の判断者なども全て履歴側に記録する

### 2.6 通知

- `notification` テーブルが**キュー兼履歴**の役割を兼ねる
- ワーカーが `status='pending' AND scheduled_at <= now()` を 1 分間隔で拾って配信
- テンプレート展開後の本文は `payload_json` にスナップショット保存（再送・監査用）
- 実装順序: in_app → email → teams → slack（テーブル構造は最初から全チャネル対応）

### 2.7 スコープベースの権限

- 全ユーザーが依頼を作成可能（作成可否ロールは存在しない）
- ただし送信先の**スコープ制約**がかかる:
  - デフォルト: 自分が所属する全 `org_unit` の配下 ∪ 自分が所属する全 `group` のメンバー
  - `tenant_wide_requester` ロール保持者: テナント全体
- **UX 原則**: スコープ制約は UI 側で先に適用する。作成画面のピッカーには allowed_scope に含まれる要素のみ表示し、ユーザーがそもそもスコープ外を選べないようにする。サーバー側の検証は多層防御として残すが、一次ガードは UI
- グループは自分が `group_member` に載っているもののみ可視。非メンバーにはグループ自体が見えない

## 3. エンティティ一覧（18 テーブル）

| レイヤ | テーブル | 役割 |
|---|---|---|
| Identity | `tenant` | テナント本体 |
| Identity | `users` | Keycloak ユーザーのローカルミラー |
| Identity | `user_role` | テナント管理者・全社依頼権限 |
| Org | `org_unit` | 組織単位（adjacency list） |
| Org | `org_unit_closure` | 祖先⇔子孫ペア（Closure Table） |
| Org | `user_org_unit` | ユーザー所属（兼務対応） |
| Org | `org_unit_manager` | 組織の上長（複数対応） |
| Group | `group` | テナント直下のフラットグループ |
| Group | `group_member` | グループメンバー |
| Request | `request` | 依頼本体（survey / task 共通） |
| Request | `request_target` | 指定内容（org/group/user） |
| Request | `assignment` | ユーザー単位の割当と状態 |
| Request | `assignment_status_history` | 状態遷移の全履歴 |
| Notification | `tenant_notification_config` | テナントのチャネル設定 |
| Notification | `user_notification_pref` | ユーザーの受信設定 |
| Notification | `notification_rule` | 通知・リマインドルール |
| Notification | `notification` | 通知キュー兼履歴 |
| Audit | `audit_log` | 汎用監査ログ |

## 4. テーブル定義

以下、各テーブルの主要カラムと制約を記載する。データ型は PostgreSQL 17 を前提とする。

### 4.1 tenant

```sql
CREATE TABLE tenant (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                 TEXT NOT NULL UNIQUE,
  name                 TEXT NOT NULL,
  keycloak_realm       TEXT NOT NULL,
  keycloak_issuer_url  TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- `code` は URL プレフィックス等に使うスラッグ（例: `city-tokyo`）
- `keycloak_realm` はこのテナントが使う Realm 名
- `keycloak_issuer_url` は OIDC discovery を組み立てるベース URL
- このテーブル自体は RLS 対象外（全テナント共通のマスタ）

### 4.2 users

```sql
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenant(id),
  keycloak_sub    TEXT NOT NULL,
  email           TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, keycloak_sub)
);
CREATE INDEX ON users (tenant_id, email);
```

- 初回ログイン時、および Keycloak イベント連携で upsert
- `email` は通知配信先としても利用するため DB にキャッシュ
- RLS ポリシー: `tenant_id = current_setting('app.tenant_id')::uuid`

### 4.3 org_unit

```sql
CREATE TABLE org_unit (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenant(id),
  parent_id   UUID REFERENCES org_unit(id),
  name        TEXT NOT NULL,
  level       SMALLINT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON org_unit (tenant_id, parent_id);
```

- `parent_id IS NULL` ならテナント直下のルート（例: 本部）
- `level` は `parent.level + 1` を保存（0 起点）。画面表示・整合性チェック用

### 4.4 org_unit_closure

```sql
CREATE TABLE org_unit_closure (
  tenant_id      UUID NOT NULL REFERENCES tenant(id),
  ancestor_id    UUID NOT NULL REFERENCES org_unit(id),
  descendant_id  UUID NOT NULL REFERENCES org_unit(id),
  depth          SMALLINT NOT NULL,
  PRIMARY KEY (ancestor_id, descendant_id)
);
CREATE INDEX ON org_unit_closure (tenant_id, descendant_id);
```

- 自己ペア `(id, id, 0)` を必ず含める（SELF の再帰表現）
- 挿入・移動・削除はアプリ層のトランザクション内で closure を再構築する

典型クエリ（「本部 X 配下の全ユーザー」）:

```sql
SELECT u.*
FROM users u
JOIN user_org_unit uou ON u.id = uou.user_id
JOIN org_unit_closure c ON uou.org_unit_id = c.descendant_id
WHERE c.ancestor_id = :headquarters_id;
```

### 4.5 user_org_unit

```sql
CREATE TABLE user_org_unit (
  tenant_id    UUID NOT NULL REFERENCES tenant(id),
  user_id      UUID NOT NULL REFERENCES users(id),
  org_unit_id  UUID NOT NULL REFERENCES org_unit(id),
  is_primary   BOOLEAN NOT NULL DEFAULT false,
  assigned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, org_unit_id)
);
CREATE UNIQUE INDEX ON user_org_unit (user_id) WHERE is_primary;
```

- 1 ユーザーが複数組織に所属できる（兼務）
- 部分 UNIQUE インデックスで「主務は 1 つまで」を保証

### 4.6 org_unit_manager

```sql
CREATE TABLE org_unit_manager (
  tenant_id    UUID NOT NULL REFERENCES tenant(id),
  org_unit_id  UUID NOT NULL REFERENCES org_unit(id),
  user_id      UUID NOT NULL REFERENCES users(id),
  assigned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_unit_id, user_id)
);
```

- 1 組織に複数の上長を登録可能（空席期間や配下が多い場合をサポート）
- 「ある user の上長一覧」は `org_unit_closure` と JOIN して祖先組織の manager を集める

### 4.7 group / group_member

```sql
CREATE TABLE "group" (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  name                TEXT NOT NULL,
  description         TEXT,
  created_by_user_id  UUID NOT NULL REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE group_member (
  tenant_id         UUID NOT NULL REFERENCES tenant(id),
  group_id          UUID NOT NULL REFERENCES "group"(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES users(id),
  added_by_user_id  UUID NOT NULL REFERENCES users(id),
  added_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);
```

- 組織階層に紐づかない。テナント直下のフラット集合
- 誰でも作成可能、任意のメンバーが他メンバーを追加・削除可能
- 可視性: 自分が `group_member` に載っているグループのみ見える（アプリ層で制御）
- テナント管理者は全グループを閲覧・削除可能

### 4.8 user_role

```sql
CREATE TABLE user_role (
  tenant_id            UUID NOT NULL REFERENCES tenant(id),
  user_id              UUID NOT NULL REFERENCES users(id),
  role                 TEXT NOT NULL
    CHECK (role IN ('tenant_admin', 'tenant_wide_requester')),
  granted_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by_user_id   UUID REFERENCES users(id),
  PRIMARY KEY (user_id, role)
);
```

- 一般ユーザーはレコード無し
- 「上長」は `org_unit_manager` から導出するため `user_role` には入れない
- 「依頼作成者」は全員可能なため存在しない

### 4.9 request

```sql
CREATE TABLE request (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  created_by_user_id  UUID NOT NULL REFERENCES users(id),
  type                TEXT NOT NULL
    CHECK (type IN ('survey', 'task')),
  title               TEXT NOT NULL,
  body                TEXT,
  external_url        TEXT,
  due_at              TIMESTAMPTZ,
  allow_forward       BOOLEAN NOT NULL DEFAULT true,
  status              TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'closed', 'cancelled')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON request (tenant_id, status, due_at);
```

- `type='survey'` の場合のみ `external_url` に Google Forms / MS Forms などの URL
- `allow_forward` が false の場合、ユーザーからの転送操作は拒否
- `body` は Markdown 許容

### 4.10 request_target

```sql
CREATE TABLE request_target (
  tenant_id            UUID NOT NULL REFERENCES tenant(id),
  request_id           UUID NOT NULL REFERENCES request(id) ON DELETE CASCADE,
  target_type          TEXT NOT NULL
    CHECK (target_type IN ('org_unit', 'group', 'user')),
  target_id            UUID NOT NULL,
  include_descendants  BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (request_id, target_type, target_id)
);
```

- ポリモーフィック参照（`target_type` で参照先テーブルが決まる）のため FK 制約は張らない。整合性は挿入時のアプリ層で担保
- `include_descendants` は `target_type='org_unit'` の時のみ意味を持つ
- 指定内容の**記録**が役割。実際の対象ユーザー展開は `assignment` テーブルで materialize

### 4.11 assignment

```sql
CREATE TABLE assignment (
  id                             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                      UUID NOT NULL REFERENCES tenant(id),
  request_id                     UUID NOT NULL REFERENCES request(id) ON DELETE CASCADE,
  user_id                        UUID NOT NULL REFERENCES users(id),
  status                         TEXT NOT NULL DEFAULT 'unopened'
    CHECK (status IN ('unopened','opened','responded','unavailable',
                      'forwarded','substituted','exempted','expired')),
  opened_at                      TIMESTAMPTZ,
  responded_at                   TIMESTAMPTZ,
  forwarded_from_assignment_id   UUID REFERENCES assignment(id),
  created_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (request_id, user_id)
);
CREATE INDEX ON assignment (tenant_id, user_id, status);
CREATE INDEX ON assignment (request_id, status);
```

- 作成時に `request_target` を展開して 1 ユーザー 1 行で materialize
- 転送時は元の assignment の status を `forwarded` に、新しい assignment を作成し `forwarded_from_assignment_id` で接続
- `UNIQUE (request_id, user_id)` により同一ユーザーへの重複割当を防ぐ

### 4.12 assignment_status_history

```sql
CREATE TABLE assignment_status_history (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES tenant(id),
  assignment_id            UUID NOT NULL REFERENCES assignment(id) ON DELETE CASCADE,
  from_status              TEXT,
  to_status                TEXT NOT NULL,
  transition_kind          TEXT NOT NULL
    CHECK (transition_kind IN (
      'auto_open','user_respond','user_unavailable','user_forward',
      'manager_substitute','admin_exempt','auto_expire'
    )),
  transitioned_by_user_id  UUID REFERENCES users(id),
  reason                   TEXT,
  forwarded_to_user_id     UUID REFERENCES users(id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON assignment_status_history (assignment_id, created_at);
```

- 全遷移を記録。自動遷移（`auto_open` / `auto_expire`）では `transitioned_by_user_id` は NULL
- `reason` は「対応不可」の理由、「免除」の判断理由などに使う
- `forwarded_to_user_id` は `transition_kind='user_forward'` の時のみ必須

### 4.13 tenant_notification_config

```sql
CREATE TABLE tenant_notification_config (
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  channel             TEXT NOT NULL
    CHECK (channel IN ('in_app', 'email', 'teams', 'slack')),
  enabled             BOOLEAN NOT NULL DEFAULT false,
  config_json         JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_user_id  UUID REFERENCES users(id),
  PRIMARY KEY (tenant_id, channel)
);
```

- `config_json` の中身はチャネルごとに異なる:
  - `email`: `{ "smtp_host", "smtp_port", "smtp_user", "smtp_password_ref", "from_address" }`
  - `teams`: `{ "webhook_url" }`
  - `slack`: `{ "webhook_url" }` または `{ "bot_token_ref", "default_channel" }`
  - `in_app`: 空（常時有効）
- パスワード類はシークレット参照（例: 環境変数キー）として保存し、DB には実値を保存しない

### 4.14 user_notification_pref

```sql
CREATE TABLE user_notification_pref (
  tenant_id   UUID NOT NULL REFERENCES tenant(id),
  user_id     UUID NOT NULL REFERENCES users(id),
  channel     TEXT NOT NULL
    CHECK (channel IN ('in_app', 'email', 'teams', 'slack')),
  enabled     BOOLEAN NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, channel)
);
```

- レコードが存在しなければテナント設定に従う
- v0.1 ではユーザー画面での編集は後回し、テーブルだけ用意しておく

### 4.15 notification_rule

```sql
CREATE TABLE notification_rule (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenant(id),
  request_id   UUID REFERENCES request(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL
    CHECK (kind IN ('created','reminder_before','due_today','re_notify','completed')),
  offset_days  INTEGER NOT NULL DEFAULT 0,
  offset_hours INTEGER NOT NULL DEFAULT 0,
  enabled      BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON notification_rule (tenant_id, request_id);
```

- `request_id IS NULL` → テナントデフォルト
- `request_id` が埋まっている → その依頼専用（デフォルトを上書き）
- `offset_days` / `offset_hours` は `due_at` からの相対値（負 = 期限前、正 = 期限後）

### 4.16 notification

```sql
CREATE TABLE notification (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenant(id),
  request_id        UUID REFERENCES request(id),
  assignment_id     UUID REFERENCES assignment(id),
  recipient_user_id UUID NOT NULL REFERENCES users(id),
  channel           TEXT NOT NULL
    CHECK (channel IN ('in_app','email','teams','slack')),
  kind              TEXT NOT NULL
    CHECK (kind IN ('created','reminder_before','due_today','re_notify','completed')),
  scheduled_at      TIMESTAMPTZ NOT NULL,
  sent_at           TIMESTAMPTZ,
  status            TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sent','failed','skipped')),
  attempt_count     INTEGER NOT NULL DEFAULT 0,
  error_message     TEXT,
  payload_json      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON notification (status, scheduled_at) WHERE status = 'pending';
CREATE INDEX ON notification (tenant_id, recipient_user_id, created_at DESC);
```

- ワーカー取得用の部分インデックス（`WHERE status='pending'`）で高速化
- `payload_json` にテンプレ展開後の本文をスナップショット（再送・監査用）
- ユーザーが対応済み等に変わった時点で、そのユーザー宛 `pending` 通知は `skipped` に更新

### 4.17 audit_log

```sql
CREATE TABLE audit_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenant(id),
  actor_user_id  UUID REFERENCES users(id),
  action         TEXT NOT NULL,
  target_type    TEXT NOT NULL,
  target_id      UUID,
  payload_json   JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address     INET,
  user_agent     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON audit_log (tenant_id, created_at DESC);
CREATE INDEX ON audit_log (tenant_id, target_type, target_id);
```

- `actor_user_id IS NULL` はシステム自動処理（期限切れ自動遷移、ワーカー等）
- `action` は `'role.granted'`, `'group.member_added'`, `'request.cancelled'` のようなドット区切り
- assignment のステータス遷移は `assignment_status_history` に記録するため、audit_log では扱わない（二重化回避）

## 5. RLS ポリシー方針

- 全テナントスコープのテーブルに対して次のポリシーを適用:

```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON <table>
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
```

- `tenant` テーブルは RLS 対象外（全テナント共通マスタ）
- DB 接続プールからの各クエリ実行前に `SET LOCAL app.tenant_id = '<uuid>'` を必ず実行する
- 管理バッチなどテナント横断処理は、DB ロールを `BYPASSRLS` 付きで用意する

## 6. 依頼作成フロー（正規シーケンス）

1. 作成画面: UI が作成者の `allowed_scope` を解決し、ピッカーを絞り込む
2. ユーザーが `type`, `title`, `body`, `due_at`, `allow_forward`, ターゲット（組織/グループ/個人の組み合わせ）、リマインドルールを指定
3. POST `/api/requests` (または同等) にサブミット
4. サーバー側で再度スコープ検証（多層防御）
5. トランザクション内で以下を実行:
   1. `request` を INSERT（`status='active'`）
   2. `request_target` にすべての指定を INSERT
   3. ターゲット展開ロジックで対象ユーザー集合を計算（`org_unit_closure`, `group_member` を利用）
   4. 各ユーザーに対して `assignment` を INSERT
   5. `notification_rule` をマージして `notification` に `kind='created'` を scheduled_at=now() で積む
   6. リマインドルールに従って `kind='reminder_before'`, `due_today` などを積む
6. 作成者に成功レスポンスを返す
7. 通知ワーカーが `notification` をポーリングして配信

## 7. 将来拡張の余地（v0.1 スコープ外）

- `user_org_unit` の `valid_from` / `valid_to` による期間管理（人事発令履歴）
- `org_unit_closure` のトリガー自動更新
- 通知テンプレートの多言語化（`notification_template` テーブル）
- Teams / Slack の双方向連携（既読検知、ボタンからの完了操作）
- グループへの管理者指定（現状は誰でも触れる）

## 8. 未決事項（仕様確定後に別スペックで扱う）

- 通知スケジューラーの具体的なワーカー実装方針（Next.js の cron ルート / 別プロセス / BullMQ 等）
- Keycloak テナントプロビジョニング手順（Realm 作成・管理者初期化）
- 画面設計（主要 3 画面: 依頼一覧 / 依頼作成 / 進捗ダッシュボード）
- OSS ライセンス選定
