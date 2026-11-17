# 配信承認方式の比較（2026-11-17、調査のみ）

今回の比較は契約・設定・実装方式の採用承認ではありません。D1作成、署名鍵発行、private repo変更、main保護変更、Cloudflare変更は行っていません。

## 最初に区別する3つの承認

1. **利用者本人の明示的な配信承認**：本人が対象slug、固定commit、note/Wixのハッシュ、閲覧対象・配信範囲を確認して「この版を納品ビューアへ配信してよい」と意思表示すること。コード変更の承認や、記事の制作完了だけから推定しない。
2. **GitHub上の独立レビュアー承認**：GitHubのPRレビューとして、作者とは別の適格なアカウントが承認すること。必須PRレビューはwrite権限が必要。本人が自分のPRを承認することや、このチャットのレビューをGitHub上の独立レビューの代わりにしない。
3. **本番コード配置の承認**：保護済みmainのコードをEnvironmentで承認してdeployすること。記事配信の承認ではない。Environment reviewerはread以上でよく、PR reviewerの権限条件と異なる。

本人の配信承認と独立レビューは両立できますが同一ではありません。本人がPR作者なら、本人の明示同意を別に記録してから独立reviewerが確認する二段階にします。一人運用で本人同意だけを採用する場合、独立reviewerがいるとは報告せず、コード／本番配置の独立レビュー方針とは別に決定します。

現在の実装の `approved:true` は配信対象の印であり、本人の明示同意を暗号的に証明しません。現台帳スキーマに本人同意の証跡検証は未実装です。将来どの方式を採用しても、本人同意が必要という要件を別に実装・検証する必要があります。

## 比較表

Aはコードと本番配置の統制、B/C/Dは記事台帳です。A単独ではprivate記事の配信承認台帳にならず、A+B、A+C、A+Dの組合せで考えます。安全性・運用負担の評価は以下の設計条件に基づく比較判断であり、各社が保証する順位ではありません。

| 基準 | A: public main保護＋Environment / Free | B: private保護ブランチ / Pro | C: Cloudflare D1台帳 | D: 暗号署名付きprivate台帳 |
|---|---|---|---|---|
| 安全性 | コードPRと本番配置を分離。publicに秘密・本文を置かない。GitHub管理者によるルール変更の信頼境界あり | privateの保護された台帳PRを信頼。管理者のルール変更や承認者配置に依存。本人同意は別の証跡が必要 | 本人の認証付き承認操作を直接表現できる。ただしAccessログインだけでは配信同意ではなく、DB管理者・承認API・Worker変更への統制が必要 | 本人の管理する鍵で承認内容を署名し、Workerが固定公開鍵で検証。GitHub書込み権限だけで承認を偽造しにくい。鍵流出・rollback・Cloudflare側改変は別対策 |
| 記事追加の自動化 | コードCI/deployの統制のみ。記事の自動承認はしない | 候補PR・固定SHA/ハッシュ生成を自動化し、本人同意とレビュー後に台帳取り込み。Cloudflare更新不要 | 候補登録・照合を自動化し、本人が確認画面で明示承認したものだけDB確定。毎回のSQL操作は不要にできる | 候補と署名対象を自動生成し、本人が確認・署名した承認を転送。Workerが署名検証。署名鍵をCIに置いて全件自動署名すると本人同意の意味を失う |
| 初期設定 | main保護・CODEOWNERS・有効な別reviewer・Environment main限定・監査読取りの設定 | Aに加えPro契約確認、private branch保護、CODEOWNERS、初期台帳と同意記録の設計 | Aに加えDB/schema/migration、承認UI/API、権限分離、CSRF/replay対策、監査、バックアップ。現状からの改修量は大 | Aに加え署名形式・鍵保管・公開鍵固定・鍵更新/失効・期限/世代管理と独立した復旧状態。現状から追加実装が必要 |
| 継続的な人の操作 | コードPRの独立レビューと本番Environment承認。記事ごとの操作とは別 | 毎記事の本人承認＋台帳PRレビュー/取り込み。UIやCLIで候補作成は軽減可能だが同意・必要レビューは残る | 毎記事の本人による確認・承認。独立レビューも必要なら別アカウントの二段階承認を設計 | 毎記事の本人による確認・署名。必要なら別reviewer/別署名を追加。鍵更新・復旧は追加負担 |
| 追加費用 | GitHub Freeでpublic保護とEnvironment required reviewersを利用可能。標準public Actionsは無料の範囲。Cloudflare等の既存費用は別 | 個人所有private repoの保護には有料Pro等が必要。現在の契約価格・税・割引はBillingで要確認。今回契約変更なし | D1 Free枠内ならDB追加利用料0。読取り500万行/日、書込み10万行/日、合計5GBが公式Free枠。Worker/Access等は別。Paid化時の基本料・超過利用料を別途考慮 | GitHub private保護機能を信頼根にしなければPro必須ではない。署名処理自体にGitHubの追加契約不要。端末/ハードウェア鍵・開発・復旧のコストはある |
| 障害時の復旧 | Git履歴とレビュー済みrevert。Environment/保護の障害は停止。監査token期限切れでも止まる | Git履歴から調査し、撤回も承認済みの新commitで反映。GitHub/App障害では停止。過去台帳への無条件復帰は撤回を復活させる | Time TravelはFree7日・Paid30日。復元後に撤回済み許可が復活しないか再照合し、fail-closedを維持。復元保持期間外は別exportが必要 | Gitで台帳復旧可能だが有効な古い署名の再提示を拒否する状態が必要。鍵紛失時は新鍵への信頼更新、流出時は失効と再承認。単なるGit revertでは復旧できない場合がある |

