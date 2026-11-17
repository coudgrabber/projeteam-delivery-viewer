# 恒久化 第1段階の作業記録（2026-11-17）

## 1. 実際の変更

開始・終了時の GitHub featureブランチHEAD とローカルHEAD はともに `455e991a7ee085c653ca977428e68bd2ee48d3be`。追跡ファイルの開始時差分はありませんでした。開始時から存在した node_modules と .wrangler は commit対象にせず ignore に追加しました。AGENTS.md は対象作業領域にありませんでした。

| ファイル | 変更 |
|---|---|
| `worker.mjs` | private承認台帳読取り、型・件数・重複・承認・ハッシュ検証、旧設定との互換、台帳エラー時の停止、認証後診断、JWT時刻の検証強化、上流応答サイズ制限と15秒timeout |
| `public/app.js` | 取得中の選択変更で古い本文がコピー可能になる競合を修正 |
| `test/worker.test.mjs` | 8件から19件へ拡充。App JWTの実署名検証、台帳失敗・失効・ハッシュ、認証・全パス・応答制限・承認ゲートの否定試験 |
| `test/browser.test.mjs` | 5件から9件へ拡充。既設Chromium選択、日本語・表・リスト・下線、代替コピー、失敗時消去、競合試験 |
| `wrangler.toml` | preview URL無効化予定、台帳変数の説明。実際の本番設定は未変更 |
| `package.json`, `package-lock.json` | Playwright 1.65.0 / Wrangler 4.164.0 固定と実行コマンド |
| `.gitignore` | 依存・ビルド・ローカル秘密設定を除外 |
| `scripts/check-config.mjs` | Worker名・vars維持・Worker先行認証・preview停止・秘密設定混入の静的検査 |
| `scripts/check-deploy-gate.mjs` | 手動起動・レビュー済み完全SHA・対象repo/branch・Environment独立レビューと迂回禁止を検査 |
| `scripts/diagnose.mjs` | App/台帳診断、Accessの認証・未認証プローブ。本文・トークン・cookie・リダイレクトURLを出力しない |
| `scripts/validate-ledger.mjs` | 台帳のローカル構造検証。承認の代行はしない |
| `examples/approved-releases.json` | 空台帳のみ。未承認記事の追加なし |
| `../.github/workflows/secure-delivery-test.yml` | PR/pushの設定・単体・Chromium・Wrangler dry-run、lockfileによる依存固定 |
| `../.github/workflows/secure-delivery-deploy.yml` | 明示手動起動とGitHub Environment必須承認後のみ本番deploy。ゲート未設定・確認不能時は停止 |
| `README.md`, `SETUP.md`, `VALIDATION.md` | 設計、切替条件、診断・運用と本記録 |

## セキュリティレビュー

| 対象 | 確認結果と残る条件 |
|---|---|
| Cloudflare Access | Workerで全パスJWT検証。Accessの実ポリシー・All trafficは未監査 |
| JWT | RS256署名、issuer、audience、期限、発行・開始時刻、メールを検証。不一致・鍵不明は拒否。JWKSは固定のAccess teamホスト、redirect禁止 |
| GitHub App | PKCS#8署名、最大10分のApp JWT、対象repo・Contents:readでトークン要求、秘密情報の返却なし。App全体のインストール範囲は実機未監査 |
| 記事取得 | パスはslugから固定生成、記事は40桁SHAのみ。認証前のprivate取得なし。台帳のある場合は未承認commitの本文取得なし |
| ハッシュ | 台帳ハッシュ＝固定commitのmanifest＝取得HTML SHA-256。旧モードはmanifest照合のみ。ブラウザでもUTF-8本文を再照合 |
| HTML | 既存の許可タグ・属性による再構築を維持。script、イベント属性、iframe、SVG、危険URL等を除去。CSPは維持。選択変更時の競合を修正 |
| 承認 | private repoの保護ブランチを信頼根とする設計。`approved:true`だけで人の承認を証明しない。ブランチ保護とレビュー運用が切替前提 |
| 運用 | no-storeと秘密を含まないエラー。台帳キャッシュ・エラー時の旧許可への復帰なし。取得済みコピーは後から失効できない |
| 本番deploy | 外部Environmentレビュー設定をAPIで確認、SHA一致、承認後再確認。設定確認不能時は停止。workflow改変可能な管理者は信頼境界 |

## 2. 自動試験の実行結果

