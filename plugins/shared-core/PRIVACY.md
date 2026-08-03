# Shared Core Privacy / 공용 코어 개인정보 처리

## English

### Data Handling

`shared-core` contains eight human-readable `SKILL.md` workflow instructions.
It has no executable installer or network client, does not operate project
telemetry or an account service, does not persist project state, and does not
collect or transmit account identifiers, credentials, secrets, conversation
history, or user files to the project maintainer.

The plugin does not install, update, or remove external plugins. A user may
apply a Shared Core skill to information already available in a Claude Code
session. That use does not cause Shared Core itself to send the information to
this project.

If the user separately chooses a Claude Code tool or external provider while
following a planning or review skill, that tool or provider has its own network,
authentication, cost, privacy, retention, and deletion policies. Unverified
provider behavior remains `unknown` and is not covered by this policy.

### Deletion

Use Claude Code's plugin manager to uninstall `shared-core`. Shared Core creates
no separate persistent data directory, project telemetry record, or provider
account to delete. Data retained by Claude Code or an external provider must be
deleted under that product's policy.

For public help, use
[GitHub Issues](https://github.com/seunghyeon1004/claude-code-skillsets/issues).
Report security problems through
[GitHub private vulnerability reporting](https://github.com/seunghyeon1004/claude-code-skillsets/security/advisories/new).

## 한국어

### 데이터 처리

`shared-core`는 사람이 읽을 수 있는 `SKILL.md` 워크플로 지침 8개로 구성됩니다.
실행 가능한 설치 프로그램이나 네트워크 클라이언트가 없고, 프로젝트 텔레메트리나 계정
서비스를 운영하지 않으며, 프로젝트 상태를 영구 저장하지 않습니다. 계정 식별자,
자격 증명, 비밀 값, 대화 기록 또는 사용자 파일을 프로젝트 관리자에게 수집하거나
전송하지 않습니다.

이 플러그인은 외부 플러그인을 설치, 업데이트 또는 삭제하지 않습니다. 사용자는 Claude
Code 세션에 이미 있는 정보에 공용 코어 스킬을 적용할 수 있지만, 그 사용만으로 공용
코어가 정보를 이 프로젝트로 보내지는 않습니다.

사용자가 계획·검토 스킬을 따르면서 Claude Code 도구나 외부 공급자를 별도로 선택하면
그 도구 또는 공급자의 네트워크, 인증, 비용, 개인정보, 보관 및 삭제 정책이 적용됩니다.
검증하지 않은 공급자 동작은 `unknown`이며 이 정책의 적용 대상이 아닙니다.

### 삭제

Claude Code의 플러그인 관리 기능으로 `shared-core`를 제거하세요. 공용 코어는 별도의
영구 데이터 디렉터리, 프로젝트 텔레메트리 기록 또는 공급자 계정을 만들지 않습니다.
Claude Code나 외부 공급자가 보관한 데이터는 해당 제품의 정책에 따라 삭제해야 합니다.

공개 지원은
[GitHub Issues](https://github.com/seunghyeon1004/claude-code-skillsets/issues)를
사용하세요. 보안 문제는
[GitHub 비공개 취약점 신고](https://github.com/seunghyeon1004/claude-code-skillsets/security/advisories/new)로
제출하세요.
