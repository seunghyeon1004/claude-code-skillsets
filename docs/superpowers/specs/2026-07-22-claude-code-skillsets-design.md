# Claude Code Skillsets 설계

- 상태: 승인됨
- 승인일: 2026-07-22
- 프로젝트: `claude-code-skillsets`
- 기본 언어: 한국어
- 보조 언어: 영어
- 공개 계획: 비공개로 개발 및 검증한 뒤 전체 공개

> 현재 상태: 이 문서의 Outcome Pack 설치 모델은 초기 설계 기록입니다. 카탈로그의
> 40개 팩은 모두 `draft`이며 활성 설치 단위가 아닙니다. 현재 v1 실행 경로는 검증된
> decision plan의 primary와 선택적 complement만 사용합니다.

## 1. 배경

Claude Code 사용자가 업무 목적에 맞는 스킬을 직접 조사하고, 여러
마켓플레이스를 비교하고, 의존성과 업데이트를 수동으로 관리하는 비용을
줄인다. 자체 제작 스킬과 검증된 외부 스킬을 하나의 카탈로그에서 제공하되,
외부 코드는 복사하지 않고 원본 마켓플레이스에 연결한다.

전체 카테고리와 의존성 구조는 처음부터 설계한다. 구현과 검증은 팩별로
순차 진행하지만, 모든 대분류가 공개 기준을 충족하기 전까지 저장소는
비공개로 유지한다.

## 2. 목표

1. 한국어 사용자가 GitHub 첫 화면에서 30초 안에 설치 경로를 찾게 한다.
2. 한국어와 영어를 모두 지원한다.
3. 업무, 창작, 사업, 개발 목적을 세밀하게 분류한다.
4. 사용 목적과 로컬 도구에 맞는 스킬만 설치한다.
5. 자체 스킬과 외부 스킬의 출처, 라이선스, 신뢰 수준을 투명하게 관리한다.
6. 호환 가능한 외부 업데이트는 자동 반영하고 위험한 변경만 검토한다.
7. 스킬 수가 아니라 실제 업무 결과와 재현 가능한 평가로 품질을 증명한다.

## 3. 비목표

- 학습, 여행, 생활관리, 개인재무 등 개인 생활용 컬렉션
- 관련 스킬을 무분별하게 모두 복사하는 저장소
- 모든 사용자에게 모든 대분류를 기본 설치하는 방식
- 검증되지 않은 외부 스킬의 무조건적인 자동 업데이트
- 법률, 재무, 채용 관련 전문가 판단의 자동 대체
- 설치 통계나 사용자 설정의 기본 수집

## 4. 시장 조사에서 채택한 원칙

### 4.1 벤치마크

- Anthropic Knowledge Work Plugins: 직무별 플러그인과 외부 소스 연결
- Netresearch Marketplace: 외부 저장소를 원본으로 유지하는 얇은 카탈로그
- TraderMonty Trading Skills: 필수, 권장, 선택 의존성 manifest
- Rebecca Rae Claude Marketing: 실제 업무의 인접한 단계로 구성한 팩
- Superpowers: 하나의 일관된 실행 방법론으로 구성된 공용 워크플로
- Trail of Bits Skills: 사용 및 비사용 조건, 위험 기반 엄격성, CI 검증
- Daymade Claude Code Skills: 유지관리자가 책임질 수 있는 품질과 보안 기준
- Marketing Skills: 공통 제품 및 고객 문맥을 재사용하는 도메인 구조
- Modu AI Cowork Plugins: 한국 업무에 특화된 대규모 카테고리

### 4.2 선정 원칙

- 실제 반복 업무에서 시작한다.
- 팩은 분야명이 아니라 완료 가능한 결과를 기준으로 만든다.
- 한 팩에는 결과물을 서로 넘겨받는 스킬만 포함한다.
- 필수, 권장, 선택 의존성을 구분한다.
- 공용 코어는 목적별 팩에서 반복되는 동작만 추출한다.
- 외부 스킬은 복사하지 않고 원본 마켓플레이스를 참조한다.
- 라이선스와 보안 검증 없이 인기만으로 채택하지 않는다.

## 5. 제품 모델

분류와 설치 단위를 분리한다.

```text
Domain
  -> Category
    -> Outcome Pack
      -> Skill
```

