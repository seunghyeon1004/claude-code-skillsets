# Decision Broker v1 설계

- 상태: 승인됨
- 승인일: 2026-07-29
- 프로젝트: `claude-code-skillsets`
- 기본 언어: 한국어
- 보조 언어: 영어
- 기준: 비공개 개발 기준선은 공개 이력에 포함하지 않는다.

## 1. 배경

현재 저장소는 20개 업무 대분류, 15개 고정 시장조사 스냅샷, 공식 Claude
마켓플레이스 기준선, 비공식 소스 검토 대기열, 설치 전 명령 공개와 승인을
갖춘다. 그러나 사용자 목표에서 실제 설치 계획으로 이어지는 경로는 두 갈래로
분리되어 있다.

- `recommend`는 키워드로 대분류와 미검토 후보를 찾지만 설치할 수 없다.
- Claude Code setup은 선택한 대분류마다 정적으로 고른 공식 후보 두 개를
  제안하며 사용자의 구체적인 목표를 반영하지 않는다.

검토 대기열도 고정 스냅샷의 최신 포인터일 뿐, 검토 결정이나 변경 위험을
기록하지 않는다. 공식 기준선과 비공식 소스의 새 상태를 정기적으로 관찰하는
자동화도 없다. 따라서 현재 제품은 투명한 카탈로그 기반이지만, 시장에서
차별화할 목적 기반 의사결정 브로커는 아니다.

## 2. 목표

1. 사용자가 자유 형식 목표를 적거나 20개 대분류만 선택하게 한다.
2. 세부 카테고리 질문 없이 주력 한 개와 필요한 경우 보완 한 개만 추천한다.
3. 추천 근거, 출처, 호환성, 검토 상태, 변경 위험, 알려지지 않은 정보를 함께
   보여준다.
4. 공식 등재와 개별 안전 검토를 분리하고, `unknown`을 안전으로 해석하지 않는다.
5. 비공식 소스의 관찰 데이터와 사람의 검토 결정을 분리해 보존한다.
6. 새 관찰이 기존 검토 근거를 무효화하면 추천과 설치를 자동 보류한다.
7. 매주 한 번 시장 변화를 조사하고 사람이 검토할 PR만 만든다.
8. Claude Code의 설치, 업데이트, 제거는 전체 미리보기와 별도 승인 뒤에만
   실행한다.
9. Codex는 같은 목적 추천 계약을 사용하되 호환성 근거가 부족하면 설치
   미리보기를 만들지 않는다.
10. 공개 문서와 RC 평가가 실제 첫 사용자 여정을 검증하게 한다.

## 3. 비목표

- 외부 스킬 코드를 이 저장소에 복사하거나 재배포하지 않는다.
- 자체 도메인 스킬을 새로 제작하지 않는다.
- 인기 순위, 사용자 추적, 평점 서비스를 만들지 않는다.
- 정적 분석만으로 외부 스킬이 안전하다고 보증하지 않는다.
- 주간 조사 결과를 자동 병합하거나 자동 설치하지 않는다.
- Codex에서 호환성이 관찰되지 않은 Claude 플러그인 명령을 실행하지 않는다.
- 첫 릴리스에서 웹 마켓플레이스나 데스크톱 관리 앱을 만들지 않는다.

## 4. 검토한 접근법

### 4.1 문구만 좁히기

현재 구현을 투명한 공식 마켓플레이스 큐레이터로 소개한다. 빠르지만 목적 기반
추천, 변경 추적, 유지관리라는 차별점을 구현하지 못한다.

### 4.2 목적 기반 의사결정 브로커 v1

현재 provenance와 승인 경계를 유지하면서 추천 계획, 검토 원장, 변경 diff,
주간 PR, 유지관리 흐름을 연결한다. 기존 연구 자산을 재사용하면서 제품 약속과
동작을 일치시키므로 이 방식을 선택한다.

### 4.3 전체 통합 마켓플레이스

보안 스캐너, 사용자 평점, 웹 UI, 모든 런타임 설치를 한 번에 구축한다. 기존
대형 디렉터리와 정면 경쟁하고 검증 범위가 지나치게 커서 선택하지 않는다.

## 5. 제품 계약

제품은 외부 스킬의 제작자나 안전 보증자가 아니라 다음 결정을 돕는 중계자다.

