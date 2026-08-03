# Skillset Manager Support / 스킬셋 관리자 지원

## English

Use [GitHub Issues](https://github.com/seunghyeon1004/claude-code-skillsets/issues)
for a reproducible manager packaging, setup preview, doctor, maintenance,
approval, receipt, dependency, or local-state problem. Include the operating
system, Claude Code and Node.js versions, `skillset-manager` version, invoked
skill, exact reproduction steps, and minimized expected and actual results. Do
not include a credential, token, secret, account identifier, private prompt,
environment value, unredacted absolute executable path, executable hash, or
unredacted user data. For Claude identity failures, report the normalized version
and whether path, realpath, hash, or version validation failed.

Do not put a suspected vulnerability in a public issue. Use
[GitHub private vulnerability reporting](https://github.com/seunghyeon1004/claude-code-skillsets/security/advisories/new).

This project can investigate the manager's plugin-owned index, consent and
approval boundaries, generated runtime, and state under
`~/.claude/claude-code-skillsets/state`. External plugin network,
authentication, billing, privacy, or service behavior belongs to that upstream
plugin or provider. Report those issues to the provider unless the manager
selected, disclosed, invoked, or recorded the plugin incorrectly.

See this package's [PRIVACY.md](PRIVACY.md) before sharing diagnostics or
deleting local records.

## 한국어

관리자의 패키징, setup 미리보기, doctor, maintenance, 승인, 영수증, 의존성 또는
로컬 상태 문제를 재현할 수 있다면
[GitHub Issues](https://github.com/seunghyeon1004/claude-code-skillsets/issues)를
사용하세요. 운영체제, Claude Code와 Node.js 버전, `skillset-manager` 버전,
실행한 스킬, 정확한 재현 단계 및 최소화한 기대·실제 결과를 포함하세요. 자격 증명,
토큰, 비밀 값, 계정 식별자, 비공개 prompt, 환경 변수 값, 삭제하지 않은 실행 파일
절대경로·hash 또는 사용자 데이터를 넣지 마세요. Claude 신원 오류는 정규화한 버전과
path, realpath, hash, version 중 어느 검증이 실패했는지만 보고하세요.

의심되는 취약점을 공개 이슈에 올리지 말고
[GitHub 비공개 취약점 신고](https://github.com/seunghyeon1004/claude-code-skillsets/security/advisories/new)를
사용하세요.

이 프로젝트는 관리자의 플러그인 소유 인덱스, 동의·승인 경계, 생성 runtime 및
`~/.claude/claude-code-skillsets/state`의 상태를 조사할 수 있습니다. 외부
플러그인의 네트워크, 인증, 결제, 개인정보 또는 서비스 동작은 해당 upstream
플러그인이나 공급자의 책임입니다. 관리자가 플러그인을 잘못 선택·공개·실행·기록한
경우가 아니라면 그 문제는 공급자에게 신고하세요.

진단 자료를 공유하거나 로컬 기록을 삭제하기 전에 이 패키지의
[PRIVACY.md](PRIVACY.md)를 확인하세요.
