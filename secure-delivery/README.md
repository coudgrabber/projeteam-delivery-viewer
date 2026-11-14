# 認証付き納品サービス（実装試作・未デプロイ）

このディレクトリは、公開リポジトリ内に置ける**秘密情報を含まないソースコード**です。
動作中のサービスではありません。既存の `index.html` と `app/index.html` は変更しません。

## 設計

1. Cloudflare Worker と静的サイトを専用の `workers.dev` URLに配置し、Cloudflare Access の **Worker単位・All traffic** 保護を有効にして本番URL・プレビューURLを認証必須にする。独自ドメインは初期構築に不要。
2. Worker 自身も `Cf-Access-Jwt-Assertion` を Cloudflare公開鍵によって RS256 検証。issuer / audience / 有効期限 / 許可メールを検証し、認証されないアクセスは拒否。
3. Worker だけが GitHub App の秘密鍵を保有し、GitHub App installation token（Contents:readのみ、かつ `SOURCE_REPO` のリポジトリ名に限定）を都度取得。ブラウザには渡さない。GitHub App自体のインストール範囲も指定リポジトリ1件に制限する。
4. 管理者が設定した記事slugと40桁コミットSHAの**許可リスト**のみ取得できる。ブランチ名や任意パスはユーザー入力に使わない。
5. プライベートGitHubの `docs/<slug>/deliverable-hashes.json` と対応するHTMLファイルを同一の固定コミットから取得。バイト列の SHA-256 一致後だけ配信する。
6. ブラウザでは既知の `article#note-article` または `article#wix-article` だけを取り出し、タグ・属性のホワイトリストでDOMを再構築する。原HTMLのスクリプトは実行しない。
7. HTML + plain text をクリップボードへ送る。コピーAPIの成功は、note/Wixでの書式保持まで保証しない。
8. 個人認証メール、記事本文、GitHub tokenをログに記録しない設計。レスポンスは `no-store`、CSP、frame禁止。失敗時は実装・秘密情報を返さない。

## 管理者が行う事前準備（**未実施**）

- Cloudflare WorkersとZero Trustが使えるアカウントの用意。初期接続は専用の `*.workers.dev` URLを使用し、独自ドメインの購入やDNS移管は不要（共有 `*.github.io` でGitHub PATを入力する既存の試作コードは本番で使わない）。
- GitHub Appを作成し、**Repository permissions: Contents: Read-only**、インストール先は `coudgrabber/projeteam-blog` **1リポジトリだけ**を指定。不要な権限は付けない。
- GitHub App の **App ID、Installation ID、PKCS#8 RSA private key** を準備。GitHubのPEMが `BEGIN RSA PRIVATE KEY` 形式の場合は、オフラインでPKCS#8 `BEGIN PRIVATE KEY` 形式に変換する。秘密鍵をGitHubへcommitしない。
- Cloudflare Workers & Pages → 対象Worker → Access → Protect this Worker behind Access → **All traffic** から保護する。認証対象のメールアドレスを明示して許可ポリシーを設定し、**本番URLとプレビューURLを両方**保護する。
- Workerの `workers.dev` URL とAccess保護範囲を照合。キャッシュとWeb解析が非公開記事を保存しないことを確認。

## 環境変数（例示値だけ）

| 名前 | 例／内容 |
|---|---|
| `DELIVERY_ORIGIN` | `https://projeteam-secure-delivery.<account-subdomain>.workers.dev`（デプロイ後に実URLと完全一致させる） |
| `CF_ACCESS_TEAM_DOMAIN` | `your-team.cloudflareaccess.com` |
| `CF_ACCESS_AUD` | AccessアプリのAUDタグ |
| `ALLOWED_EMAILS` | `writer@example.org`（カンマ区切り） |
| `SOURCE_REPO` | `coudgrabber/projeteam-blog` |
| `GITHUB_APP_ID` | GitHub App数値ID |
| `GITHUB_INSTALLATION_ID` | 数値ID |
| `GITHUB_APP_PRIVATE_KEY_PKCS8` | **シークレット**。改行を含むPKCS#8 PEM |
| `DELIVERY_RELEASES_JSON` | 後述のJSON（**本番運用まで未設定**） |

`DELIVERY_RELEASES_JSON` の書式（確定コミットのみを登録）：

```json
{
  "democracy-criteria": [
    "f0f4753155b84a9380635229ad12f3695b63a59a"
  ],
  "world-models-language-experience": [
    "c9ce0d58ac925a2014600fee483782b86abc6056"
  ]
}
```

設定の書き込み（本番環境への登録・デプロイ）は**別途承認が必要**。ここでは行わない。

## 実装・試験

```bash
cd secure-delivery
node --test test/worker.test.mjs
```

事前に Node.js 22以上を用意。テストは全て外部ネットワーク不要のモック。

コードレビューで確認すべき主な点：
- Cloudflare Accessのaudience / issuer / key検証、Accessポリシーでの全パス保護
- GitHub App private key をWorkerシークレットだけに配置
- 任意GitHubパスの取り出しを許容しないこと
- ハッシュ不一致・認証エラーで fail-closed
- 貼付先に渡るHTMLでscript、style、iframe、イベント属性が残らないこと
- 本番ドメインとキャッシュ設定、デバッグログに本文・トークンが漏れないこと

## 状態

- GitHub専用ブランチの実装・テストソース：作成済み
- GitHub Actions Node単体テスト：6件合格（2026-11-14）
- GitHub Actions Chromium実ブラウザテスト：5件合格（2026-11-14、合成したダミーHTMLによる検証）
- Cloudflare Workers本番実機、AccessとGitHub Appの実認証：未検証
- GitHub App作成、DNS、秘密情報登録、デプロイ：未実施
- noteの既存確定HTMLを手動ブラウザ取得で貼付：利用者が4書式の保持を確認済み

## 本番接続前の検証条件

1. Cloudflareに利用者アカウント（Workers + Zero Trust）を用意する。初期は独自ドメイン不要の `workers.dev` URLを利用する。Workers & Pages → 対象Worker → Access → **Protect this Worker behind Access → All traffic** で保護し、対象メールだけを許可。Accessポリシーとは別にWorkerがJWTを照合する。
2. GitHub Appを **対象1リポジトリ** にインストールし、Contents: readのみを許可。キーと数値IDをWorkerの非公開環境に保管。GitHub Appのリポジトリ権限と一時トークンのリポジトリ制限を別々に確認する。
3. GitHub App認証、Accessのログイン・セッション失効、未承認ユーザー、未承認commit、ハッシュ不一致、キャッシュ無効化を本物の環境で検証する。`workers.dev` の本番・プレビュー双方における全パス認証を確認する。
4. 本番記事 `democracy-criteria` の確定SHAを許可リストに登録する場合も、配信内容が未公開記事であることを踏まえ、認証完了まで第三者に配信しない。
5. noteとWixの実編集画面で書式が保持されるかユーザーが確認。公開操作は別途判断する。

## 自動検証（2026-11-14確認）

GitHub Actions `Secure delivery unit tests`：
- Node 22での構文検証と単体テスト6件：合格
- Chromiumでのブラウザ・Clipboard API・HTML安全化・fail-closedのテスト5件：合格
- ブラウザ試験はダミーHTMLを使い、秘密情報・非公開記事は公開リポジトリに保存していない
- 実環境への統合試験（Cloudflare Access・GitHub App・Safari・Wix）：未実施

**重要：本番接続と秘密情報の設定は、この実装ブランチのコード変更とは別の作業であり、まだ行っていない。**