> 사용자의 목표에 필요한 최소 후보를 여러 출처에서 찾고, 설치 가능한 근거와
> 불확실성 및 변경 위험을 설명한 뒤, 사용자 승인에 묶인 실행 계획을 만든다.

`safe`, `trusted`, `verified`는 해당 상태를 입증하는 검토 결정이 있을 때만
사용한다. 공식 마켓플레이스 등재는 `marketplace-listed`이며 개별 안전 검토
완료가 아니다.

## 6. 첫 사용자 여정

### 6.1 입력

사용자는 다음 중 하나를 제공한다.

- 자유 형식 목표 한 문장
- 20개 대분류 중 하나 이상

목표가 한 대분류에 충분히 일치하면 자동 선택한다. 동점이거나 강한 근거가
없으면 최대 세 개 대분류만 보여주고 한 번 선택받는다. 카테고리, 도구, 숙련도,
설치 수준을 연속 질문하지 않는다. 환경 탐지는 추천 선택과 별도 동의 단계다.

한 실행에서 계획에 반영할 대분류는 최대 두 개이며 사용자가 고른 순서가
우선순위다. 세 개 이상을 선택하면 후보를 만들기 전에 상위 두 개를 순서대로
고르게 한다. 이는 세부 카테고리 질문이 아니라 설치 상한을 지키기 위한 한 번의
대분류 우선순위 선택이다.

### 6.2 추천 계획

추천 계획은 최대 두 항목이다.

- `primary`: 목표를 직접 완수하는 후보 한 개
- `complement`: primary가 제공하지 않는 필수 능력을 보완하는 후보 최대 한 개

complement는 별도의 능력 근거와 필요한 이유가 없으면 생략한다. 같은 플러그인,
같은 기능, 같은 설치 명령은 중복 제거한다. 두 개를 초과하는 후보는 탐색 결과로
남길 수 있지만 기본 설치 계획에는 들어가지 않는다.

intent profile은 `coreCapabilityId`와 1-3개의 `requiredCapabilityIds`를 갖는다.
후보는 사람이 검토한 `providedCapabilityIds`와 각 capability의 근거인
`evidenceIds`를 갖는다. evidence는 현재 관찰의 설명, manifest 또는 skill path와
content hash를 가리켜야 하며 이름이 비슷하다는 이유만으로 capability를 부여하지
않는다.

단일 대분류에서는 core capability를 제공하는 eligible 후보 중 필수 capability를
가장 많이 덮는 항목이 primary다. primary가 모든 필수 capability를 덮으면
complement는 없다. 미충족 capability가 있으면 그 집합에 새로운 coverage를 가장
많이 추가하는 eligible 후보 한 개만 complement가 될 수 있다. 두 후보로도 모든
필수 capability를 덮지 못하면 `coverageIncomplete: true`와 미충족 ID를 표시하고
설치 계획 전체를 held로 둔다.

두 대분류에서는 각 대분류의 core capability를 단독으로 제공하는 primary 한 개씩,
총 두 개만 선택한다. 동일 후보가 두 core를 모두 제공하면 한 개로 중복 제거할 수
있다. 선택된 후보 coverage의 합집합이 두 profile의 core와 required capability
전체를 충족해야 한다. 어느 하나라도 충족하지 못하면 `coverageIncomplete: true`와
대분류별 미충족 ID를 표시하고 전체 결합 계획을 held로 둔 뒤 사용자가 한 대분류만
다시 선택할 수 있게 한다. 코드 포인트 순서는 동점 안정화에만 쓰며 대분류를 버리는
기준으로 사용하지 않는다.

### 6.3 추천 적격 상태

각 후보의 결정 상태는 다음 셋 중 하나다.

- `eligible-with-disclosures`: 현재 런타임에서 설치 경로가 있고, 차단 결정이나
  stale 검토가 없으며, 알려지지 않은 위험을 전부 공개한 뒤 승인 요청이 가능함
- `held`: 검토 미완료, 호환성 미확인, 검토 만료, 소스 변경 또는 근거 부족으로
  추천 설명만 가능하고 설치 계획에는 들어갈 수 없음
- `blocked`: 악성 행위, 라이선스 충돌, 소유권 충돌, 금지된 실행 표면 또는
  검토자가 기록한 차단 사유 때문에 추천과 설치가 금지됨

