# Claude Code Skillsets

[English](README.en.md)

하나의 목표를 검토 가능한 설치 판단으로 바꾸는 비공식 이중 언어 Decision Broker입니다.
마켓플레이스 목록이나 외부 스킬 번들 또는 안전성 인증이 아닙니다. 외부 스킬을 복사하거나
안전성을 보증하지 않고, 출처, 호환성, 검토 상태와 알려지지 않은 정보를 공개한 최소 계획을 제공합니다.
하나의 목표 또는 도메인에서 Anthropic 공식 Marketplace에 등재되고 source identity 근거가 있는
외부 upstream Claude 플러그인을 최대 두 개만 제안하고, 근거, 빈틈, `unknown`을 먼저 보여
줍니다. 외부 후보 설치는 별도 승인 뒤에만 가능하며, `0.1`에서는 후보 업데이트와 제거도
review-required hold입니다.

**기술 프리뷰:** 현재 0/20 실행 가능, 20/20 검토 대기·발견 전용입니다.
저장소 공개는 설치 실행 가능 제품 출시가 아닙니다.

이 저장소는 자체 broker/control skills인 `setup`, `doctor`, `maintain`,
`shared-core`를 소유합니다. 외부 목적·도메인 스킬은 제작하거나 복제하거나
번들하지 않습니다.

## Claude Code 빠른 시작

Claude Code와 Node.js `>=22`가 필요합니다. 다음 두 명령을 실행합니다.

```sh
claude plugin marketplace add seunghyeon1004/claude-code-skillsets --scope user
claude plugin install skillset-manager@claude-code-skillsets --scope user
```

`skillset-manager`는 같은 marketplace의 `shared-core`를 자동 dependency로 설치합니다.
예: `/skillset-manager:setup "소프트웨어 개발"`.

setup은 한 문장 목표를 결정 인덱스의 **제한된 인덱스 목표 문구**와 경계 일치시키며,
유일하게 해석되는 목표 또는 대분류 하나만 받습니다. 세부 카테고리를 추측하거나 여러
대분류를 묶어 설치하지 않습니다. 목표가 유일하게 일치하지 않으면 설치 후보를 추측하지
않고 대분류 선택으로 돌아갑니다. 설치 단위는 decision plan의 주력(`primary`) 하나와
필요한 경우 선택 보완(`optional complement`) 하나뿐입니다.

