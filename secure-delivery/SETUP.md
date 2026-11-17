# 既存環境から恒久運用への切替

環境再構築、App再作成、秘密鍵の再発行は行いません。まず既存の設定を再利用します。
この変更の GitHub保存は、全件検査と再試験を条件に承認されています。本番設定変更・デプロイ、private repo の台帳書込みは引き続き未承認・未実施です。

## 事前に確認する既存設定

Worker の `DELIVERY_ORIGIN`、`CF_ACCESS_TEAM_DOMAIN`、`CF_ACCESS_AUD`、`ALLOWED_EMAILS`、`SOURCE_REPO`、`GITHUB_APP_ID`、`GITHUB_INSTALLATION_ID` と secret `GITHUB_APP_PRIVATE_KEY_PKCS8`。GitHub App は対象 private repo 一件、Contents:read のみであることを管理画面で確認します。環境 Publish は Cloudflare 本番への Worker deploy を意味しません。

Cloudflare Access は本番ホストの全パスを保護し、許可メールだけを許可。Worker の追加JWT検証と独立して確認します。本変更は `preview_urls=false` でプレビューURLを無効にする予定です。切替前の既存previewが使える場合は保護を確認し、切替後は到達不能を確認します。独自routeやcustom domainを別途使っている場合も保護範囲を確認します。

## 承認台帳

1. private repo の専用ブランチ `delivery-approved` に、必須レビュー、自己承認禁止、直接push・force push・削除・迂回の禁止を設定。台帳のレビュー担当を決めます。この設定を確認するまでWorkerを台帳へ切り替えません。
2. `delivery/approved-releases.json` を空台帳で準備。`node scripts/validate-ledger.mjs <local-file>` で検証します。記事を自動登録しません。
3. 承認後に Worker へ `DELIVERY_LEDGER_REF` / `DELIVERY_LEDGER_PATH` を一度だけ登録。既存秘密鍵はそのまま再利用します。
4. App と Access の診断、未許可ユーザー拒否、未承認commit拒否を確認。記事は別途承認した固定コミットとハッシュだけを台帳PRへ追加します。
5. 許可ユーザーによる通常取得で両書式のハッシュ照合を確認。旧 `DELIVERY_RELEASES_JSON` は検証後に削除します。旧設定への自動復帰はありません。

以後は承認済み台帳PRの取り込みで配信対象を更新します。Cloudflareの毎回の手動更新は不要です。撤回は台帳から削除します。緊急停止は空台帳、または Access 側の許可停止で対応します。

## GitHub Actions 本番承認ゲート

- Environment `production-delivery` を設定し、必須 reviewer、Prevent self-review、Allow administrators to bypass を無効に設定します。使用プランで必須レビューを利用できない場合、このworkflowは利用できません。
- Environment secrets に最小権限の `CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` を保持。Worker の App秘密鍵・許可メール・記事台帳はGitHub Actionsへ複製しません。
- Environment の deployment branch policy を運用ブランチに制限します。workflowは main または指定featureブランチだけを受け付けます。
- GitHub の手動workflow起動には、workflow定義がデフォルトブランチに存在する条件があります。現在は main統合を禁止されているため、今回workflowの実起動は行いません。
- 別途承認後、レビュー済みソースを配置して手動workflowの `approved_sha` に選択ブランチHEADの完全SHAを指定。設定確認・全試験後に Environment 承認待ちへ進みます。
- Environment APIを読めない場合も停止します。権限の自動拡張やゲート省略はしません。必須レビューと迂回禁止は承認後にも再確認します。
- Wrangler は既存 Worker の vars を維持してコードとassetsを配置します。Accessポリシー、台帳ブランチ保護、秘密情報登録は変更しません。初回本番接続ではそれらを別途検証する必要があります。

承認ゲートの管理権限を持つ人がworkflow／設定を改変できるという管理者の信頼境界は残ります。workflowと関連スクリプトもレビュー対象として保護してください。

## 実機で残る確認

- 許可ユーザーのAccessログイン、許可外メール拒否、ログアウト・期限切れ、本番全パスとプレビュー停止。
- Worker内のApp認証、private台帳の読取り、承認記事の両書式取得。ハッシュ不一致は隔離した試験環境で実施し、本番台帳・本番記事を壊して試さないこと。
- note／Wix の非公開テスト編集画面でダミー文章を貼付し、見出し・太字・引用・リンク・表等を確認。保存・公開は別途承認なしで行わないこと。

ログイン・OTP・必要な管理権限付与だけは人の操作が必要な場合があります。秘密鍵やトークンをチャットに送る必要はありません。