`eligible-with-disclosures`는 안전 보증이 아니다. permissions, license, trust,
dependencies 중 하나라도 알 수 없으면 미리보기에서 그대로 `unknown`으로
표시한다.

상태 판정 우선순위는 다음과 같으며 먼저 일치한 행이 최종 상태다.

| 우선순위 | 조건 | 상태 |
| --- | --- | --- |
| 1 | source 또는 exact path의 유효 blocked 결정 | `blocked` |
| 2 | 적용할 결정이 stale이거나 catalog freshness가 만료됨 | `held` |
| 3 | 대상 runtime이 incompatible, unknown 또는 단순 path-observed임 | `held` |
| 4 | 비공식 exact path에 approved 결정이 없거나 민감 필드가 unknown | `held` |
| 5 | Claude Code의 위임된 공식 listing이고 설치 경로가 있으며 1-3에 해당하지 않음 | `eligible-with-disclosures` |
| 6 | 비공식 exact path가 approved이고 runtime verified이며 모든 필수 근거가 현재 관찰과 일치 | `eligible-with-disclosures` |
| 7 | 그 밖의 모든 경우 | `held` |

따라서 unknown runtime compatibility는 eligible이 아니다. 공식 Claude listing의
예외는 unknown license·permissions·trust·dependencies만 허용하며, runtime과
marketplace identity는 확인되어야 한다. 공식 listing도 safety review 완료라고
표현하지 않는다. Codex에는 이 공식 예외를 적용하지 않는다.

## 7. 추천 엔진

### 7.1 두 단계 해석

1. 목표를 검토된 한국어·영어 표현으로 최대 세 개 대분류에 연결한다.
2. 선택된 대분류의 후보를 목표 관련성, 런타임 적격성, 검토 상태, 변경 상태로
   평가한다.

단순 파일 경로 토큰 일치는 관련성 근거일 뿐 적격성 근거가 아니다. 최종 계획은
미검토 커뮤니티 후보보다 설치 경로가 있는 공식 등재 후보를 우선하지만, 공식
후보도 `individualSafetyReview: not-complete`를 유지한다.

설치된 setup이 동적으로 수행하는 일은 goal을 검토된 intent profile 또는
대분류에 연결하는 것뿐이다. 각 intent profile은 정규화된 한국어·영어 phrase,
domain ID, core와 required capability, 미리 계산된 primary와 선택적 complement를
갖는다. 후보 plan은 capability coverage와 evidence를 생성 시 검증한다. setup은 phrase를
NFKC, 소문자, 문장부호 제거, 공백 축약 순서로 정규화하고 가장 긴 phrase 일치를
사용한다. 같은 길이의 서로 다른 profile이 맞으면 최대 세 대분류 선택으로
fail-close한다. 후보 적격 판정과 정렬은 setup이 재계산하지 않고 생성된 plan을
읽는다.

### 7.2 점수와 fail-closed 규칙

eligible 후보의 정렬 점수는 다음 순서의 안정적인 튜플이다.

1. core capability 제공 여부
2. 아직 충족하지 못한 required capability coverage 수
3. 런타임 호환성 근거의 최신성
4. 목표의 강한 표현 일치 수
5. 목표와 후보 이름·설명의 공통 표현 수
6. 검토 결정의 최신성
7. 플러그인 이름과 소스 ID의 코드 포인트 순서

점수는 안전성을 생성하지 않는다. eligible 후보가 없으면 빈 설치 계획과 held
후보의 이유를 반환한다. 동점인 complement를 임의로 추가하지 않는다.

### 7.3 응답 계약

새 `decision-plan` 응답은 다음 필드를 포함한다.

- 원문 목표, 선택된 대분류, 해석 근거
- primary와 선택적 complement
- core 및 required capability, 후보별 coverage evidence, 미충족 capability
- 각 항목의 역할, 적격 상태, 목표 근거, 출처, 런타임 근거
- 검토 결정 ID 또는 `not-reviewed`
- 변경 상태와 기준/현재 커밋
- permissions, license, trust, dependencies
- 실행 가능 여부와 실행 불가 사유
- provenance digest

기존 `recommend`는 발견 전용 응답으로 유지하되 `decision-plan`을 기본 사용자
경로로 문서화한다.

생성기는 동일한 계약을 `generated/decision-index.json`과
`plugins/skillset-manager/data/decision-index.json`에 바이트 단위로 동일하게
기록한다. 인덱스에는 20개 대분류의 검토된 한국어·영어 표현, 현재 후보 상태,
안정적 정렬 입력과 provenance digest가 포함된다. 모든 profile의 normalized
phrase와 경계·동점 fixture도 같은 인덱스에서 생성한다. 설치된 setup은 외부
저장소 checkout을 요구하지 않고 plugin-owned decision index를 한 번 읽어 위의
bounded phrase 규칙과 미리 계산된 plan만 사용한다. broker CLI와 setup semantic
evaluation이 전체 generated fixture corpus에서 다르면 release gate를 실패시킨다.

인덱스에는 `catalogVersion`, `observedThrough`, `catalogExpiresAt`을 넣는다.
`catalogExpiresAt`은 주간 관찰 시각에서 9일 뒤다. setup은 미리 공개하고 동의를
받은 `date -u +%Y-%m-%dT%H:%M:%SZ`로 현재 UTC를 확인한다. 동의가 없거나 시간이
만료되었으면 모든 설치를 held로 두고 marketplace refresh와 plugin reload 안내만
제공한다. 승인은 로컬 index digest와 만료시각에 묶인다. 새 원격 관찰을 즉시 안다고
주장하지 않으며, 보장은 설치된 카탈로그 버전과 최대 9일 freshness 범위로 한정한다.

## 8. 관찰 데이터와 검토 원장

### 8.1 생성 관찰 데이터

GitHub 수집 결과는 기존처럼 불변 스냅샷과 receipt로 저장한다. 생성된 source
observation projection은 최신 및 직전 스냅샷, 커밋, 콘텐츠 해시, 대표 경로,
잠정 대분류, 변경 요약을 포함한다. 생성 파일은 사람이 직접 수정하지 않는다.

모든 수집 entry는 Git tree의 blob SHA, byte size와 path를 보존한다. manifest,
license, lockfile, script, hook, MCP 설정과 SKILL.md는 파일당 256 KiB, source당
총 4 MiB 한도에서 raw blob을 읽어 content SHA-256을 계산한다. 한도를 넘거나 blob을
읽지 못하면 해당 관찰은 `unknown`이며 이전과 같은 path라는 이유로 unchanged라
판정하지 않는다.

license, permissions, ownership, dependencies와 executable surface는 각각
`observed`, `unknown`, `not-applicable` 상태와 근거 경로 및 근거 파일 SHA-256으로
정규화한다. manifest, lockfile, script, hook, MCP 설정처럼 수집된 파일에서 직접
확인한 값만 `observed`다. 설명문 추론이나 파일 부재는 `unknown`이며, 이전과 현재
중 하나라도 `unknown`이면 해당 필드의 diff도 `unknown`이다. 비공식 후보의 민감
필드가 `unknown`이면 approved decision만으로 eligible이 되지 않고 held를 유지한다.
위임된 공식 listing 경로만 기존 계약대로 unknown을 전부 공개한
`eligible-with-disclosures`가 될 수 있다.

### 8.2 append-only 검토 결정

사람의 판단은 관찰 projection과 다른 append-only JSONL 원장에 기록한다. 각
결정은 다음을 포함한다.

- 1부터 연속 증가하는 sequence와 고유 decision ID
- 직전 줄의 event hash인 `previousEventHash`; 첫 줄은 null
- source ID와 선택적 skill path
- 기준 snapshot ID, commit, content SHA-256
- `approved`, `held`, `blocked` 중 하나의 disposition
- reason code와 한국어·영어 설명
- 확인한 license, permissions, trust, dependencies
- Claude Code와 Codex 호환성 상태 및 근거
- reviewer ID, reviewedAt, expiresAt
- 대체하는 이전 decision ID 또는 null
- 현재 줄의 `eventHash`

JSONL의 각 줄은 객체 키를 코드 포인트 순으로 재귀 정렬하고, 배열 순서를
보존하며, 공백 없이 UTF-8 JSON과 LF 하나로 직렬화한다. `eventHash`는 해당 필드를
제외한 canonical object의 SHA-256이다. 과거 줄은 변경하거나 삭제하지 않는다.
새 결정은 이전 결정을 참조해 대체한다.