- Domain: 사용자가 인식하는 업무 대분류이자 통합 설치 단위
- Category: 탐색과 검색을 위한 세부 분류
- Outcome Pack: 하나의 결과를 완주하는 실제 설치 단위
- Skill: 단일하고 재사용 가능한 실행 능력

플랫폼, 언어, 국가, 난이도, 위험도, 실행 방식, 신뢰 등급은 계층이 아닌
교차 태그로 관리한다.

## 6. 전체 대분류

### 6.1 Research and Intelligence

정보원 탐색, 웹 조사, 학술 및 특허 조사, 시장 조사, 경쟁사 분석, 고객
조사, 인터뷰 분석, 트렌드 탐지, 팩트체크, 출처 평가, 증거 종합을 포함한다.

### 6.2 Strategy and Decision

문제 정의, 목표 및 지표, 기회 평가, 비즈니스 모델, 시나리오, 우선순위,
의사결정 기록, 실행전략, 리스크 분석, 전략 리뷰를 포함한다.

### 6.3 Writing and Publishing

아이디어, 아웃라인, 장문 글, 블로그, 뉴스레터, 기술문서, 비즈니스 문서,
카피라이팅, 교정, 출처 검증, 번역 및 현지화, CMS 발행을 포함한다.

### 6.4 Marketing and Growth

ICP, 페르소나, 포지셔닝, 메시징, 오퍼, 가격, 콘텐츠 전략, SEO, 이메일,
라이프사이클, 퍼널, CRO, 유료획득 전략, 리텐션, 측정을 포함한다.

### 6.5 Promotion and Distribution

출시 홍보, 소셜 배포, 채널 변환, 콘텐츠 재활용, PR, 미디어 피치,
인플루언서, 커뮤니티, 아웃리치, 캠페인 운영과 성과 회수를 포함한다.

### 6.6 Sales and Customer

계정 조사, 리드 발굴, 자격 평가, 디스커버리, 제안서, RFP, 데모, CRM,
협상, 온보딩, 고객지원, 고객상태, 갱신, 확장, VOC를 포함한다.

### 6.7 Product Management

문제 발견, 사용자 요구, 제품 원칙, PRD, 사용자 스토리, 범위, 우선순위,
로드맵, 프로토타입 검증, 실험, 제품지표, 출시 준비를 포함한다.

### 6.8 Project Management

프로젝트 정의, 작업분해, 일정, 추정, 의존성, 자원, 회의, 상태 보고,
결정 기록, 변경, 위험, 이해관계자 소통, 회고를 포함한다.

### 6.9 Software Engineering

저장소 파악, 요구사항, 명세, 아키텍처, 프런트엔드, 백엔드, 모바일, API,
데이터베이스, 테스트, 디버깅, 리뷰, 리팩터링, 성능, 접근성, 문서화와
릴리스 준비를 포함한다.

### 6.10 DevOps and Security

개발환경, CI/CD, 컨테이너, IaC, 클라우드, 배포, 롤백, 관측성, SRE,
장애대응, 비밀정보, 의존성 보안, 애플리케이션 보안, 위협모델링과 복구를
포함한다.

### 6.11 AI, Agents, and Automation

문제 적합성, 모델 선택, 프롬프트, 컨텍스트, RAG, MCP, 도구 호출,
단일 및 다중 에이전트, 메모리, 평가, 가드레일, 비용, 지연과 모니터링을
포함한다.

### 6.12 Data and Analytics

수집, 품질, 정제, 변환, SQL, 탐색 분석, 통계, 실험, KPI, 예측,
세분화, 시각화, 대시보드, 보고서와 거버넌스를 포함한다.

### 6.13 Design and Brand

브리프, UX 조사 적용, 정보구조, 사용자 흐름, 와이어프레임, UI,
디자인 시스템, 프로토타입, 웹, 브랜드, 시각 아이덴티티, 크리에이티브,
접근성과 개발 전달을 포함한다.

### 6.14 Video and Audio

조사, 기획, 대본, 스토리보드, 샷리스트, 녹화 준비, 러프컷, 정밀 편집,
모션그래픽, 자막, 음성 정리, 믹싱, 음악, 효과음, 썸네일, 재가공,
품질검사와 내보내기를 포함한다.

### 6.15 Documents and Knowledge

문서, 스프레드시트, 프레젠테이션, PDF, 템플릿, 변환, OCR, 표, 차트,
회의 기록, 노트, 지식베이스, 검색, SOP 문서화, 분류와 보관을 포함한다.

### 6.16 Business Operations

프로세스, SOP, 반복업무 자동화, 인수인계, 서비스 운영, 품질, 조달,
벤더, 자원, 운영지표, 문제, 변경과 비상 대응을 포함한다.

### 6.17 Finance and Accounting

예산, 현금흐름, 비용, 영수증, 청구, 수금, 장부 보조, 재무제표 분석,
예측, 단위경제성, 수익성, 자금조달, 세무 준비와 경영 보고를 포함한다.

### 6.18 Commerce

상품 조사, 상품기획, 카탈로그, 상품페이지, 가격, 머천다이징, 스토어,
마켓플레이스, 재고, 주문, 배송, 반품, 프로모션, 리뷰와 매출 분석을
포함한다.

### 6.19 People and Training

인력 계획, 역할, 직무기술서, 후보자, 면접, 채용평가, 온보딩, 성과,
피드백, 경력, 조직정책, 교육과정, 학습자료와 평가를 포함한다.

### 6.20 Legal, Risk, and Compliance

법률 조사 보조, 계약 작성 및 검토 보조, 정책, 개인정보, 지식재산,
규제 매핑, 준법 체크리스트, 위험등록부, 감사 증적, 사고 대응과
보존 및 삭제 정책을 포함한다.

## 7. 대분류 경계

- 조사는 근거를 생산하고 전략은 선택을 만든다.
- 글쓰기는 콘텐츠를 완성하고 마케팅은 수요를 만들며 홍보는 유통한다.
- 제품은 무엇을 만들지 결정하고 프로젝트는 실행을 조율한다.
- 개발은 제품을 구현하고 DevOps와 보안은 배포 이후까지 책임진다.
- AI는 지능형 실행 시스템, 데이터는 근거와 측정을 담당한다.
- 디자인은 시각과 경험, 영상 및 오디오는 시간 기반 미디어를 담당한다.
- 문서는 업무 산출물과 지식 보존을 담당한다.

도메인 경계를 넘는 기능은 복제하지 않는다. 사용하는 팩이 원본 도메인의
스킬을 의존성으로 호출한다.

## 8. 대표 완주형 팩

```text
question-to-cited-research-brief
competitor-landscape-to-opportunity-map
customer-interviews-to-insights
evidence-to-strategic-decision
idea-to-edited-article
source-to-multilingual-publication
product-to-positioning-and-offer
keyword-to-ranked-content
launch-plan-to-multichannel-campaign
long-form-to-social-distribution
account-research-to-personalized-outreach
discovery-call-to-proposal
customer-problem-to-validated-prd
prd-to-prioritized-roadmap
project-brief-to-execution-board
repository-to-implementation-plan
spec-to-tested-feature
bug-report-to-verified-fix
service-to-ci-cd-deployment
incident-alert-to-postmortem
application-to-security-review
use-case-to-agent-design
prototype-to-evaluated-agent
raw-data-to-validated-dataset
business-question-to-dashboard
brief-to-accessible-interface
brand-strategy-to-visual-system
topic-to-recording-ready-script
raw-footage-to-published-video
long-video-to-multiplatform-clips
meeting-to-decisions-and-actions
source-files-to-polished-document
manual-process-to-maintained-sop
repetitive-work-to-approved-automation
transactions-to-management-report
product-idea-to-store-listing
role-need-to-interview-scorecard
expertise-to-training-program
contract-to-risk-and-revision-brief
regulation-to-compliance-checklist
```

이 목록은 초기 대표 팩이며, 전체 카테고리를 팩 manifest로 분해하는 과정에서
추가된다.

## 9. 공용 필수 코어

공용 코어의 실행 순서는 다음과 같다.

```text
환경 파악 -> 목표 명확화 -> 팩 선택 -> 실행 계획
         -> 근거 및 위험 확인 -> 실행 -> 검증 -> 인계
```

### 9.1 Core Skills

