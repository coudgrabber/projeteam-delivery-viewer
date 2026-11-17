# 独立レビュー対応：コード、本番配置、記事配信の承認を分離する

この記録は Draft PR #1 のHEAD `71f8bc1f3dac0a3e5bc6ea2c54ff9d410c0bae08` への独立レビュー後のものです。第1.5段階報告時点ではローカルのみでした。その後、再検査条件付きでGitHub保存と読取り専用Actionsプローブが承認されました。main統合、本番deploy、Cloudflare設定、private repoの変更はしていません。

## 本番デプロイの条件

本番資格情報を使うworkflowは手動起動のみ、jobの条件も保護済み `refs/heads/main` に限定します。EnvironmentもGitHub側でSelected branches / branch `main` 一件だけに制限し、featureブランチ上のworkflow改変で本番secretを取得できないようにします。この外部設定はまだ実施していません。

`release_sha == GITHUB_SHA` は取り違え防止のピンです。コードレビューの証拠とは扱いません。ゲートは以下を読み取りAPIで検査します。

1. mainが現在も保護され、入力SHAがmainの現在HEADであること。Environment承認後にも再実行する。
2. classic branch protection が管理者にも適用され、PR必須承認1件以上、古い承認の失効、最終pushの承認、CODEOWNERS承認が必須。PR承認迂回リストなし、force push・削除禁止。
3. strict required status checkに `secure-delivery-verify`、GitHub Actions app ID 15368 が固定されていること。パスによるrequired checkの未実行を避けるためPR／mainの検証workflowのpath filterを削除した。
4. 対象SHAを実際にmainへmergeしたPRが一件存在し、draftでなく、merge_commit_shaが一致すること。PRの最終HEAD SHAへの人の最新有効承認が、現在write/maintain/admin権限を持つ非作者から必要件数あること。最新のchanges requested、dismissed、古いcommitへの承認、bot、自己承認、重複カウントを拒否する。
5. Environmentが必須reviewer・自己承認禁止・管理者迂回禁止で、branch型 `main` 一件だけを許可すること。GitHubのEnvironment承認そのものはGitHubに強制させる。

現実装はclassic protection APIを監査対象とします。rulesetsだけを設定してclassic保護がない構成は成功と判定しません。対応範囲を増やす際は別途レビューが必要です。merge／squash mergeの結果SHAを使用し、関連PRとmerge結果SHAを一意に結び付けられないrebaseや直接push、古いmainへのロールバックは拒否します。ロールバックは新しいレビュー済みrevert PRをmainにmergeして行います。

mainからの手動起動で承認前の検証・全テストを実施し、Environment承認後に同じゲートを再検査してからdeployします。feature／PRは秘密情報のないローカル・CI試験とWrangler dry-runだけ。本番前の実接続が必要なら、別Worker・別Access・別Environment・ダミーrepo／台帳で隔離したstagingを別途設計・承認します。今回stagingを作成していません。

## APIの最小権限と実接続プローブ

| API | 必要な読み取り権限 | 使用する資格情報 |
|---|---|---|
| Environment取得、deployment branch policies取得 | Actions:read | workflowのGITHUB_TOKEN (`actions: read`) |
| main・commit関連PR、PRレビュー | Contents:read / Pull requests:read | GITHUB_TOKEN (`contents: read`, `pull-requests: read`) |
| reviewerのrepository permission | Metadata:read | GITHUB_TOKENに付随するmetadataアクセス |
| mainのbranch protection詳細 | Administration:read | `GOVERNANCE_READ_TOKEN`。viewer repo一件のみの監査専用fine-grained PATまたは短命GitHub App installation token |

AdministrationはGITHUB_TOKENのworkflow permissionsでは付与できません。`permissions: write-all` や記事取得Appの権限増加で回避しません。監査tokenには書込み・秘密情報読取り・private記事repoへのアクセスを付けません。既存資格情報で取得可能か先に確認しましたが、現在のコネクタはAdministration読取り非対応、ローカルに監査tokenもありません。新規資格情報の作成・登録は未実施です。短命tokenの自動発行はこの実装には含まれていないため、採用時は失効・更新運用も決めてください。

