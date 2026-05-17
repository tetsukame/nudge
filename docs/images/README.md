# 画面キャプチャ撮影リスト

`docs/overview.md` / README から参照する画像をここに置きます。
ローカルの dev server（`npm run dev` → http://localhost:3000）にログインし、
テナント `dev` で以下を撮影してファイル名どおりに保存してください。

推奨: ウィンドウ幅 1280px 前後、ライトテーマ、実データが数件ある状態。

| ファイル名 | 画面 / URL | 望ましい状態 |
|---|---|---|
| `dashboard.png` | `/t/dev`（ロゴクリック先） | 自分宛・送信・(可能なら)部下のカードに数値が入っている |
| `inbox.png` | `/t/dev/requests` | 未対応タブ。カードに状態バッジ・想定時間・「対応する」 |
| `new-request.png` | `/t/dev/requests/new` | セクションカード＋右の「送信前の確認」サマリが見える |
| `sent.png` | `/t/dev/sent` | 進行中。カード右下の💬/🔔/📋アクションが見える |
| `request-detail.png` | `/t/dev/requests/<id>?from=sent` | 本文＋全体進捗＋対象者一覧 |
| `subordinate-board.png` | `/t/dev/subordinates` | タスクモード。完了率・期限フィルタ・リマインド |
| `subordinate-board-user.png` | `/t/dev/subordinates`（人トグル） | 人モードで期限が近い順 |
| `admin.png` | `/t/dev/admin` | StatCard 群＋管理メニューのカードグリッド |
| `admin-user-detail.png` | `/t/dev/admin/users/<id>` | ロール（管理職）＋「マネージャとして管理する組織」＋KC連携表示 |
| `position-config.png` | `/t/dev/admin/settings/positions` | 管理職とみなす職位のチップ編集 |

撮り終えたら `docs/overview.md` / `README.md` のプレースホルダ（`<!-- IMG: ... -->`）が
自動的に画像参照になっています（パスは `docs/images/<file>`）。不要な行は削ってください。