PR CI는 원장이 PR base SHA의 원장과 바이트 단위로 같은 prefix인지 확인하고 새
줄만 허용한다. main push CI는 `github.event.before`의 원장을 기준으로 같은 검사를
한다. hash chain, 연속 sequence, 스키마, 참조 무결성, 시간 순서도 함께 검증한다.
base를 읽을 수 없으면 append-only 검증을 건너뛰지 않고 실패한다.

`governance/reviewers.json`은 reviewer ID와 `source-reviewer`,
`security-reviewer`, `maintainer` 역할을 관리하며 CODEOWNERS 대상이다. held는 세
역할 모두 기록할 수 있고 approved와 blocked 및 blocked 해제는
`security-reviewer` 또는 `maintainer`만 기록할 수 있다. CI는 ledger의 reviewer가
allowlist에 있고 해당 disposition 권한이 있는지 검증한다.

ledger를 추가하는 PR의 권한 검증은 head가 아니라 PR base SHA의
`governance/reviewers.json`만 사용한다. reviewers 파일을 바꾸는 PR은 ledger,
observation, materialized review state를 함께 바꿀 수 없고, 변경된 권한은 merge
후 별도 PR부터 유효하다. main에는 required CI와 required CODEOWNERS review를
적용하며 직접 push, force push, 브랜치 삭제를 금지한다. 이 branch protection을
확인하지 못하면 approved나 blocked ledger PR의 release gate를 통과시키지 않는다.

결정 대상은 source 전체 또는 정확한 skill path다. approved는 exact skill path
대상에만 허용한다. source-level 결정은 held 또는 blocked만 허용하며 provenance와
전체 source 차단에 사용한다. 같은 대상의 첫 결정은
`supersedes: null`, 이후 결정은 현재 유일한 leaf decision ID를 참조해야 한다.
동일 대상을 가리키는 leaf가 두 개면 전체 materialization을 실패시킨다. source
blocked는 모든 하위 path를 차단하며 path approved로 우회할 수 없다. 그 밖에는
정확한 path 결정이 source 결정에 우선하고, path 결정이 없으면 source 결정을
상속한다.

materialization 함수는 wall clock을 직접 읽지 않고 명시적 `asOf` UTC 시각을
입력받는다. 생성물은 workflow의 고정 observedAt을, setup freshness 검사는 동의받은
UTC probe 값을 사용한다. 동일 ledger, observation과 asOf는 항상 같은 상태를 만든다.

### 8.3 materialized review state

현재 검토 상태는 관찰 projection과 원장을 결합해 생성한다. 다음 상황에서는
기존 approved 결정을 자동으로 `stale`로 만들어 `held`로 내린다.

- source-level 결정의 inspected commit 변경
- exact-path 결정의 path blob, manifest chain 또는 상속한 민감 evidence digest 변경
- license, permissions, ownership, executable surface 변경
- expiresAt 경과
- 기준 스냅샷이나 결정 참조 불일치

stale 결정은 삭제하지 않고 원인과 무효화된 decision ID를 노출한다.

결정적 상태 전이는 다음과 같다.

| 현재 유효 결정 | 현재 관찰 | materialized 상태 | 다음 허용 결정 |
| --- | --- | --- | --- |
| 없음 | 모든 상태 | `held/not-reviewed` | held, approved, blocked |
| held | 같은 기준 | `held` | held, approved, blocked |
| held | 변경 또는 만료 | `held/stale-evidence` | 현재 관찰 기준의 새 결정 |
| approved | 같은 기준, 필수 근거 충족 | `approved` | held, approved, blocked |
| approved | 변경, 만료 또는 근거 손실 | `held/stale` | 현재 관찰 기준의 새 결정 |
| blocked | 모든 상태 | `blocked` | 같은 scope의 authorized held, approved, blocked |

`stale`은 원장 event가 아니라 파생 상태다. source 결정은 source 전체의 commit이
바뀌면 stale된다. exact-path 결정은 repository commit만 바뀌었더라도 해당 path의
blob SHA, path가 의존하는 manifest chain, ownership와 상속한 source 민감 evidence
digest가 모두 같으면 유효성을 유지한다. 이때 새 commit은 변경 고지에 남긴다.
이 중 하나가 바뀌거나 unknown이 되면 exact-path 결정을 stale로 내린다. blocked는
만료로 자동 해제되지 않으며 권한 있는 같은 scope의 새 결정만 해제할 수 있다.