## A: GitHub Freeのpublicコード統制

public viewer repoのmain保護・必須PRレビューとEnvironment承認は、Freeで使える仕様です。ただしself-review禁止のEnvironmentには起動者とは別の承認者が必要です。Freeを選べば一人で独立承認できる、という意味ではありません。

public repoには記事本文・本人の認証メール・secret・private台帳を保存しません。記事slug/ハッシュも公開を許可されたメタデータとは限らないため、コードrepoに公開台帳を置いて代用しません。main保護とmain限定Environmentは外部設定であり、今回のコードのpushだけでは有効になりません。

## B: Proのprivate保護ブランチ台帳

既存の読取り・ハッシュ検証実装を最も再利用できます。本人が承認する対象とscopeの記録を、独立reviewerが台帳PRで確認する運用が自然です。本人がPR作者の場合は自己承認に頼らず、本人の別の明示同意記録と独立reviewを結び付けます。候補を自動生成しても配信対象への取り込みは自動承認しません。

個人所有private repoではProがprivateのrequired reviewers・protected branches・CODEOWNERSを提供するという公式仕様があります。現在はprivate rulesets APIがupgrade要求403を返しており、契約がすでに要件を満たすとは扱えません。Proにしても、private Environmentのrequired reviewersまで使えるとは限りません（Free/Pro/Teamではpublicのみ）。公開コードrepo側のEnvironmentとprivate台帳PRを分離します。

## C: D1の本人承認台帳

想定設計は、記事取得Workerとは別の承認経路にAccess認証と本人の明示操作を置き、固定commit・両書式ハッシュ・配信scope・承認ID・改訂番号・撤回状態をD1に記録するものです。画面は承認対象を表示し、意図したPOSTでのみ確定。ログイン、閲覧、候補追加やGitHub pushだけで配信許可しません。idempotency・CSRF対策・一回性・同意対象改変防止・入力検査・監査を設計する必要があります。

D1を追加するだけでは権限分離は成立しません。標準D1 bindingをSQLのread-only権限境界と仮定せず、閲覧経路を読取りサービスに限定する設計や署名承認レコード等を検討します。Cloudflare管理者はWorkerもDBも変更し得るため、管理者からの独立性はD1単独では得られません。

Free枠の上限到達は配信停止につながります。time-travelは便利ですが、復元は撤回を巻き戻し得るため、最新の撤回証跡と照合してから配信再開する設計が必要です。D1の作成・binding・schema・Access設定は今回行っていません。

## D: 本人署名付きprivate台帳

想定設計は、本人だけが保持する鍵で「このslug/commit/hash/scopeを配信する」という専用承認payloadを署名し、Workerは別経路で固定した公開鍵で検証します。Workers Web CryptoがEd25519等のsign/verifyを提供することは公式に確認しました。具体的なアルゴリズムと鍵保管方式は未選定です。

署名対象のバイト列/正規化、用途を識別するdomain、repo/Worker、本人の鍵ID、対象hash、期限、世代番号、撤回を含めてレビューする必要があります。署名鍵をGitHubや記事生成botに預けないことが重要です。公開鍵を同じ未保護台帳から無検証で受け取ってはいけません。

署名だけでは古い有効台帳のreplayを防げません。単調増加の世代や最新撤回を独立した永続状態へ記録し、期限やkey失効を検証する必要があります。その状態の保存先・復旧は別途設計が必要で、D1等を併用する可能性もあります。

GitHubのcommit/tag「Verified」は署名元の検証であって、本人が納品配信を許可した証拠とは限りません。GitHubは鍵失効後も過去のVerifiedを保持する仕様なので、それだけで現在の配信可否や鍵失効を判断しません。本人の専用署名はGitHub上の独立reviewer承認とは別であり、後者も必要なら別に要求します。Cloudflare管理者が検証コードや公開鍵を変更できる信頼境界は残ります。

## 判断の目安（今回方式は変更しない）

- publicコード統制Aは、B/C/Dのいずれでも共通基盤にできます。現在のmain未保護は別途解決が必要です。
- 既存実装の再利用と復旧の分かりやすさを優先し、実在の独立reviewerを確保できるならA+Bが最短です。ただしPro契約だけで本人の明示同意の要件は完了しません。
- 本人が毎回画面で一回承認する運用を重視するならA+Cが候補ですが、承認サービスの新規開発とCloudflareへの信頼集中が増えます。
- Proに依存せず、本人の承認をGitHub書込み権限から分離したいならA+Dが候補です。ただし鍵管理・replay/撤回・復旧の設計が必要で、単純な署名追加だけで完成とはしません。

本人の明示同意は自動化で取り除かない境界です。独立reviewerを記事ごとに必須とするかは別の運用判断であり、GitHubの機能制約から勝手に要件化しません。いずれの方式も、今回の記事配信許可はありません。

## 公式資料（確認日2026-11-17）

- GitHub Free/Proの提供機能: https://docs.github.com/en/get-started/learning-about-github/githubs-plans
- 保護ブランチと必須reviewer: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
- Environment reviewer・self-review禁止・public/privateの制限: https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments
- GitHub価格ページ（Teamの表示額を個人Pro価格と混同しない）: https://github.com/pricing
- D1価格・Free枠・制限到達時の動作: https://developers.cloudflare.com/d1/platform/pricing/
- D1 Time Travel: https://developers.cloudflare.com/d1/reference/time-travel/
- D1復旧保持期間のプラン差: https://developers.cloudflare.com/d1/platform/limits/
- Workers Web Crypto: https://developers.cloudflare.com/workers/runtime-apis/web-crypto/
- GitHub commit署名とVerifiedの保持: https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification
