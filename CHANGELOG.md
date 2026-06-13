# 変更履歴 / Changelog

本ファイルは [Keep a Changelog](https://keepachangelog.com/ja/1.0.0/) に概ね沿っています。
バージョンは開発上の節目で、各項目は Notion 課題管理 (`NDG-<n>`) と GitHub PR に対応します。
直近（v0.20 以降）を詳細に、それ以前は要約で記載します。

## [v0.24] — セキュリティ堅牢化 + データ保持戦略 + リファクタ整理

### 追加 (Added)
- **データ保持 (retention) 機能** — 通知履歴・監査ログ・遷移履歴・同期ログを「組織のルールに沿って整理する」仕組み。tenant 単位で保持日数を設定、platform デフォルトに fallback。**ソフト → ハード削除の 2 段階方式** (期限超過 → `archived_at` で論理削除 → grace 7 日経過 → 物理 DELETE)。worker tick で 1h ごと処理、各テーブル LIMIT 5000、削除実績を `retention_log` + audit_log に記録。**デフォルト無効化**で既存環境の挙動は変更なし。tenant_admin が API で明示的に有効化するまで動かない (NDG-87/88/89, #81/#82/#83)
- **行政職員向け運用マニュアル** — retention 機能を「公文書管理・個人情報保護条例」の文脈で説明するドキュメントを Notion ドキュメント DB に登録 (NDG-87 参考資料)

### セキュリティ (Security)
- **next を 15.5.18 に bump** — high 7 件の CVE を解消 (Middleware/Proxy bypass、DoS、SSRF 他)。14 件 → 1 件まで削減 (NDG-83, #74)
- **`tenant_sync_config.sync_client_secret` を AES-256-GCM 暗号化** — SMTP/Teams/Slack と同じ暗号化パターンを KC sync client secret にも適用。lazy migration で旧平文値は次回 sync 時に自動移行 (NDG-84, #75)
- **SSRF 防護: `assertSafeHttpUrl`** — tenant_admin が AI endpoint / Teams webhook / Slack webhook / SMTP host を保存する際、private (RFC1918) / loopback / link-local / cloud metadata を遮断。`SAFE_URL_HOST_ALLOWLIST` env var で運用者が opt-in 許可可能 (NDG-85, #76)
- **棚卸し** — セキュリティ観点での全体監査を実施し、H 級 3 件 (上記) / M 級 3 件 (v0.25 持ち越し) / L 級 5 件 (観察) を `docs/refactor/security-audit-v0.23.md` に記録 (#73)

### 変更・リファクタ (Changed)
- **`WhereBuilder` 抽象化** — 動的 WHERE 句を `?` プレースホルダで組み立てる軽量ビルダを `src/db/where-builder.ts` に新設。`list-sent.ts` の `clause === ''` 分岐方式 (NDG-81 race の遠因) を解消、`buildSharedWhere` で list と count の共通 WHERE を 1 箇所に集約 (NDG-86, #80)
- **マジック文字列を const + 型ユニオン化** — `'tenant_admin'` / `'request.cancelled'` 等を `src/domain/_constants.ts` に集約 (ROLE / AUDIT_ACTION / NOTIFICATION_KIND + 型)。audit_log INSERT 18 箇所と role 参照 13 箇所を `AUDIT_ACTION.*` / `ROLE.*` 経由に置換 (NDG-91, #84)
- **クライアント Dialog + state パターンをフック + コンポーネント化** — `useAsyncAction` / `apiFetch` / `<ConfirmDialog>` の 3 プリミティブを新設し、5 箇所の Dialog 利用を共通化 (`ScheduledCancelButton` / `RequesterReassignAction` / `SentRequestCardActions` / `ActionButtons` / `AIFormatModal`) (NDG-92, #85)
- **`mapDomainError` + route → domain 抽出 + page context 統合** — `app/t/[code]/api/_lib/respond.ts` に共通エラー → status マッピング、14 route の catch ブロックを `mapDomainError` 経由に変更。`requests/[id]/route.ts` GET の 70 行を `src/domain/request/get-detail.ts` (`getRequestDetail` + `RequestDetailError`) に抽出。`src/domain/page-context.ts` の `loadPageContext` で `/requests/new/page.tsx` の 3 連発 `withTenant` を 1 トランザクションに統合 (NDG-93, #86)
- **棚卸し** — 拡張性 / 性能観点での全体監査も実施し、`docs/refactor/extensibility-audit-v0.23.md` / `performance-audit-v0.23.md` に記録 (#78/#79)

### マイグレーション
- 055: `retention_config` テーブル新設 + 4 テーブル (`notification` / `audit_log` / `assignment_status_history` / `sync_log`) に `archived_at TIMESTAMPTZ` 追加 + 部分インデックス 4 本
- 056: `retention_log` テーブル新設 (削除実績の記録)
- (補足) `054_tenant_sync_secret_encrypted.sql` は v0.23 リリース後に追加された暗号化列で、v0.24 で正式採用

### スコープ外（v0.25 以降に持ち越し）
- **`/admin/settings/retention` UI** — NDG-87 設計で確定したとおり v0.25 リリース（API のみ動作確認してから UI 投資）
- **M 級リファクタの残り**: P4 (OFFSET → seek pagination) / P6 (`withTenant` read-only 緩和) / E5 残 ~24 route の `mapDomainError` 適用
- **通知スケジューラ (NDG-63)** — 引き続き未定

## [v0.23] — 効率化（テンプレ / 予約送信 / AI 整形）

### 追加 (Added)
- **依頼テンプレ** — 部 / 課単位で共有する依頼の雛形。月次・四半期の定例依頼を 1 クリックで起票。所有: org_unit、閲覧/編集は作成課のメンバー OR tenant_admin。論理削除 (archived_at)、版管理なし。新規依頼作成画面に「テンプレから作成」UI、tenant_admin で `/admin/templates` から CRUD (NDG-68, #66)
- **予約送信** — 依頼を作成しつつ未来日時に発送予約。状態 `status='draft' + scheduled_at` で保持し、worker (60s tick) が到来時に `active` 化＋通知を発火。送信側の一覧に「⏰ 予約中」タブ。過去日時を指定した場合は即時送信にフォールバック (NDG-70, #67)
- **予約送信の取り消し** — 予約中の依頼を発送前にキャンセル。誰にも通知していないので受信者には完全に不可視、送信者の履歴には「🚫 取り消し済み」で残る。audit_log は `request.scheduled_cancelled` (NDG-79, #67)
- **AI 整形（依頼作成支援）** — 依頼者が要件メモを書く → AI に整形させてタイトル + 本文を提案 → 採用 / 再生成 / 破棄。プロバイダ抽象化 (Dify workflow / OpenAI 互換 API) でローカル LM Studio / Ollama / OpenAI / OpenRouter から選択可能。tenant_admin が `/admin/settings/ai` で有効化、API キーは AES-256-GCM 暗号化保存、デフォルト OFF (NDG-73, #70/#71)

### 修正 (Fixed)
- `/admin/sent` のタブ件数表示で「すべて」ラベルだけに件数があり、しかも現在選択中フィルタの件数を表示していた問題 → タブごとに件数表示 (NDG-80, #68)
- 上記カウントクエリが draft (予約送信中) を除外していなかった merge race バグ → `r.status <> 'draft'` 追加 (NDG-81, #69)
- OpenAI 互換プロバイダの `response_format=json_object` を LM Studio が受け付けず 400 エラー → JSON Schema 形式 (`json_schema`) に変更、OpenAI / LM Studio / Ollama 0.5+ 互換 (NDG-82, #70)

### マイグレーション
- 051: `request_template` テーブル + RLS + 部分インデックス
- 052: `request.scheduled_at` 列追加 + 予約送信用部分インデックス
- 053: `tenant_ai_config` テーブル (provider/endpoint/暗号化 API key/system_prompt/extras JSONB)

### スコープ外
- **通知スケジューラ (NDG-63)**: 勤務時間外抑止 + 緊急バイパスを v0.23 で計画していたが、テーブル名衝突 (既存 `tenant_notification_config` と重複) と緊急バイパスの前提 (`request.priority` 列が未存在) で検討コストが過大と判断、**未定** に戻し別バージョンで再検討

## [v0.22] — ガバナンス強化（代理完了 / 監査 / 取り消し）

### 追加 (Added)
- **代理完了の理由カテゴリ + tenant_admin 対応** — 代理完了モーダルに「本人不在 / 依頼者判断で完了 / 期限超過救済 / その他」のカテゴリを追加（「その他」のみ自由記述必須）。tenant_admin もテナント全体で代理完了可、`transition_kind` を `manager_substitute` / `admin_substitute` で監査区別 (NDG-61, #61)
- **監査ログの対象種別フィルタ + CSV エクスポート** — `targetType` セレクトで絞り込み、現在のフィルタを適用して CSV ダウンロード（最大 10k 行、打ち切り時は警告）(NDG-67, #62)
- **`auditor` ロール** — 監査ログ閲覧専用、編集権限なし。デフォルト OFF・tenant_admin が手動付与。`/admin/audit` を `/audit` に移して `/admin/*` の tenant_admin gate と分離 (NDG-67/NDG-77, #62)
- **依頼取り消し** — 依頼者本人 / tenant_admin が `request.status='active'` の依頼を取り消し可能。理由必須、対象者全員へ「取り消し」通知、`request.cancelled` イベントを監査ログに記録。inbox は「未対応」から除外し「完了」に統合、sent は「🚫 取り消し済み」バッジ表示 (NDG-72/NDG-78, #64)

### 修正 (Fixed)
- 代理完了後に詳細ページ上部の全体進捗バーが古いまま残るバグ（router.refresh 追加で即時更新）(NDG-75, #61)
- 代理完了モーダルの「緊急」ラベルが意味不明 →「依頼者判断で完了」に変更（内部コードは据え置き）(NDG-76, #61)
- `/admin/*` レイアウトの `tenant_admin` gate が auditor を弾いていた問題 → 監査ログを `/audit` 配下に移動して権限分離 (NDG-77, #62)
- 依頼取り消し時に `notification.kind` CHECK 制約が `'cancelled'` を未許可で 500 → マイグレーション 050 で許可リストに追加 (NDG-78, #64)

### マイグレーション
- 047: `assignment.substitute_reason_code` 列 + `assignment_status_history.transition_kind` CHECK に `admin_substitute` 追加
- 048: `user_role.role` CHECK に `'auditor'` 追加
- 049: `request.cancelled_at` / `cancelled_by_user_id` / `cancel_reason` 列追加
- 050: `notification.kind` CHECK に `'cancelled'` 追加

## [v0.21] — UX 刷新・マネージャ機能・KC 連携強化

### 追加 (Added)
- **トップダッシュボード** — サイドバーのロゴから自分の状況サマリ（自分宛の未対応 / 送信した依頼の進捗 / 部下の未処理）へ。クイックアクション付き (PR #54)
- **部下の依頼ボード** — タスク／人のトグルで配下の未処理状況を一覧。期限フィルタ（期限切れ・一週間以内）、完了率、(user×request) 単位リマインド (NDG-42, #35/#36)
- **送信した依頼のカードアクション** — 全員にコメント / リマインド（手動 re_notify, 1h レート制限）/ 未対応者・期限切れへのディープリンク / コピーして作成 (NDG-40, #34)
- **過去の依頼を再利用** — 既存依頼をコピーして新規作成フォームをプリフィル（毎月の定例業務向け）。削除済み参照は安全に除外し通知 (NDG-43/NDG-50, #38/#52/#53)
- **退職者の依頼ハンドオフ** — テナント全体一覧で退職（inactive）依頼者を検出し、別のアクティブ職員へ差し替え (NDG-41, #49)
- **「管理職」ロール + マネージャ割当 UI** — `org_unit_manager` を管理画面で編集。異動（主所属変更）に追従して権限を自動リセット／再付与 (NDG-47, #37)
- **Keycloak 属性から管理職を同期** — KC user attribute `position` → テナント職位設定に基づき manager ロールを自動付与。手動トグルは保護（manual ロック）(NDG-48, #50)
- **PageHeader 共通化** — 主要 5 画面のタイトル領域・説明文・余白を統一 (NDG-46, #30/#31)

### 変更 (Changed)
- **NudgeFlow デザインシステム** — ブランドグリーンのパレット、shadcn ベースの Card / Badge / RequestCard、lucide-react アイコンのサイドバー、ブランドアイコン設置 (NDG-46, #30/#31)
- 「assignee」表示を「対象者」に統一（内部識別子は不変）(NDG-48[label], #51)
- 一覧と詳細の進捗バーをシングルカラーに統一、孤児化した多色 ProgressBar を削除 (NDG-39, #48)

### 修正 (Fixed)
- 送信した依頼から開いた詳細でサイドバーが「自分宛の依頼」になる文脈バグ (#54)
- 部下ボードのヘッダで `<button>` がネストし hydration error (#55)
- コピー作成時に送信先組織名が UUID 表示 (NDG-50, #52/#53)
- 未読フィルタのラベル誤解・管理ユーザー画面のフィルタ非永続 (NDG-38/NDG-45, #32/#33)
- 期限日入力欄の整形・個人依頼時の所属表示 (NDG-34/NDG-35, #29)
- 新規作成フォームのスティッキー要約が効かないレイアウト基盤 (#31)

## [v0.20] — リブランド・入力体験

### 追加 (Added)
- グループ画面から対象グループを選択済みで新規依頼作成へ遷移 (NDG-37, #28)

### 変更 (Changed)
- 製品表示名を **Nudge → NudgeFlow** に変更（リポジトリ/技術名は `nudge` のまま）(NDG-33, #27)
- 依頼本文エディタのプレースホルダ除去 (NDG-32, #26)

## [v0.19] — Microsoft Teams 連携 (β)

- Teams パーソナルタブ統合：Entra SSO → Keycloak ブローカー経由でシングルサインオン (NDG-26, #25)

## v0.18 以前（要約）

- **v0.18**: 依頼本文エディタにツールバー（太字/リスト/リンク）、登録直後の不要スクロール修正 (#23/#24)
- **v0.17**: GitHub Actions CI/CD、dependabot、PR テンプレート、マルチアーキ Docker ビルド (#12/#22)
- **v0.16**: OSS 配布用 Docker Compose / Dockerfile / Keycloak realm import (#11)
- **v0.15**: OSS 基本ドキュメント整備（LICENSE/README/CONTRIBUTING/SECURITY）、本文 Markdown リンク (#9/#10)
- **v0.14**: 組織管理 UI、`org_unit` の論理削除（archived）(#8)
- **v0.13**: Root 管理者機能（プラットフォーム管理）、同期ログ修正 (#7)
- **v0.12**: 管理 UI 一式（ユーザー / ロール / 監査ログ / 失敗通知再送 / 通知テスト送信）と権限・文脈バグ修正 (#6)
- **v0.11**: グループ機能 (#5)
- **v0.10**: 依頼の想定所要時間、本文書式、依頼元組織、アンケート種別廃止 (#1〜#4)

[v0.21]: https://github.com/tetsukame/nudge/releases
[v0.20]: https://github.com/tetsukame/nudge/releases
[v0.19]: https://github.com/tetsukame/nudge/releases