현재 실행 한계: v0.1: darwin + 정확한 Claude Code 2.1.198; 0/20 실행 가능, 20/20 검토 대기·발견 전용.
`2.1.198`은 이 릴리스가 검증한 정확한 계약이며 최신 버전이라는 뜻이 아닙니다. 현재 모든
도메인 경로는 검토 대기 상태이며 설치를 실행하지 않습니다. `related` 근거는 coverage를
만들지 않으며 설치를 허용하지 않습니다. 현재 경로별 후보, 상태, 미지원 수, 관찰 시각과 만료는
[생성된 경로 가용성 표](generated/catalog.ko.md#경로-가용성)를 확인합니다.

아래 20개 대분류와 카탈로그의 40개 `draft` 결과 팩은 분류 taxonomy와 향후
검토 backlog이며 지원 또는 실행 가능 범위가 아닙니다.

**20개 대분류:** `ai-agents-and-automation` · `business-operations` · `commerce` ·
`data-and-analytics` · `design-and-brand` · `devops-and-security` ·
`documents-and-knowledge` · `finance-and-accounting` · `legal-risk-and-compliance` ·
`marketing-and-growth` · `people-and-training` · `product-management` ·
`project-management` · `promotion-and-distribution` · `research-and-intelligence` ·
`sales-and-customer` · `software-engineering` · `strategy-and-decision` ·
`video-and-audio` · `writing-and-publishing`

카탈로그의 40개 결과 팩은 모두 `draft` 상태의 결과 팩이며 분류와 향후 검토를 위한
설계 데이터입니다. 현재 활성 설치 단위가 아닙니다. 다중 선택, 모호한 목표, 만료된
카탈로그, `linux`, `win32`는 보류됩니다.

각 후보의 permissions, license, trust, dependencies뿐 아니라 marketplace 인증 상태와
비용도 설치 전에는 `unknown`으로 공개합니다. 공식 등재는 개별 안전성 검토 완료나
인증/비용 부재의 증거가 아닙니다. 별도 최종 승인 뒤에만 정확한 Claude CLI 설치를 실행하고,
성공한 설치는 로컬 `state/install-lock.json` 영수증과 상태에 기록합니다.

## 프로젝트 원칙

- 기본 문서 언어: 한국어
- 보조 문서 언어: 영어
- 자체 코드와 스킬 라이선스: Apache-2.0
- 외부 스킬: 복사하지 않고 원본 마켓플레이스와 라이선스를 참조
- 수집 정책: 설치 통계나 사용자 설정을 기본 수집하지 않음

## Codex 빠른 시작

Codex 경로는 **결정과 발견 전용이며 실행하지 않습니다**. Node.js `>=22`가
필요하고 `gh` CLI는 필요하지 않습니다.

새 체크아웃에서는 다음을 순서대로 실행합니다.

```sh
git clone https://github.com/seunghyeon1004/claude-code-skillsets.git
cd claude-code-skillsets
npm ci
AS_OF="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
npm run broker -- decision-plan --runtime codex --platform darwin --as-of "$AS_OF" --goal "software development"
npm run broker -- domains
npm run broker -- runtime codex --limit 20
npm run broker -- review-queue
npm run broker -- recommend "software development" --limit 20
npm run broker -- provenance
```

이미 체크아웃한 저장소라면 해당 디렉터리에서 의존성을 다시 준비한 뒤 같은 broker
명령을 실행합니다.

```sh
cd /path/to/claude-code-skillsets
npm ci
```

- Codex `decision-plan`은 검증된 후보가 있을 때 최대 primary 한 개와 선택 complement
  한 개를 `preview-only` `$skill-installer` handoff로 반환합니다. 근거가 부족하거나
  만료되면 후보가 없는 held 응답을 반환합니다. `executionStatus: "not-executed"`는
  아무 명령도 실행하지 않았다는 뜻입니다.
- `domains`, `runtime codex`, `review-queue`, `recommend`, `provenance`는 현재 카탈로그의
  결정 근거와 발견 상태를 보여줍니다.
- `.codex` 경로 관찰은 호환성을 자동으로 보장하거나 설치 가능성을 뜻하지 않습니다.
  호환성 근거가 충분하지 않으면 Codex 계획은 held이며 설치 미리보기를 만들지 않습니다.

Codex에서는 이 broker가 설치, 업데이트, 마켓플레이스 변경을 실행하지 않습니다. eligible
handoff를 실제 `$skill-installer` 작업으로 넘기는 것은 broker 밖의 별도 사용자 승인
단계입니다. Claude Code 설치는 `/skillset-manager:setup` 안에서 별도로 승인합니다.

## 결정 상태

- `marketplace-listed`: 공식 마켓플레이스에 등재되었음을 뜻할 뿐, 개별 안전성 검토
  완료나 안전 보증을 뜻하지 않습니다.
- `eligible-with-disclosures`: 현재 런타임의 설치 근거가 있고 차단 또는 stale 검토가
  없지만, unknown 정보와 위험을 모두 공개한 뒤에만 승인 요청이 가능합니다.
- `held`: 검토 미완료, 호환성 미확인, 근거 부족 또는 만료 때문에 설명만 가능하며
  설치 계획에는 들어갈 수 없습니다.
- `blocked`: 기록된 차단 사유가 있으므로 추천과 설치가 모두 금지됩니다.
- `stale`: 이전 검토 근거가 현재 관찰과 맞지 않아 `held`로 처리되며, 새 검토가
  완료될 때까지 설치할 수 없습니다.

`unknown`은 안전한 것으로 추정하지 않습니다. permissions, license, trust,
dependencies, authentication, cost 중 하나라도 알 수 없으면 그대로 `unknown`으로 공개합니다.

## 런타임 상태 상세

상태 스키마 v2는 승인된 setup 실행을 `state/install-lock.json`의 독립적인 `runs`로
누적합니다. 이전 런의 승인, 상태, 영수증은 그대로 보존되며 전역
`(pluginName, marketplaceId, scope)`가 겹치지 않는 새 후보만 추가할 수 있습니다.
완전히 성공한 동일 승인 런의 재실행은 Claude 명령 없이 종료하며 durable install lock은
바꾸지 않습니다. 승인된 transient execution lock만 획득한 뒤 해제합니다. 검증된 v1
단일 런은 다음 비중복 런을 추가할 때 결정적으로 v2로 이관합니다. 부분 실패,
승인/인덱스 드리프트, 잘못된 구조, 중복 런 또는 중복 영수증은 Claude 명령 전에
중단합니다. 실패한 런의 자동 resume은 지원하지 않습니다.

동시에 실행된 setup은 anchored execution lock으로 하나만 진입하며, 상태 publisher는
rename 직전에 직전 canonical raw digest를 **expected-prior-digest stale check**로
확인합니다. 이는 execution lock을 무시하는 같은 사용자 외부 writer에 대한 atomic CAS가
아니며, check와 rename 사이의 경로 쓰기를 막는다고 주장하지 않습니다. 완료된 과거 런은
현재 카탈로그로 재계산하지 않고 plugin-owned digest history로 인증합니다. execution lock
해제도 삭제 직전 경로 identity를 재확인할 뿐 inode-bound unlink가 아니므로, 재확인 뒤
같은 사용자가 경로를 교체하는 잔여 한계가 있습니다. identity 불일치가 관찰되면 그 경로는
보존하고 doctor 검토로 중단합니다.

## 알려진 보류 후보

`shopify-ai-toolkit`은 현재 `held`이며 개별 privacy/telemetry 검토 전에는 어떤 설치
계획에도 포함되지 않습니다. pinned upstream README에서 다음 동작을 확인했습니다.

- telemetry는 기본 활성화되어 `https://shopify.dev/mcp/usage`로 전송됩니다.
- 전송 범주는 tool/skill/version, 제공된 model/client/version, 검색 query와
  response/error, validation 결과와 검증 코드/context, artifact/revision ID,
  최대 2,000자의 최근 사용자 prompt 원문, 제공된 session/tool ID, hook activation
  event입니다.
- `OPT_OUT_INSTRUMENTATION=true`로 opt out할 수 있지만, 이것이 개별 검토를
  완료시키거나 후보를 설치 가능하게 만들지는 않습니다.
- upstream 라이선스는 [MIT](https://raw.githubusercontent.com/Shopify/Shopify-AI-Toolkit/556811e94dd45c795abe5c0b1bf6b5a4b098149d/LICENSE)입니다.

저장소에는 Shopify README나 SKILL 원문을 복사하지 않습니다. pinned repository,
commit, path, immutable raw URL, content SHA-256으로 구성된 검증용 메타데이터만
보관합니다.

## 릴리스 기준

생성 산출물, TypeScript 검사, 평가, manifest 검증, Claude 플러그인 검증,
새 클론에서의 clean-copy 검증을 모두 통과해야 합니다. 설치 전에는 모든
환경 탐색과 명령을 공개하고, 사용자의 명시적 승인을 받습니다.

GitHub Free에서는 정확한 두 커밋 공개 이력으로 단계적 공개를 시작합니다. 승인된
clean tree로 부모가 없는 `A`를 만들고, 같은 tree의 자식 `B`를 만든 뒤 annotated
`public-history/root-v1` tag가 `A`를 가리키게 합니다. 기존 저장소는 비공개 archive로
보존하고 이 정확한 `A`/`B`/tag만 새 빈 비공개 저장소에 올립니다. 비공개 상태에서
`B`의 일반 CI와 public-history bootstrap이 통과하고 사용자가 최종 승인한 뒤에만
공개 전환합니다. 공개 전환 자체는 릴리스가 아니며 release tag, GitHub Release 또는
발표를 동반하지 않습니다.

공개 직후 정확한 `B`에서 `quality`와 `claude-plugin-validation`이 성공했는지 다시
확인하고 비공개 취약점 신고를 활성화·검증한 뒤 `main`을 보호합니다. `main`은 PR을
요구하지만 승인 수는 `0`이고 CODEOWNERS review를 요구하지 않습니다. 두 required
check는 GitHub Actions app ID `15368`에 결합합니다. 직접 push, force push, 브랜치
삭제를 차단하고 관리자에게도 규칙을 적용하며 사용자, 팀, app의 우회는 없습니다.
이 solo maintainer 구성은 쓰기 경로를 보호하지만 독립적인 사람의 검토를 보장하지
않습니다.

명시적 승인 뒤 clean local `main`의 정확한 `B`에서 로컬 구독 Claude CLI로 읽기 전용
동일한 SHA fixture suite를 실행합니다. 외부 후보를 설치하거나 GitHub를 변경하지 않으며,
sanitized 영수증만 릴리스 근거로 보존합니다. 이어 인증 없이 같은 SHA를 clone하고
marketplace 추가, manager 설치, 첫 setup preview를 검증합니다. 모든 단계가 통과한
뒤에만 release tag, GitHub Release와 발표가 가능합니다. 실패하면 tag나 발표 없이
비공개로 복귀하고 새 SHA로 처음부터 반복합니다. 이미 공개 중 내려받은 복사본은
회수할 수 없습니다. 전체 순서는
[GitHub Free 단계적 공개 런북](docs/release/github-free-staged-public.md)에 고정합니다.

`skillset-manager`는 `shared-core`를 같은 marketplace의 정적 dependency로 선언하고
작성자 소유 GitHub marketplace에서만 배포합니다. 현재는 `shared-core`만
Claude 플러그인 directory 제출 후보이며, 이 community가 참여하는 directory는 Claude
Code에서 공식 `claude-plugins-official` marketplace로 노출됩니다. 외부 작성자는 저장소
PR이 아니라 공식 in-app 또는 Console 폼으로 제출합니다. `skillset-manager`는 외부
플러그인의 행동 지침을 동적으로 설치하도록 지시하는 경계 때문에 정책 검토 보류
상태입니다. `shared-core`의 향후 등재가 manager의 등재, 승인 또는 보증을 뜻하지
않습니다. 제출 경계와 수동 약관 동의 gate는
[Claude 플러그인 디렉터리 제출 초안](docs/release/claude-directory-submission.md)에
고정합니다.

## 문서와 참여

- [승인된 Decision Broker 설계](docs/superpowers/specs/2026-07-29-decision-broker-v1-design.md)
- [Decision Broker 구현 계획](docs/superpowers/plans/2026-07-29-decision-broker-v1.md)
- [기여 가이드](CONTRIBUTING.md)
- [보안 신고 정책](SECURITY.md)
- [제3자 고지](THIRD_PARTY_NOTICES.md)
- [Apache-2.0 라이선스](LICENSE)

이 프로젝트는 Anthropic의 공식 제품이 아닌 독립 커뮤니티 프로젝트입니다.
