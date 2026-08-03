# Privacy / 개인정보 처리

This policy describes data handling by the original code and skills in Claude
Code Skillsets. 이 정책은 Claude Code Skillsets의 자체 코드와 스킬이 데이터를
처리하는 방식을 설명합니다.

## English

### Project Data Handling

This project does not operate a telemetry or account service. The project does
not collect or transmit installation statistics, account identifiers,
credentials, secrets, conversation history, or user files to the project
maintainer. Do not put credentials or secret values in an issue, approval
record, or diagnostic report.

This statement covers this project's own plugins. Claude Code, GitHub, and each
external plugin or service have separate policies and behavior.

### Shared Core

`shared-core` contains human-readable workflow skills. It has no installer or
executable network client, does not persist project state, and does not install,
update, or remove external plugins. A user may apply its planning or review
instructions to data in a Claude Code session, but that data is not sent to this
project or its maintainer by `shared-core`.

### Skillset Manager

`skillset-manager` reads a bundled plugin-owned index to prepare a bounded
recommendation and preview. Before exact final approval, separately consented
read-only probes observe UTC time and establish local Node.js publisher and
Claude executable identities from canonical paths, versions, and SHA-256 hashes.
The Claude identity probe reads `PATH` only to locate the executable and runs only
the resolved absolute path with `--version`; the supported result is exactly
`2.1.198 (Claude Code)`. The Claude canonical path, version, and SHA-256 are bound
into the local preview and durable state. Diagnostic output is minimized, and
account, authentication, credential, secret, environment-value, header, and token
values are not part of the intended record.

The `claude plugin marketplace list --json`, `claude plugin install`, and
`claude plugin list --json` candidate phases run only after a separate risk
acknowledgement and exact final approval. Before every phase, the manager
revalidates the approved Claude realpath, SHA-256, and exact version without a
new `PATH` lookup. Successful and failed run evidence is stored locally under
`~/.claude/claude-code-skillsets/state`. The local record contains plan,
approval, status, and receipt metadata; it is not project telemetry and is not
sent to the project maintainer.

### External Providers

An external plugin may contact networks, require authentication, incur cost, or
process personal information. Those behaviors and any retention or deletion
rights are governed by each provider's policies. When the manager has not
verified a field such as network behavior, authentication, cost, permissions,
privacy, or retention, it is disclosed as `unknown`; an official marketplace
listing is not presented as an individual safety review.

### Deletion

Use Claude Code's plugin manager to uninstall `skillset-manager`, `shared-core`,
and any external plugins separately. After related Claude Code sessions and
setup operations have ended, delete
`~/.claude/claude-code-skillsets/state` to remove this project's local plan,
approval, status, and receipt records. Deleting that directory does not
uninstall plugins or delete data held by an external provider. Follow each
provider's deletion process for provider-held data.

For help, use the routes in [SUPPORT.md](SUPPORT.md). Report a vulnerability
privately rather than in a public issue.

## 한국어

### 프로젝트의 데이터 처리

이 프로젝트는 자체 텔레메트리나 계정 서비스를 운영하지 않습니다. 프로젝트는 설치
통계, 계정 식별자, 인증 정보, 비밀 값, 대화 기록 또는 사용자 파일을 프로젝트
관리자에게 수집하거나 전송하지 않습니다. 이슈, 승인 기록 또는 진단 보고서에 인증
정보나 비밀 값을 넣지 마세요.

이 설명은 프로젝트 자체 플러그인에 적용됩니다. Claude Code, GitHub 및 각 외부
플러그인과 서비스에는 별도의 정책과 동작이 있습니다.

### 공용 코어

`shared-core`는 사람이 읽을 수 있는 워크플로 스킬로 구성됩니다. 설치 프로그램이나
실행 가능한 네트워크 클라이언트가 없고, 프로젝트 상태를 영구 저장하지 않으며, 외부
플러그인을 설치, 업데이트 또는 삭제하지 않습니다. 사용자가 Claude Code 세션의
데이터에 이 스킬의 계획·검토 지침을 적용할 수는 있지만, `shared-core`가 그 데이터를
이 프로젝트나 관리자에게 전송하지는 않습니다.

### 스킬셋 관리자

`skillset-manager`는 플러그인이 소유한 번들 인덱스를 읽어 범위가 제한된 추천과
미리보기를 만듭니다. 정확한 최종 승인 전에는 별도로 동의받은 읽기 전용 probe로 UTC
시간을 확인하고 canonical path, 버전, SHA-256으로 로컬 Node.js publisher와 Claude
실행 파일 신원을 확립합니다. Claude probe는 실행 파일 탐색에만 `PATH`를 읽고,
해석된 절대경로로 `--version`만 실행하며 정확한 `2.1.198 (Claude Code)`만
지원합니다. Claude canonical path, version, SHA-256은 로컬 미리보기와 durable
state에 묶입니다. 진단 출력은 최소화되며 계정, 인증, 자격 증명, 비밀 값, 환경 변수
값, 헤더 및 토큰 값은 의도된 기록 대상이 아닙니다.

`claude plugin marketplace list --json`, `claude plugin install`,
`claude plugin list --json` 후보 단계는 별도의 위험 인지와 정확한 최종 승인 뒤에만
실행됩니다. 각 단계 직전에 새 `PATH` 조회 없이 승인된 Claude realpath, SHA-256,
정확한 버전을 재검증합니다. 성공·실패 실행 근거는
`~/.claude/claude-code-skillsets/state`에 로컬로 저장됩니다. 이 기록에는 계획,
승인, 상태 및 영수증 메타데이터가 들어가지만 프로젝트 텔레메트리가 아니며 프로젝트
관리자에게 전송되지 않습니다.

### 외부 공급자

외부 플러그인은 네트워크에 접속하거나 인증을 요구하고, 비용을 발생시키거나 개인정보를
처리할 수 있습니다. 이러한 동작과 보관·삭제 권리는 각 공급자의 정책을 따릅니다.
관리자가 네트워크, 인증, 비용, 권한, 개인정보 또는 보관 항목을 검증하지 못한 경우
`unknown`으로 공개합니다. 공식 마켓플레이스 등재를 개별 안전성 검토로 표현하지
않습니다.

### 삭제

Claude Code의 플러그인 관리 기능으로 `skillset-manager`, `shared-core`, 각 외부
플러그인을 별도로 제거하세요. 관련 Claude Code 세션과 setup 작업이 끝난 뒤
`~/.claude/claude-code-skillsets/state`를 삭제하면 이 프로젝트의 로컬 계획,
승인, 상태 및 영수증 기록이 삭제됩니다. 이 디렉터리를 삭제해도 플러그인이 제거되거나
외부 공급자가 보관한 데이터가 삭제되지는 않습니다. 공급자 보관 데이터는 해당 공급자의
삭제 절차를 따르세요.

지원 경로는 [SUPPORT.md](SUPPORT.md)를 확인하세요. 보안 취약점은 공개 이슈가 아닌
비공개 경로로 신고해야 합니다.