- `workspace-context`: 지침, 도구, 자료, 제약 파악
- `intent-to-brief`: 목표, 산출물, 대상, 완료 기준 정리
- `workflow-router`: 대분류와 팩 선택 및 중복 방지
- `plan-and-checkpoints`: 순서, 의존성, 사용자 승인 지점 설정
- `evidence-provenance`: 사실, 추론, 의견, 출처, 기준일, 라이선스 구분
- `risk-privacy-permissions`: 민감정보와 위험 작업 통제
- `quality-verification`: 도메인별 검증기 호출 및 완료 조건 확인
- `handoff-continuity`: 결과물, 결정, 변경, 남은 일, 재현 방법 정리

`skillset-manager`는 작업 스킬이 아닌 시스템 플러그인이므로 코어와 분리한다.
코어는 전문 검증을 직접 구현하지 않고 도메인 검증기를 호출한다. 짧은
메타데이터만 상시 노출하고 전체 본문은 호출 시 로드한다.

## 10. 설치 모델

### 10.1 첫 설치

```text
/plugin marketplace add <owner>/<repo>
/plugin install skillset-manager@<marketplace>
/skillset-manager:setup
```

실제 소유자와 마켓플레이스 이름이 확정되기 전까지 README에 위 placeholder를
설치 명령으로 공개하지 않는다.

### 10.2 개인화 설치

1. 한국어 또는 영어 선택
2. 동의 기반 로컬 환경 감지
3. 업무 목적 복수 선택
4. 도구 및 플랫폼 선택
5. Essential 또는 Recommended 선택
6. 대분류, 팩, 외부 스킬과 권한 미리보기
7. 승인 후 설치
8. `doctor`로 로딩, 의존성, 도구 검증

환경 감지는 검사할 명령과 경로를 먼저 보여준다. 결과는 로컬에서만
처리하며, 사용자는 자동 감지를 건너뛸 수 있다.

### 10.3 설치 경로

- `setup`: 개인화 설치
- `domain`: 대분류 전체 설치
- `pack`: 완주형 팩 설치
- `custom-max`: 선택 도구의 선택 스킬까지 설치
- `full-catalog`: 모든 대분류 설치, 고급 옵션
- `import` 및 `export`: 다른 환경에서 설치 상태 재현

### 10.4 의존성 수준

- Required: 해당 팩이 동작하기 위해 자동 설치
- Recommended: 권장 프로필과 대분류 통합 설치에 포함
- Optional: 대체 도구와 플랫폼을 사용자가 선택

`full-catalog`은 모든 대분류와 권장 외부 의존성을 설치한다. 서로 대안인
선택 스킬은 전부 설치하지 않고 설정 마법사에서 하나를 선택한다.

### 10.5 설치 안전성

- 변경 전 추가, 제거, 업데이트 목록 표시
- 중간 실패 시 성공 항목 기록 및 재개
- 기존 설정을 임의로 덮어쓰지 않음
- 대안 도구의 동시 설치 방지
- 고아 자동 의존성의 확인 후 정리
- 설치 결과를 잠금 파일로 저장
- 반복 실행의 멱등성 보장

## 11. 외부 스킬과 신뢰 모델

외부 코드를 저장소에 복사하지 않는다. 원본 마켓플레이스, 제작자,
라이선스와 버전을 manifest에 기록하고 Claude Code 플러그인 의존성으로
연결한다.

### 11.1 신뢰 등급

| 등급 | 정의 | 업데이트 |
| --- | --- | --- |
| Verified | 공식 또는 검증된 기업 및 재단 | 호환 버전 자동 반영 |
| Trusted | 품질 기준을 통과한 안정된 출처 | 자동 테스트 통과 시 호환 버전 반영 |
| Community | 일반 개인 및 소규모 저장소 | 자동 발견 후 검토 |
| Blocked | 라이선스, 난독화, 권한, 보안 문제 | 설치 및 업데이트 차단 |

마켓플레이스 등록 자체는 신뢰의 증거가 아니다. 신뢰 판정에는 소유자,
라이선스, 릴리스 기록, 스크립트 투명성, 권한, 외부 전송, 유지관리,
보안 이력과 호환성 테스트를 사용한다.

### 11.2 업데이트

- 외부 원본의 변경은 자동 발견한다.
- Verified와 Trusted의 호환 업데이트는 자동 반영한다.
- 가능하면 `^2.1` 같은 semver 범위를 사용한다.
- 메이저 버전, 라이선스, 권한, 소유권 변경은 검토한다.
- 버전 체계가 없거나 불안정한 출처만 커밋 SHA로 고정한다.
- 중단된 스킬은 대체 후보와 이전 경로를 제공한다.
- 설치 관리자는 사용자가 마켓플레이스 자동 업데이트를 설정하도록 안내한다.

