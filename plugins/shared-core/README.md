# Shared Core / 공용 코어

Shared Core provides the common workflow, verification, privacy, and evidence
skills used by this marketplace. 공용 코어는 이 마켓플레이스의 워크플로,
검증, 개인정보 보호, 근거 확인 스킬을 제공합니다.

## Install / 설치

```sh
claude plugin marketplace add seunghyeon1004/claude-code-skillsets --scope user
claude plugin install shared-core@claude-code-skillsets --scope user
```

## Use / 사용

Open a namespaced skill explicitly in Claude Code. Claude Code에서 이름공간이 붙은
스킬을 직접 엽니다.

## Skill Inventory / 스킬 목록

| Skill | Intended use / 사용 목적 |
| --- | --- |
| `intent-to-brief` | Turn a broad or fragmented request into a scoped brief. 넓거나 흩어진 요청을 범위가 정해진 brief로 바꿉니다. |
| `workspace-context` | Establish instructions, source-of-truth files, capabilities, and constraints in an unfamiliar workspace. 낯선 workspace의 지침, source of truth, 기능 및 제약을 확인합니다. |
| `workflow-router` | Separate overlapping workstreams inside one defined request. 하나의 정해진 요청 안에서 겹치는 workstream을 분리합니다. |
| `plan-and-checkpoints` | Order dependent work and place explicit stop/go gates around risky or external actions. 의존 작업의 순서를 정하고 위험하거나 외부에 영향을 주는 행동에 중단·진행 gate를 둡니다. |
| `risk-privacy-permissions` | Review data flow, permissions, cost, reversibility, and the exact approval point. 데이터 흐름, 권한, 비용, 되돌리기 가능성 및 정확한 승인 지점을 검토합니다. |
| `evidence-provenance` | Record source, date, verification state, and reuse rights for claims and assets. 주장과 asset의 출처, 날짜, 검증 상태 및 재사용 권리를 기록합니다. |
| `quality-verification` | Map each completion claim to fresh, domain-appropriate evidence. 각 완료 주장을 최신의 도메인별 근거에 연결합니다. |
| `handoff-continuity` | Leave a durable restart point when work or ownership changes. 작업이나 담당자가 바뀔 때 다시 시작할 수 있는 durable handoff를 남깁니다. |

## Working Examples / 실제 사용 예시

```text
/shared-core:intent-to-brief Turn this broad repository request into a brief that labels confirmed facts, assumptions, open questions, and completion evidence.

/shared-core:risk-privacy-permissions Review this planned support-log disclosure, minimize personal data and permissions, and identify the exact approval point.

/shared-core:quality-verification Build a verification matrix for this release and distinguish fresh evidence from unverified claims.
```

```text
/shared-core:intent-to-brief 이 넓은 저장소 요청을 확인된 사실, 가정, 열린 질문, 완료 근거로 구분한 brief로 바꿔줘.

/shared-core:risk-privacy-permissions 이 지원 로그 공개 계획의 개인정보와 권한을 최소화하고 정확한 승인 지점을 정해줘.

/shared-core:quality-verification 이 릴리스의 검증 matrix를 만들고 최신 근거와 미검증 주장을 구분해줘.
```

## Troubleshooting / 문제 해결

- If a namespaced skill is missing after installation, run `/reload-plugins`, then
  open `/plugin` and inspect the Installed and Errors views for `shared-core`.
  설치 후 이름공간 스킬이 보이지 않으면 `/reload-plugins`를 실행하고 `/plugin`의
  Installed 및 Errors 화면에서 `shared-core`를 확인하세요.
- Always invoke the full `/shared-core:<skill-name>` name. A similarly named
  standalone skill is a different component. 항상 전체
  `/shared-core:<skill-name>` 이름을 사용하세요. 이름이 비슷한 standalone skill은
  다른 구성요소입니다.
- For a reproducible packaging, loading, namespacing, documentation, or instruction
  problem, follow [SUPPORT.md](SUPPORT.md). Review [PRIVACY.md](PRIVACY.md) before
  sharing diagnostics. 재현 가능한 패키징, 로딩, 이름공간, 문서 또는 지침 문제는
  [SUPPORT.md](SUPPORT.md)를 따르고 진단 자료를 공유하기 전에
  [PRIVACY.md](PRIVACY.md)를 확인하세요.

## Safety Boundary / 안전 경계

This package does not add marketplaces or install, update, or remove external
plugins. 이 패키지는 마켓플레이스를 추가하거나 외부 플러그인을 설치, 업데이트,
삭제하지 않습니다. A Shared Core workflow may plan later tool use, but selection,
approval, execution, and provider policy remain separate. 공용 코어 workflow가 이후
도구 사용을 계획할 수는 있지만 선택, 승인, 실행 및 공급자 정책은 별도입니다.
