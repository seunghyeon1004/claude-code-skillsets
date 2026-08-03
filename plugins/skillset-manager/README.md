# Skillset Manager / 스킬셋 관리자

Skillset Manager recommends external Claude plugins with official marketplace-listing
and source-identity evidence; individual plugin safety review is incomplete. It is a
broker, not a copied-skill bundle or a safety guarantee. Only after separate approval
does it run the exact previewed Claude CLI install, then records verified successful
installs in local receipts and state. 스킬셋 관리자는 제한된 결정 인덱스에서 공식
Marketplace 등재와 source identity 근거가 있는 외부 Claude 플러그인을 추천하지만 개별
플러그인 안전성 검토는 완료되지 않았습니다. 자체 스킬 묶음이나 안전 보증이 아니며,
별도 승인 뒤에만 미리보기의 정확한 Claude CLI 설치를 실행하고 검증된 성공 설치를 로컬
영수증과 상태에 기록합니다.

v0.1 limitation: darwin and exactly Claude Code 2.1.198; 0/20 routes executable, 20/20 review-held discovery-only.
v0.1 제한: darwin 및 정확한 Claude Code 2.1.198; 0/20 실행 가능, 20/20 검토 대기·발견 전용.

## Install / 설치

```sh
claude plugin marketplace add seunghyeon1004/claude-code-skillsets --scope user
claude plugin install skillset-manager@claude-code-skillsets --scope user
```

`shared-core` is resolved automatically from this same marketplace. `shared-core`는
같은 마켓플레이스에서 자동으로 해석됩니다.

## Use / 사용

Open `/skillset-manager:setup` for a consent-based recommendation and setup
preview, or `/skillset-manager:doctor` for a health check. Because all 20 current
routes are review-held, setup currently returns a held preview with no candidates
and does not enter the risk-acknowledgement, approval, or execution phases. Only a
future eligible route can expose at most two official candidates together with
coverage gaps, authentication `unknown`, and cost `unknown`; it then requires risk
acknowledgement and separate final approval. 동의 기반 추천 및 설정 미리보기는
`/skillset-manager:setup`, 상태 점검은 `/skillset-manager:doctor`를 사용합니다. 현재
20개 경로가 모두 검토 대기 상태이므로 setup은 후보가 없는 held 미리보기를 반환하고
위험 확인, 승인 또는 실행 단계로 진입하지 않습니다. 향후 eligible 경로에서만 최대 두
개의 공식 후보와 coverage gap, authentication `unknown`, cost `unknown`을 공개하며,
그때 위험 확인과 별도 최종 승인을 요구합니다.

With current probe consent, preview resolves the Claude executable to one
canonical absolute regular-file path, records its SHA-256, and accepts exactly
Claude Code `2.1.198`. That version is this release's tested contract, not a
"latest" claim. The complete identity is visible and approval-bound before final
approval. Every approved candidate phase reverifies the same realpath, hash, and
version and executes only that absolute path; it never resolves execution through
`PATH`. 현재 probe 동의 뒤 미리보기는 Claude 실행 파일을 canonical 절대경로로
해석하고 SHA-256과 정확한 Claude Code `2.1.198` 계약을 기록합니다. 이는 최신 버전
주장이 아닙니다. 최종 승인 전에 전체 신원을 공개하고 승인에 묶으며, 승인 뒤 각 후보
단계 직전에 같은 realpath, hash, version을 재검증하고 그 절대경로만 실행합니다.

## Safety Boundary / 안전 경계

The manager can prepare recommendations and previews, but it must not add a
marketplace or install, update, or remove a candidate without separate explicit
user approval. Successful approved installation is recorded only in local
`state/install-lock.json`; no installation statistics are collected by default.
관리자는 추천과 미리보기를 만들 수 있지만, 별도의 명시적 사용자 승인 없이는
마켓플레이스를 추가하거나 후보를 설치, 업데이트, 삭제해서는 안 됩니다. 승인된 성공
설치만 로컬 `state/install-lock.json`에 기록하며 설치 통계는 기본 수집하지 않습니다.

## First Public Bootstrap / 최초 공개 부트스트랩

The first public release uses a bare same-marketplace `shared-core` dependency.
Add a version range only after a valid `shared-core--v0.1.0` tag exists; the
first installation must not require that tag. 최초 공개본은 같은 마켓플레이스의
`shared-core` 이름만 선언하며, 유효한 `shared-core--v0.1.0` 태그가 생긴 뒤에만
버전 범위를 추가합니다. 최초 설치에는 그 태그가 필요하지 않습니다.