## 9. 변경 diff

소스별 최신 두 관찰을 비교해 다음을 생성한다.

- 추가·삭제된 skill path
- 변경된 marketplace/plugin manifest 주소
- source URL 또는 소유 저장소 변경
- license, permissions, dependencies, executable surface의 알려진 변경
- 잠정 대분류 변화
- 콘텐츠 해시와 커밋 변화

첫 관찰은 `baseline`; 동일하면 `unchanged`; 차이가 있으면 `changed`; 비교에 필요한
직접 관찰 근거가 없으면 `unknown`이다. 단순 파일 추가·삭제와 콘텐츠 해시는
스냅샷 entry 집합으로 비교한다. 민감 필드는 8.1의 정규화된 상태와 evidence hash가
양쪽 모두 `observed`일 때만 동일·변경을 판정한다. 민감 필드 변화는 기존 update
policy를 호출해 `review` 또는 `block`을 결정하며 자동 적용하지 않는다.

## 10. 주간 시장조사

GitHub Actions는 매주 월요일 09:17 KST와 수동 `workflow_dispatch`에서 실행한다.
cron 표현은 UTC 기준 `17 0 * * 1`이다.

작업 순서:

1. Node.js 22와 고정 lockfile로 의존성을 설치한다.
2. 모든 source config와 공식 마켓플레이스의 현재 commit을 관찰한다.
3. repository 밖의 임시 staging 디렉터리에 모든 source의 snapshot과 receipt를
   수집한다. 하나라도 실패하면 staging 전체를 폐기한다.
4. staging에서 observation, diff, review state와 카탈로그를 재생성하고 전체
   검증을 실행한다.
5. 시작할 때 기록한 base commit과 catalog digest가 원격 main과 여전히 같은지
   확인한다. 다르면 결과를 게시하지 않고 실패한다.
6. 검증된 파일 집합을 한 번에 worktree로 옮기고 다시 generated diff와 전체
   검증을 실행한다.
7. 변경이 있을 때만
   `automation/catalog-refresh-<baseDigest8>-<githubRunId>` 새 브랜치와 검토 PR을
   만든다.

워크플로는 플러그인을 설치·업데이트·제거하지 않고 PR을 자동 병합하지 않는다.
실패하면 기존 기준선을 변경하지 않고 job을 실패시킨다. GitHub token은 저장소
contents와 pull request 생성에 필요한 최소 권한만 사용한다.

workflow concurrency group은 저장소별 `catalog-refresh`이고
`cancel-in-progress: false`다. 브랜치는 항상 새로 만들고 force-push하지 않는다.
같은 base digest와 결과 digest의 열린 PR이 있으면 새 브랜치나 PR을 만들지 않고
기존 PR을 가리키는 no-op receipt로 끝낸다. cron과 수동 실행이 겹쳐도 서로의
staging이나 브랜치를 재사용하지 않는다.

workflow top-level 권한은 `contents: write`와 `pull-requests: write`만 명시하고
나머지는 `none`이다. 모든 외부 action은 full commit SHA로 고정한다. branch push와
PR 생성은 base-prefix ledger 검증과 전체 release gate가 성공한 뒤의 마지막 단계다.

## 11. Claude Code 흐름

setup은 목표 한 문장 또는 대분류 선택을 받아 decision plan을 읽는다. 사용자가
목표 없이 대분류만 골라도 최대 두 후보 규칙을 지킨다.

설치 전에 다음을 한 번에 보여준다.

- primary와 complement 역할 및 선택 이유
- 모든 적격·검토·변경·unknown 상태
- 소스와 현재 관찰 commit
- CLI가 source revision을 고정할 수 있는지 나타내는 `revisionBinding`
- 정확한 marketplace, install, verify 명령
- 상태 파일 경로와 쓰기 작업

사용자는 위험 고지를 확인한 뒤 동일한 미리보기에 별도로 승인한다. 계획이나
관찰 digest가 바뀌면 승인은 무효다. 명령은 한 번에 하나씩 실행하고 각 단계 뒤
receipt를 기록한다. 한 실행의 기본 설치 상한은 두 개다.