- 既存試験：単体8/8、Chromium5/5が合格。初回のPlaywright標準ブラウザ未配置エラーは、環境に既設の `/usr/bin/chromium` を選択して解消。環境の再構築はしていません。
- 最終試験：単体 **19/19**、実Chromium **9/9** 合格（ダミー本文とモック上流）。
- `npm run check`、JS構文、workflow2件のYAML読取り、`git diff --check` 合格。
- `npm run build`：Wrangler 4.164.0 dry-run 成功。ASSETS binding と3静的ファイルを認識。本番アップロードなし。
- 空台帳 validator：valid / approvals=0。
- 依存導入の再現確認：最初のnpm既定cacheは書込不可、既存node_modules起点のlockfileに不完全なoptional依存が含まれる問題を検出。空の依存状態からlockfileを作り直し、既設 `/workspace/.npm-cache` を使用した `npm ci --offline --cache /workspace/.npm-cache --ignore-scripts --no-audit --no-fund` が成功。その状態で全試験・dry-runを再実行して合格。
- `npm audit` は当初の固定依存に対して報告0件。これを実機セキュリティ監査の代わりとはしません。
- 秘密設定なしの診断CLIは利用不能として終了。承認ゲートも設定なしでは拒否することを確認。

## 3. Cloudflare・GitHub App の実機で確認できた事項

Cloudflare本番／専用GitHub App認証の成功を実証できた項目はありません。
GitHubコネクタと `git ls-remote` による対象featureブランチの実HEAD確認は成功しましたが、納品専用GitHub Appの認証試験とは別です。
Cloudflareへのアップロード・設定変更・記事取得・記事公開は行っていません。

## 4. 未検証事項と理由

- Cloudflare Access許可／拒否、実WorkerのApp認証、実記事のハッシュ：環境変数にCloudflare認証、App ID/installation/key、実DELIVERY_ORIGINなし。Wrangler設定領域にOAuth資格情報なし。ignoredローカル秘密設定ファイルなし。既存ブラウザにタブ・ログイン済みセッションなし。
- GitHub Environment承認設定の実確認：該当管理APIを提供するコネクタがなく、CLIの読み取りAPI接続も利用不能。設定済みとも未設定とも断定していません。workflowはAPI確認不能なら停止します。
- private承認ブランチの保護・台帳：本番切替・private repoへの書込みは今回行っていません。管理ルールの実監査は未実施。
- note／Wixの実編集画面、Safari：利用可能なログインセッション・対象編集画面・Safariなし。ChromiumのローカルClipboard APIと貼付イベントを確認した範囲です。
- GitHub Actionsの実行：未commit・未push。新workflowのGitHub上での実行は未実施です。
- ハッシュ不一致等の本番負例：本番台帳・記事を改変せず、モックとローカルブラウザで検証しました。

## 5. 本番接続までの人の操作

不可避なのは、必要になったときのアカウントログイン／OTP、管理権限の付与、内容レビューと本番承認です。既存Appの再作成・秘密鍵再発行は前提にしていません。秘密情報はチャットに送らず、既存Worker secretやローカルの非公開設定を再利用します。認証後の設定調査・検証・デプロイ操作はCodex側で継続できます。

独立reviewer必須のEnvironmentを使用するため、本番deployには起動者とは別の承認者が必要です。GitHubプランが必須レビュー非対応なら同じゲートは使用できません。ゲートを省略して本番変更しません。

## 6. GitHub保存の承認と、本番作業の承認待ち

- 第1段階報告後、全件検査・秘密情報確認・19件/9件の再試験を条件として、既存featureブランチへのcommit・通常push・main向けDraft PR作成が承認されました。
- private repoでの承認専用ブランチ／保護設定／空台帳作成と、別途承認した記事の台帳への追加。
- Cloudflareの一度限りの台帳設定、preview停止を含むコードの本番デプロイ。
- GitHub Environmentとデプロイ用secretの設定、および本番実行時の独立承認。

main統合・記事公開は行っておらず、今回の承認対象に暗黙には含めません。


## GitHub保存前の再検査

- Worker実URLは利用者から `https://projeteam-secure-delivery.cloudgrabber.workers.dev` と補足されました。URLの判明は実認証・GitHub App接続の検証成功を意味しません。上記のURL未設定という記録は第1段階実行時の環境状態です。
- GitHub/ローカルのfeature HEADはBaselineと一致し、予期しない追跡ファイル差分はありません。変更対象18ファイル（変更8、新規10）を確認しました。
- 変更・未追跡ファイルの全内容を確認し、秘密鍵本体・実トークン・認証Cookie値・個人情報・private記事本文の混入は確認されませんでした。テスト内のメールはexampleドメイン、一時トークンはダミー、RSA鍵とJWTは実行時生成です。依存lockfile94レコードも検査しました。
- 本番デプロイworkflowのイベントは workflow_dispatch のみ。push/PR workflowのbuildは dry-run 固定で、本番デプロイ資格情報を参照しません。GitHub保存によって本番deployを起動しません。
- 保存前再実行：単体19/19、Chromium9/9合格。設定検査も合格。本番への接続・設定変更は実行していません。