`node scripts/probe-governance.mjs` は実APIをGETする専用プローブです。HTTPステータスと固定の理由コードだけを出力し、レスポンス本文や資格情報を出しません。Actions readが実際に足りるか確認する手動の `secure-delivery-governance-probe.yml` も追加しました。このworkflowにはEnvironment jobもCloudflare資格情報もdeployもありません。第1.5段階保存の承認に基づき、default branch未配置でも実行できるようfeatureブランチのプローブ関連ファイルpushでも起動する限定経路を追加しました。既存資格情報だけを使い、監査tokenの追加登録や権限拡張はしません。

本プローブはEnvironment APIの200応答とポリシー適合を区別します。401/403/404・レート制限・通信障害・監査token未設定はすべて停止です。公開Environment APIが匿名で読める場合でも、workflow上のtoken権限で成功したとは同一視しません。改修のpush／workflow実起動は未承認のため、Actions内のGITHUB_TOKENによる200応答は未実証です。

## 2026-11-17の読み取り調査

| 対象 | 実際の結果 |
|---|---|
| viewer repo | public、個人所有（owner type User）、接続ユーザーのrepository admin権限を確認 |
| viewer main | REST branches/mainは成功。`protected:false`、現在HEAD `8886bfb80cf0c9430e9e88169aa62934eb68245a`。まだ本番元の条件を満たさない |
| viewer main/protection | コネクタが403 `Resource not accessible by integration`。管理者ユーザーとしての権限と接続Appのtoken権限は別 |
| private blog repo | private、個人所有、デフォルトブランチmaster |
| delivery-approved | コネクタのbranch検索は0件。未存在を確認。作成・台帳登録なし |
| private blog/rulesets | 実APIが403、GitHub Proへのupgradeまたはpublic化が必要と回答。public化は採用しない |
| 実契約プラン名 | コネクタのprofileはplanを返さず、CLI /userも通信不能。Free等のプラン名は断定しない。ただし現接続でprivate保護機能がプラン制限により利用できないというAPI応答は確認済み |
| Environment実APIプローブ | Nodeで実行。Environmentはtransport failure、Administration側は監査資格情報未設定で失敗。Actions実行tokenでは試せていない |

APIの403はプラン障害と権限障害を区別して記録します。プラン不足をtoken権限増加で直せるとは扱いません。

## private台帳の保護設定計画（まだ適用しない）

GitHub公式ではpublic repoの保護ブランチ・CODEOWNERSはFreeでも利用可能ですが、個人所有private repoではPro以上が必要です。個人所有なので組織Teamプランを現状に直接適用できるとは扱いません。ownerのBilling／Plansで契約を確定し、現APIのupgrade要求を解消できる契約／構成を選ぶ必要があります。記事を公開して制限を回避しません。

Environmentのrequired reviewersはFree/Pro/Teamではpublic repo向けです。本番workflowを置くviewerはpublicなので利用可能な設計ですが、private blogのEnvironmentを記事承認の代わりとして使う設計ではありません。

将来の承認後の適用順は次のとおりです。