Claude 공식 marketplace install은 관찰 commit을 CLI에 고정하지 못하므로
`revisionBinding: unavailable`이다. 이 경로는 source pin과 실제 설치 revision이
같다고 주장하지 않는다. 이 TOCTOU 불확실성은 eligible-with-disclosures의 필수
고지이며 receipt도 설치 identity와 상태만 증명한다. 정책이 exact revision을
요구하거나 설치 후 resolved revision을 확인할 수 없는 비공식 경로는 held다.

## 12. Codex 흐름

Codex는 Claude와 같은 goal/domain 해석과 decision-plan 출력을 사용한다. 후보는
Codex용 표준 skill path가 관찰되고, 검토 결정에 Codex 호환성 근거가 있으며,
현재 관찰이 그 결정과 일치할 때만 설치 미리보기 적격이다.

v1은 Codex에서 자동 설치하지 않는다. 적격 후보가 있으면 원본 GitHub
repository, commit, skill path와 `$skill-installer`에 전달할 수 있는 정확한
미리보기만 제공한다. 적격 후보가 없으면 이유를 설명하고 held 상태로 끝낸다.
Claude plugin add/install/update 명령은 Codex 계획에 포함하지 않는다.

## 13. 유지관리 흐름

`/skillset-manager:maintain`은 설치된 identity와 현재 decision plan을 비교해
다음 작업을 만든다.

- compatible update preview
- review-required update hold
- blocked update notice
- explicit removal preview

update와 removal은 setup과 동일하게 정확한 명령, 영향받는 후보, 상태 파일 변경,
검증 명령을 모두 공개한 뒤 별도 승인을 받는다. 자동 실행, 자동 제거, 승인 재사용은
금지한다. 업데이트 실패는 기존 성공 설치를 제거하지 않는다.

setup receipt는 `managedBy: claude-code-skillsets`, decision plan digest, plugin과
marketplace source identity, 설치 전후 CLI가 보고한 version, install command
digest를 저장한다. maintain은 이 receipt와 현재 설치 identity가 정확히 일치하는
항목만 프로젝트 관리 대상으로 취급한다. receipt가 없거나 identity가 다르면
사용자 소유 설치로 간주해 update와 removal을 held로 둔다.

update는 현재와 다음 semver 및 source identity가 모두 관찰될 때만 update policy를
호출한다. 실제 version이나 source를 확인하지 못하면 compatible이라고 추정하지
않고 held다. removal도 프로젝트 관리 receipt가 있는 exact identity만 preview한다.

유지관리 명령은 현재 고정된 Claude Code CLI 버전의 help와 공식 문서로 검증된
구문만 인덱스에 넣는다. 특정 플러그인의 안전한 update 또는 removal 구문을 확인할
수 없으면 명령을 추정하지 않고 해당 작업을 held로 반환한다.

## 14. 문서와 사용자 경험

한국어와 영어 README의 첫 화면은 Claude Code 비공개 설치 두 명령과 setup 호출을
먼저 보여준다. Codex broker 개발자 명령은 그 다음 별도 섹션으로 이동한다.

README는 Outcome Pack이 현재 설치 단위라고 주장하지 않는다. v1의 설치 단위는
decision plan의 primary와 선택적 complement다. 미검토 시장 후보, 공식 등재
후보, 검토 승인 후보를 시각적으로 다른 상태명으로 표시한다.

## 15. RC 평가와 테스트

현재 official index를 읽는 setup 흐름에 맞춰 semantic evaluator를 교체한다.
폐기된 purpose/tool/Essential/Recommended/Custom Max 시나리오는 릴리스 증거에서
제거하고 다음 시나리오를 검증한다.

- 한국어 목표가 한 대분류와 primary 한 개로 결정됨
- 대분류만 선택했을 때 최대 두 개 계획
- 애매한 목표가 최대 세 개 대분류 선택을 요청함
- unknown과 safety-review-incomplete가 미리보기에 남음
- held와 blocked 후보가 실행 계획에서 제외됨
- observation 변경으로 approved 결정이 stale됨
- 승인 전 실행과 쓰기 없음
- 계획 digest 변화 시 승인 무효
- Codex에 Claude 명령 없음
- update/remove의 별도 승인