## 12. 저장소 구조

```text
claude-code-skillsets/
├─ .claude-plugin/
│  └─ marketplace.json
├─ plugins/
│  ├─ shared-core/
│  ├─ skillset-manager/
│  └─ owned/
├─ manifests/
│  ├─ domains/
│  ├─ categories/
│  ├─ packs/
│  ├─ profiles/
│  └─ external-sources/
├─ schemas/
├─ tests/
│  ├─ structure/
│  ├─ installation/
│  ├─ compatibility/
│  ├─ security/
│  └─ evaluations/
├─ docs/
│  ├─ ko/
│  └─ en/
├─ generated/
└─ scripts/
```

하나의 비공개 모노레포 안에서 목적 팩을 독립 플러그인으로 관리한다.
대분류 메타 플러그인, 설치 프로필, 마켓플레이스와 문서 표는 manifest에서
자동 생성한다. 필요하면 플러그인 ID를 유지하면서 특정 도메인을 별도
저장소로 분리할 수 있다.

## 13. Manifest

팩 manifest의 필수 필드는 다음과 같다.

```yaml
id:
domain:
categories:
outcome:
target_users:
when_to_use:
when_not_to_use:
inputs:
outputs:
workflow:
required_plugins:
recommended_plugins:
optional_plugins:
tools:
languages:
regions:
risk_level:
trust_requirements:
licenses:
evaluation_cases:
maintainers:
version:
```

manifest는 단일 원본이다. Marketplace, README 표, 언어별 카탈로그,
설치 관리자와 잠금 파일은 이를 기반으로 생성한다. 생성 파일의 직접 수정은
CI에서 거부한다.

## 14. 품질과 테스트

### 14.1 개별 스킬 승인 조건

- 반복 사용 가능한 실제 문제를 해결한다.
- 모델의 기본 능력이나 표준 문서를 단순 반복하지 않는다.
- 사용 및 비사용 조건을 명시한다.
- 입력, 출력, 완료 기준과 실패 처리를 명시한다.
- 정상 사례 3개 이상과 실패 또는 경계 사례 2개 이상을 가진다.
- 스킬 없는 기준 결과보다 측정 가능한 개선을 보인다.
- 다른 스킬과 역할이 중복되지 않는다.
- 라이선스, 출처, 권한 검증을 통과한다.
- 본문은 짧게 유지하고 상세 자료는 필요할 때 로드한다.

### 14.2 자동 검증

1. YAML, JSON, 경로, 이름, 버전 검사
2. 누락, 순환, 충돌, 고아 의존성 검사
3. 비밀정보, 위험 명령, 권한, 외부 전송 검사
4. 한국어 및 영어 문서 대응과 링크 검사
5. 개별, 대분류, 사용자 프로필 설치 테스트
6. 설치, 업데이트, 제거, 중단 후 재개 테스트
7. 실제 업무 시나리오 기반 행동 평가
8. 결과물 형식, 근거, 안전, 완료 조건 평가
9. 메타데이터와 예상 컨텍스트 비용 측정

### 14.3 고위험 팩

재무, 채용, 법무 등은 국가 및 관할 태그, 근거 기준일, 불확실성,
전문가 검토 단계를 강제한다. 자동 제출, 서명, 송금은 금지하고 민감정보를
최소 수집한다.

## 15. 릴리스

| 상태 | 의미 |
| --- | --- |
| draft | 조사 또는 작성 중 |
| beta | 구조, 보안, 설치 검증 통과 |
| stable | 실제 시나리오와 회귀 평가 통과 |
| deprecated | 대체 스킬과 이전 방법 제공 |
| blocked | 보안, 라이선스, 출처 문제로 중단 |

자체 플러그인은 독립적인 시맨틱 버전을 사용한다. 대분류 릴리스는 하위
팩 버전의 조합으로 생성하며 stable과 beta 채널을 분리한다.

첫 공개 릴리스 조건은 다음과 같다.

