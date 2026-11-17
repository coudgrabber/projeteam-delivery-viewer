# 認証付き納品ビューア

Worker: `projeteam-secure-delivery`。既存の公開ビューアとは独立した実装です。
環境の構築・Publish は完了済みという引継ぎを前提にしています。本変更は未デプロイです。

## 配信の信頼境界

- Cloudflare Access の All traffic 保護に加え、Worker でも RS256署名、issuer、audience、exp、iat、nbf、許可メールを確認。静的ファイルと診断も認証必須。
- GitHub App の PKCS#8秘密鍵は Worker secret のみに保持。一時トークンは Contents:read と `SOURCE_REPO` のリポジトリに制限し、ブラウザに返さない。
- private `coudgrabber/projeteam-blog` の専用保護ブランチにある承認台帳をリクエストごとに取得。台帳に記載された固定コミットだけを取得する。
- 台帳の承認ハッシュ、同一固定コミットの `deliverable-hashes.json`、HTMLバイト列の SHA-256 を照合。ブラウザでも再照合した後に DOM を許可タグ・属性だけで再構築する。
- 取得失敗・不正台帳・ハッシュ不一致は配信停止。本文・秘密情報・上流エラーをログやエラーレスポンスに出さない。レスポンスは no-store、CSP と frame禁止を付与。

## 承認台帳（初回切替後は Cloudflare の記事別設定不要）

一度だけ次のサーバー設定を追加します。実環境への設定変更は別途承認後です。

| 設定 | 値 |
|---|---|
| `DELIVERY_LEDGER_REF` | `refs/heads/delivery-approved` |
| `DELIVERY_LEDGER_PATH` | `delivery/approved-releases.json` |

台帳も記事も `SOURCE_REPO` 内に配置します。リポジトリ権限は増やしません。
空の雛形は `examples/approved-releases.json`。記事は一件も追加していません。

台帳形式は `{"version":1,"releases":[]}`。各 releases 要素に次のフィールドが必要です。

| フィールド | 条件 |
|---|---|
| `slug` | 小文字英数字とハイフン |
| `commit` | レビュー済みの40桁小文字コミットSHA。ブランチ名不可 |
| `approved` | boolean の `true` のみ |
| `hashes.note` / `hashes.wix` | 承認した各HTMLの64桁 SHA-256 |

最大500件。同一 slug・commit の重複、不正レコードが一件でもあれば台帳全体を拒否します。
空配列は有効な「配信なし」です。削除は次の取得から反映され、取得済みのコピーは回収できません。

**`approved:true` 自体は人の承認の証明ではありません。** 専用ブランチに必須レビュー、自己承認禁止、直接push・force push・削除・管理者迂回の禁止を設定し、台帳パスのレビュー責任者を定めてください。記事生成処理から承認ブランチへ直接書き込ませません。Worker の Contents:read 権限では GitHub の管理ルールを監査できないため、この統制の設定確認を切替条件にします。

記事追加は private repo で候補コミットとハッシュをレビューし、承認済み台帳へ取り込むだけです。未承認の候補、全記事の自動走査、ブランチ最新記事の自動配信はありません。

互換性のため `DELIVERY_RELEASES_JSON` は台帳設定が両方ない場合だけ有効です。片方でも台帳設定があればエラー時にも旧設定へフォールバックしません。切替確認後、旧変数は削除します。旧方式では承認ハッシュの台帳照合は行いません。

## 検証

Node >=22。依存は lockfile 固定です。

```sh
cd secure-delivery
npm ci
npm run check
npm test
npx playwright install chromium
npm run test:browser
npm run build
node scripts/validate-ledger.mjs examples/approved-releases.json
```

既設 Chromium を使う場合は `CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:browser`。
`npm run build` は Wrangler dry-run のみで、本番には変更しません。

`/api/health` は Access検証だけ、`/api/diagnostics` は Access検証後に Appトークン取得と台帳読取り・構造検証を行います。診断は本文を取得せず、記事ごとの完全性やAppインストール全体の権限監査を保証しません。記事照合は通常の `/api/article` で実行します。

ローカル診断は、既存の秘密情報管理から用意した ignored env file を使います。秘密情報をコマンド引数、チャットやログへ貼り付けないでください。

```sh
node --env-file=.env.local scripts/diagnose.mjs github
node --env-file=.env.local scripts/diagnose.mjs access
```

GitHub診断には台帳設定・SOURCE_REPO・App ID・Installation ID・PKCS#8鍵が必要です。
Access診断は `DELIVERY_ORIGIN` を指定し、まず `CF_ACCESS_JWT` なしで拒否を確認、次に既存の許可ユーザーセッションJWTを環境に渡して許可とno-storeを確認します。本文やリダイレクトURLは出力しません。拒否のHTTP応答だけで Access設定自体の正しさは断定できません。未許可ユーザーとセッション失効、preview停止も別途実機確認します。

GitHub Actions は PR／対象ブランチpushで設定・単体・Chromium・dry-runを実行します。本番デプロイは別の手動workflowと必須承認ゲートです。詳細は `SETUP.md`、レビュー・実行結果は `VALIDATION.md` を参照してください。