1. 契約上の保護機能が有効であることをownerが確認。設定管理者と記事承認者を任命する。必須PR承認にはwrite権限を持つ非作者が必要。CODEOWNERSに指定する個人もwriteが必要。Environmentの本番承認者はread以上でよい。個人所有repoの共同作業者に「記事台帳だけwrite」の細かな権限があるとは仮定しない。
2. ownerがSettingsのbranch rule／有効なrulesetで、未作成の `delivery-approved` と完全一致する対象ルールを先に準備できるかUI／GraphQLで確認する。classic REST update-branch-protectionは既存branchを対象とするため、未存在branchへPUTして準備できるとは扱わない。
3. 必須PR、非作者による承認、古い承認失効、最終push承認、CODEOWNERS、管理者も適用、迂回なし、force push・削除禁止を設定。候補生成bot／納品Appに保護のbypass権限を与えない。個人所有repoではpush actor制限やチーム機能の有無を組織repoと混同しない。
4. 初期CODEOWNERSと空台帳をレビューしてからbranchを作成する。branch作成と初期保護にブートストラップ例外が必要なら、公開配信を無効のまま手順と担当を別途承認し、保護と空台帳を確認してからWorkerを接続する。今回その例外を作成・実行しない。
5. `delivery/approved-releases.json` とCODEOWNERS自体を既存の承認担当者が保護する。コードを生成する人／botが承認担当者を書き換えて自己承認できない運用にする。保護の実読取りと拒否試験が成功するまでWorkerの台帳設定へ切り替えない。

実プランで保護できなければ、現行の「保護ブランチを信頼根とする台帳方式」は本番化不可です。契約変更、適切な組織への移管、GitHub管理者から独立した署名承認方式などは比較・追加承認が必要で、今回勝手に選択・実装しません。

## 管理者と記事承認者の違い・残るリスク

| 役割 | 権限と責任 |
|---|---|
| GitHub設定管理者 | repo保護、CODEOWNERSの初期設定、App権限、契約・監査tokenの設定。adminであるだけでは記事の配信承認者にはしない |
| コードreviewer | viewerの実装PRをレビュー。記事内容の配信承認ではない |
| 記事配信承認者 | private台帳の指定CODEOWNER。固定commit・両書式ハッシュ・配信対象をレビューして承認。未承認の生成物を自動追加しない |
| 本番Environment承認者 | mainのレビュー証跡と運用条件を確認してdeploy承認。記事承認の代用ではない |
| 納品App | private contents:readのみ。設定変更・記事承認・台帳書込み不可 |
| Cloudflare管理者 | Workerコード・secret・設定を変更可能。GitHub外の信頼境界 |

本番gateはCODEOWNERSの具体的な人物を独自に解釈し直さず、GitHubのCODEOWNER必須保護と最新の有効PR承認を組み合わせます。指定CODEOWNERSが正しい人で、対象ファイルとCODEOWNERS自身を覆うことは外部設定監査の条件です。現段階で実reviewer名を推測してCODEOWNERSを書いていません。

repo ownerは保護やEnvironment設定、監査token、workflow自体を変更できます。保護を一時的に解除して不正commitを取り込み、元に戻す攻撃を、現在設定のAPI検査だけでは完全に検出できません。Environment承認も設定変更前後の履歴の真正性を保証しません。設定変更の別担当レビュー・利用可能な監査ログ／通知・定期照合でリスクを低減しますが、GitHub/Cloudflare管理者に対する暗号学的な独立承認の保証はありません。その保証が必要なら、署名鍵の管理を別主体へ分離する設計が必要です。

監査tokenをrepo secretに置く場合はfeature上のworkflowから参照され得ます。このためpublic viewerのAdministration:readだけとし、記事用資格情報・書込み権限を絶対に兼用しません。本番Cloudflare tokenはmain限定Environment secretだけに置きます。ゲート検査直後の設定／main更新との競合はAPIとdeployの間に完全には消せないため、管理者の同時変更禁止とEnvironment承認時の確認も必要です。

## 公式資料

- Environment取得のActions:read、プラン条件: https://docs.github.com/en/rest/deployments/environments#get-an-environment
- Deployment branch policiesのActions:read: https://docs.github.com/en/rest/deployments/branch-policies#list-deployment-branch-policies
- Branch protectionのAdministration:readとプラン条件: https://docs.github.com/en/rest/branches/branch-protection#get-branch-protection
- PR必須レビューとwrite権限、保護ルール: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
- CODEOWNERSの権限とbase branch上の配置: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners
- Environment reviewerはread以上、main限定ポリシー、管理者迂回: https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments

方式比較と本人同意／独立reviewの区別は `LEDGER-OPTIONS.md` を参照してください。