- 20개 대분류가 최소 하나 이상의 stable 완주형 팩을 보유
- 지원 운영체제에서 깨끗한 설치 재현
- 개인화 설치, 직접 도메인 설치, 업데이트, 제거 검증
- 외부 의존성의 출처, 라이선스, 신뢰 등급 공개
- 한국어 및 영어 핵심 문서 완료
- 보안 및 고위험 작업 정책 통과

## 16. 문서와 GitHub 첫 화면

`README.md`는 한국어 기본이고 `README.en.md`는 독립적으로 다듬은 영어판이다.
모든 문서에 언어 전환을 제공한다. 설치 관리자가 안정화된 뒤 README 첫
화면은 다음 순서로 구성한다.

1. 프로젝트 이름과 비공식 프로젝트 고지
2. 마켓플레이스와 설치 관리자 명령
3. 개인화 설치 추천
4. 역할별 빠른 예시
5. 대분류 직접 설치표
6. 신뢰, 개인정보, 라이선스 설명

대분류 문서는 대상 사용자, 포함 팩, 연결 흐름, 준비 도구를 표시한다.
팩 문서는 입력, 출력, 예시, 비사용 조건과 외부 의존성을 표시한다.

## 17. 기여와 운영

- 카테고리와 팩 제안은 Issue로 접수한다.
- 외부 스킬 추천과 신뢰 재검토 요청을 받는다.
- 자체 스킬 PR은 품질 평가와 라이선스 확인을 요구한다.
- 외부 코드 복사 PR은 받지 않고 원본 연결을 요구한다.
- 기여 권한은 DCO 방식으로 확인한다.
- 보안 문제는 비공개 신고 경로를 제공한다.
- 대분류별 CODEOWNERS와 유지관리 상태를 표시한다.
- 담당자가 없는 팩은 community-maintained로 표시한다.
- 변경 이력과 이전 안내를 자동 생성한다.
- 테스트, 의존성, 번역 상태를 공개 대시보드로 제공한다.
- 사용자의 설치 통계와 설정은 기본 수집하지 않는다.

## 18. 라이선스

자체 제작 스킬, 설치 관리자, 생성 도구는 Apache-2.0으로 공개한다.
외부 스킬은 원본 라이선스를 유지하며 우리 저장소에 복사하지 않는다.
라이선스가 없거나 허용 범위가 불명확한 스킬은 연결 대상에서 제외한다.

## 19. 구현 순서

전체 설계는 이 문서에서 고정하되 구현은 다음 순서로 진행한다.

1. 스키마, manifest, 생성기와 CI 기반
2. shared-core와 skillset-manager
3. 외부 출처 카탈로그와 신뢰 평가 파이프라인
4. 20개 대분류와 대표 완주형 팩의 manifest
5. 목적 팩별 자체 및 외부 스킬 구현과 평가
6. 대분류 메타 플러그인과 설치 프로필
7. 한국어 및 영어 문서와 GitHub 첫 화면
8. 깨끗한 환경의 통합 설치, 업데이트, 제거 검증
9. 비공개 clean candidate와 일반 CI 검증
10. 사용자 최종 승인 후 릴리스 없는 공개 전환
11. 즉시 branch protection 적용 및 동일 SHA private-rc
12. 인증 없는 clone, marketplace, 설치 검증
13. tag, GitHub Release와 공개 발표

구현 단계가 순차적이라는 이유로 전체 공개 범위를 줄이지 않는다. 공개는
20개 대분류의 최소 stable 기준이 모두 충족된 뒤 진행한다.
GitHub Free의 세부 공개 및 rollback 순서는
`docs/release/github-free-staged-public.md`를 따른다.

## 20. 승인된 핵심 결정

- 업무, 창작, 사업 영역만 포함하고 개인 생활 영역은 분리한다.
- 카테고리는 세밀하게, 설치 단위는 완주형 팩으로 유지한다.
- 전체 설계는 일괄 수행하고 구현은 팩별로 진행한다.
- 기본 온보딩은 모든 항목 설치가 아니라 개인화 설치다.
- 대분류 통합 설치와 고급 full-catalog 설치를 모두 지원한다.
- 자체 스킬과 외부 원본 연결을 혼합한다.
- 신뢰 출처의 호환 업데이트는 자동 반영한다.
- 일반 개인 스킬은 자동 발견 후 검토한다.
- 모듈형 모노레포와 생성형 마켓플레이스를 사용한다.
- 자체 저작물은 Apache-2.0으로 공개한다.