단위 테스트는 상태 전이, 안정적 순위, 최소화, diff, ledger 검증을 다룬다. 통합
테스트는 broker CLI, setup/maintain 문서 계약, 주간 workflow의 PR-only 권한을
검증한다. clean-copy는 기존 typecheck, 전체 테스트, generated diff, broker-only,
Claude plugin validation을 유지한다.

## 16. 데이터 마이그레이션

기존 15개 스냅샷과 receipt는 수정하지 않는다. 현재 source-review-backlog는 첫
observation projection의 입력으로 사용하고, 모든 비공식 소스는 명시적인
decision이 없으므로 `held/not-reviewed`로 시작한다. 공식 272개 기준선도 기존
commit을 첫 baseline으로 유지한다.

새 ledger에는 과거에 하지 않은 검토를 소급해 기록하지 않는다. 기존 정적 두
후보 override는 초기 관련성 자료로만 마이그레이션하며 eligible이나 안전 검토
증거로 간주하지 않는다.

## 17. 오류 처리와 안전

- 원장 줄이 잘못되거나 참조가 끊기면 전체 review state 생성을 실패시킨다.
- snapshot hash가 맞지 않으면 추천과 설치 미리보기를 만들지 않는다.
- 주간 네트워크 실패는 기존 데이터로 PR을 만들지 않고 job을 실패시킨다.
- 호환성, 라이선스, 권한 또는 의존성을 모르면 `unknown`으로 남긴다.
- blocked 또는 stale 후보가 계획에 들어오면 release gate를 실패시킨다.
- 로그와 receipt에는 token, 환경 변수 값, 인증 상태, 사용자 파일 내용을 넣지
  않는다.

## 18. 승인 기준

Decision Broker v1은 다음 조건을 모두 만족할 때 완료다.

1. 목표 또는 대분류에서 최대 primary 한 개와 complement 한 개를 결정한다.
2. 실제 시험 문장인 쇼핑몰 홍보·매출 목표를 관련 대분류로 해석한다.
3. 영상 편집 목표가 product-manager storyboard 하나만으로 끝나지 않는다.
4. eligible이 없으면 설치 계획이 비어 있고 held 이유가 표시된다.
5. 비공식 소스의 관찰과 append-only 결정이 별도 파일로 검증된다.
6. 두 관찰 사이의 diff와 stale 전이가 테스트된다.
7. 주간 및 수동 workflow가 변경 PR만 만들고 자동 병합·설치를 하지 않는다.
8. Claude setup은 최대 두 설치, 전체 미리보기, 별도 승인, receipt를 지킨다.
9. Codex plan은 검증된 근거가 없으면 설치 미리보기를 거부한다.
10. maintain이 update와 removal을 별도 승인 흐름으로 제공한다.
11. KO/EN README 첫 화면에서 Claude 설치 경로를 30초 안에 찾을 수 있다.
12. 현재 setup 계약을 반영한 semantic RC, 전체 테스트와 clean-copy가 통과한다.
13. 독립 리뷰에서 blocker와 major finding이 없다.
14. 최소 한 개의 실제 공식 Claude 후보가 unknown disclosure와
    `revisionBinding: unavailable`을 포함한 eligible plan 및 승인 전후 receipt
    통합 시험을 통과한다.
15. 비공식 fixture는 approved exact-path, held, blocked, stale 상태를 각각
    검증하고 unknown 민감 필드가 설치 계획에 들어가지 않음을 증명한다.
16. 20개 모든 대분류의 한국어·영어 intent profile 전체와 동점·경계 corpus가
    broker와 setup semantic evaluation에서 같은 plan을 만든다.
17. 주간 workflow 정적 검증은 정확한 권한, full-SHA action, concurrency,
    고유 브랜치, 검증 후 push, no force-push, no auto-merge/install을 확인한다.
18. reviewer allowlist 변경 PR과 ledger 변경 PR의 동시 수정을 거부하고, ledger
    권한은 base SHA의 allowlist로 검증하며 main branch protection receipt를
    release gate에서 확인한다.
19. 각 intent profile의 core/required capability와 후보 coverage evidence를
    검증하며, primary 단독 또는 primary+complement가 모두 충족하지 못하면 설치
    계획이 held가 된다.
20. 하나·두 개 대분류의 합성 결과와 세 개 이상 선택의 우선순위 재선택을 시험해
    전체 설치 상한 두 개와 사용자 선택 순서를 보존한다.
