# 初回接続の操作順（未実行・認証情報をGitHubに記録しない）

この手順は非公開記事の納品サービス専用。初回設定時の作業だけで、以後の記事納品で繰り返さない。

## 事前条件

- Cloudflareアカウント（Workers、Zero Trust利用可能）
- GitHubアカウント `coudgrabber` でGitHub Appを登録・対象リポジトリにインストールできる権限
- ブラウザでサインインできる受信可能なメールアドレス（値はGitHubに書かない）
- 運用中の記事の変更承認は不要。納品対象を固定コミットとして登録した場合のみ、そのコミットを読み取る

## Phase 1: GitHub App（最小権限）

1. GitHub → Settings → Developer settings → GitHub Apps → New GitHub App。
2. 名前は識別可能な専用名にする。Webhookを使わないので **Activeのチェックを外す**。
3. Repository permissions → **Contents: Read-only**。追加の書き込み権限は付与しない。
4. Appを登録し、GitHub Appのインストール先は **Only select repositories** → `coudgrabber/projeteam-blog` のみ。
5. App ID と Installation ID を、Worker側の環境変数設定用に控える。Private keyはGitHub App設定画面で発行し、秘密鍵は公開リポジトリ・チャット・Issue・PRに貼らない。
6. GitHub App の秘密鍵がPKCS#1（`BEGIN RSA PRIVATE KEY`）で発行された場合、秘密鍵をローカル環境内でPKCS#8（`BEGIN PRIVATE KEY`）へ変換してからWorkerシークレットに格納する。変換後の一時ファイルは安全に管理する。

## Phase 2: Cloudflare Workers（最初は非公開記事を登録しない）

1. Cloudflare DashboardでWorkersを使用できるアカウントを選ぶ。Zero Trustを初期設定していなければ有効化。
2. このリポジトリの `secure-delivery` ディレクトリをWorkerのプロジェクトルートとし、Wrangler から新規Worker `projeteam-secure-delivery` を配置する。
3. `workers_dev = true` で割り当てられる `https://projeteam-secure-delivery.<your-subdomain>.workers.dev` を確認。**そのURLを他者に配布しない**。
4. Workers & Pages → 該当Worker → **Access** → **Protect this Worker behind Access** → **All traffic** を指定（Previews onlyではない）。**利用者の具体的なメールアドレスのみ**許可する。
5. Accessのteam domainおよびアプリのAUD値を確認。`ALLOWED_EMAILS` を同じ許可対象とし、Worker自身のJWT検証を有効にする。
6. 設定したURLで未認証アクセスが認証画面に誘導・拒否されること、本番URLとPreview URLがともに保護されることを確認する。

## Phase 3: Worker環境変数と秘密鍵

以下はCloudflareのWorker設定にのみ登録。公開GitHubの `wrangler.toml` 、CIログ、issue、チャットに実際の値を記録しない。

- `DELIVERY_ORIGIN` = Phase 2で確認したHTTPSオリジン
- `CF_ACCESS_TEAM_DOMAIN` = `<your-team>.cloudflareaccess.com`
- `CF_ACCESS_AUD` = AccessアプリAUD
- `ALLOWED_EMAILS` = 許可メールアドレスのCSV（最低1件）
- `SOURCE_REPO` = `coudgrabber/projeteam-blog`
- `GITHUB_APP_ID` = App数値ID
- `GITHUB_INSTALLATION_ID` = Installation数値ID
- `GITHUB_APP_PRIVATE_KEY_PKCS8` = **secret**（PKCS#8秘密鍵）
- `DELIVERY_RELEASES_JSON` = **初期はダミーまたは未設定**。本番記事を入れるのは認証・秘密鍵・エラー動作の確認後。

登録後にWorkerを再配置して設定が有効になったことを確認する。

## Phase 4: 実記事を許可（限定した確認）

1. Access未認証のブラウザから、トップ、`/app.js`、`/api/releases`、Preview URLが非公開であることを検証。
2. 許可したメールアドレスでログインし、未登録のコミットは取得できないことを検証。
3. GitHub Appのinstallation tokenがContents:readで対象リポジトリ1件に限定されていることを確認。
4. 次の確定版を `DELIVERY_RELEASES_JSON` に1件だけ許可：
   `{"democracy-criteria":["f0f4753155b84a9380635229ad12f3695b63a59a"]}`
5. 認証済み画面でnote用HTMLを取得し、ハッシュ検証・コピー・実際のnote編集画面への貼付を確認。未公開のままにする。
6. Wix版はWix編集画面が使える時に別途確認。意図しない公開や記事編集は行わない。

## 禁止事項と停止条件

- GitHub Appの秘密鍵をGitHubファイルや公開サイトに含めない。
- Cloudflare Accessの保護を有効化できない場合、実記事の登録を進めない。
- 一時アクセストークンをブラウザへ渡さない。
- Workerの公開認証状態を確認しないまま、未公開記事を取得・表示させない。
- 全手順が完了するまでは「本番運用成功」と報告しない。

## 参考（Cloudflare公式）

- https://developers.cloudflare.com/workers/configuration/cloudflare-access/
- https://developers.cloudflare.com/workers/configuration/routing/workers-dev/
- https://developers.cloudflare.com/workers/static-assets/binding/
