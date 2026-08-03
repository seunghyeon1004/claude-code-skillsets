# Skillset Manager Privacy / 스킬셋 관리자 개인정보 처리

## English

### Data Handling

Skillset Manager does not operate project telemetry or an account service and
does not collect or transmit account identifiers, credentials, secrets,
conversation history, user files, or installation statistics to the project
maintainer.

The manager reads its bundled plugin-owned index to prepare a bounded
recommendation and exact preview. Before exact final approval, separately
consented read-only probes observe UTC time and establish local Node.js publisher
and Claude executable identities from canonical paths, versions, and SHA-256
hashes. The Claude probe reads `PATH` only for discovery, executes only the
resolved absolute path with `--version`, and accepts exactly `2.1.198 (Claude
Code)`. That Claude path, version, and hash are bound into local preview and
durable state. The manager minimizes retained diagnostic fields and does not
intend to read or record account, authentication, credential, secret,
environment-value, header, or token values.

The `claude plugin marketplace list --json`, `claude plugin install`, and
`claude plugin list --json` candidate phases run only after a separate risk
acknowledgement and exact final approval. Before every phase, the manager
revalidates the approved Claude realpath, hash, and exact version without another
`PATH` lookup. The manager records local plan, approval, status, and receipt metadata under
`~/.claude/claude-code-skillsets/state`. This local state is not sent to the
project maintainer.

### External Providers

Installed external plugins may make network calls, require authentication,
incur cost, or process personal information. Those behaviors and data rights
are governed by each provider's policies. Network, authentication, cost,
permissions, privacy, retention, and deletion behavior that has not been
verified is disclosed as `unknown`. Marketplace listing and successful
installation are not represented as individual safety review.

### Deletion

Use Claude Code's plugin manager to uninstall `skillset-manager` and each
external plugin separately. After related Claude Code sessions and setup
operations have ended, delete `~/.claude/claude-code-skillsets/state` to remove
the manager's local plan, approval, status, and receipt records. This does not
delete external plugins or provider-held data; use each provider's deletion
process for those records.

For public help, use
[GitHub Issues](https://github.com/seunghyeon1004/claude-code-skillsets/issues).
Report security problems through
[GitHub private vulnerability reporting](https://github.com/seunghyeon1004/claude-code-skillsets/security/advisories/new).

## 한국어

### 데이터 처리

스킬셋 관리자는 프로젝트 텔레메트리나 계정 서비스를 운영하지 않으며 계정 식별자,
자격 증명, 비밀 값, 대화 기록, 사용자 파일 또는 설치 통계를 프로젝트 관리자에게
수집하거나 전송하지 않습니다.

관리자는 번들에 포함된 플러그인 소유 인덱스를 읽어 범위가 제한된 추천과 정확한
미리보기를 만듭니다. 정확한 최종 승인 전에는 별도로 동의받은 읽기 전용 probe로 UTC
시간을 확인하고 canonical path, 버전, SHA-256으로 로컬 Node.js publisher와 Claude
실행 파일 신원을 확립합니다. Claude probe는 탐색에만 `PATH`를 읽고, 해석된
절대경로로 `--version`만 실행하며 정확한 `2.1.198 (Claude Code)`만 지원합니다.
Claude path, version, hash는 로컬 미리보기와 durable state에 묶입니다. 보관하는
진단 필드를 최소화하며 계정, 인증, 자격 증명, 비밀 값, 환경 변수 값, 헤더 또는 토큰
값을 읽거나 기록하는 것을 의도하지 않습니다.

`claude plugin marketplace list --json`, `claude plugin install`,
`claude plugin list --json` 후보 단계는 별도의 위험 인지와 정확한 최종 승인 뒤에만
실행됩니다. 각 단계 직전에 새 `PATH` 조회 없이 승인된 Claude realpath, hash,
정확한 버전을 재검증합니다. 로컬 계획, 승인, 상태 및 영수증 메타데이터는
`~/.claude/claude-code-skillsets/state`에 기록됩니다. 이 로컬 상태는 프로젝트
관리자에게 전송되지 않습니다.

### 외부 공급자

설치된 외부 플러그인은 네트워크에 접속하거나 인증을 요구하고, 비용을 발생시키거나
개인정보를 처리할 수 있습니다. 해당 동작과 데이터 권리는 각 공급자의 정책을
따릅니다. 검증하지 않은 네트워크, 인증, 비용, 권한, 개인정보, 보관 및 삭제 동작은
`unknown`으로 공개합니다. 마켓플레이스 등재와 설치 성공을 개별 안전성 검토로
표현하지 않습니다.

### 삭제

Claude Code의 플러그인 관리 기능으로 `skillset-manager`와 각 외부 플러그인을
별도로 제거하세요. 관련 Claude Code 세션과 setup 작업이 끝난 뒤
`~/.claude/claude-code-skillsets/state`를 삭제하면 관리자의 로컬 계획, 승인,
상태 및 영수증 기록이 삭제됩니다. 이 작업은 외부 플러그인이나 공급자 보관 데이터를
삭제하지 않으므로 해당 기록은 각 공급자의 삭제 절차를 사용하세요.

공개 지원은
[GitHub Issues](https://github.com/seunghyeon1004/claude-code-skillsets/issues)를
사용하세요. 보안 문제는
[GitHub 비공개 취약점 신고](https://github.com/seunghyeon1004/claude-code-skillsets/security/advisories/new)로
제출하세요.
