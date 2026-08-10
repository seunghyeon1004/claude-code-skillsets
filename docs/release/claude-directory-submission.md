# Claude Plugin Directory Submission Draft / Claude 플러그인 디렉터리 제출 초안

> **DO NOT SUBMIT / 제출 금지:** This file is a review draft, not submission
> authority. Do not open the Shared Core form until the repository is public,
> the contact-display gate below is resolved, every gate passes against the
> exact public commit, and the user separately approves submission.
> 이 문서는 검토 초안이며 제출 권한이 아닙니다. 저장소가 공개되고 아래 연락처 표시
> 게이트가 해결되며 정확한 공개 커밋에서 모든 게이트가 통과하고 사용자가 제출을 별도로
> 승인하기 전에는 공용 코어 폼을 열거나 제출하지 마세요.

## Current Official Route / 현재 공식 경로

Anthropic documents one community-driven plugin directory for Cowork and Claude
Code. In Claude Code, that directory is surfaced as the official
`claude-plugins-official` marketplace. External authors submit a public GitHub
plugin link through an official in-app form: individual authors can use the
[Claude Console form](https://platform.claude.com/plugins/submit), while eligible
Team or Enterprise organization owners and directory managers can use the
[Claude.ai directory form](https://claude.ai/admin-settings/directory/submissions/plugins/new).

Anthropic은 Cowork와 Claude Code를 위한 하나의 community가 참여하는 plugin
directory를 안내합니다. Claude Code에서는 이 directory가 공식
`claude-plugins-official` marketplace로 노출됩니다. 외부 작성자는 공개 GitHub plugin
링크를 공식 in-app 폼으로 제출합니다. 개인 작성자는
[Claude Console 폼](https://platform.claude.com/plugins/submit)을 사용할 수 있고,
요건을 충족하는 Team 또는 Enterprise 조직 소유자와 directory manager는
[Claude.ai directory 폼](https://claude.ai/admin-settings/directory/submissions/plugins/new)을
사용할 수 있습니다.

Console login, organization access, legal acknowledgement, and final submission
are manual owner actions. Do not automate the terms checkbox or form submission.
The official route is the in-app or Console forms, not a GitHub pull request,
fork, or issue against the directory repository.

Console 로그인, 조직 접근, 법적 약관 동의 및 최종 제출은 소유자가 직접 수행해야
합니다. 약관 checkbox나 폼 제출을 자동화하지 마세요. 공식 제출 경로는 in-app 또는
Console 폼이며 directory 저장소를 향한 GitHub pull request, fork 또는 issue가
아닙니다.

### Live Form Reverification Gate / 실시간 폼 재확인 게이트

The official documentation confirms the public GitHub-link requirement,
`claude plugin validate`, account-role prerequisites, and the two signed-in form
routes. This guide does not claim a fixed list of required or optional form
fields. The owner must inspect the live form and current Directory Terms, and
the live form fields must be re-verified manually immediately before submission.

공식 문서는 공개 GitHub 링크 요구사항, `claude plugin validate`, 계정 역할 전제조건과
로그인이 필요한 두 폼 경로를 확인합니다. 이 가이드는 필수 또는 선택 폼 필드의 고정
목록을 주장하지 않습니다. 소유자는 제출 직전에 실제 폼과 당시 Directory Terms를
열어 현재 필드를 직접 다시 확인해야 합니다.

This project has not verified whether a contact address entered in the live form
is displayed publicly. Before any address is entered, require separate explicit
consent for possible public display, a user-approved public alias, or official
clarification from Anthropic that the selected address will not be displayed.

이 프로젝트는 실제 폼에 입력한 연락 주소가 공개 표시되는지 확인하지 않았습니다.
주소를 입력하기 전에 공개 표시 가능성에 대한 별도 명시적 동의, 사용자가 승인한
공개용 별칭, 또는 선택한 주소가 표시되지 않는다는 Anthropic의 공식 확인 중 하나가
필요합니다.

## Shared Core Submission Data Draft / 공용 코어 제출 데이터 초안

These labels are project preparation data, not a claim that every item is a live
form field. Copy only data requested by the re-verified live form. 아래 항목명은
프로젝트 준비 데이터이며 모두 실제 폼 필드라는 주장이 아닙니다. 재확인한 실제 폼이
요구하는 데이터만 입력합니다.

- Plugin name: `shared-core`
- Repository URL: `https://github.com/seunghyeon1004/claude-code-skillsets`
- Repository subpath: `plugins/shared-core`
- Supported platform: `Claude Code only`
- License: `Apache-2.0`
- Homepage: `https://github.com/seunghyeon1004/claude-code-skillsets/tree/main/plugins/shared-core#readme`
- Privacy URL: `https://github.com/seunghyeon1004/claude-code-skillsets/blob/main/plugins/shared-core/PRIVACY.md`
- Public support evidence (not a form field): `https://github.com/seunghyeon1004/claude-code-skillsets/blob/main/plugins/shared-core/SUPPORT.md`
- Contact email: not selected; resolve the contact-display gate before entering an address
- 연락 이메일: 미선택 상태이며 주소 입력 전에 연락처 표시 게이트를 해결해야 합니다.

### English Description

Eight human-readable Claude Code workflow skills for turning ambiguous requests
into scoped briefs, establishing workspace context, separating overlapping
already-proposed workstreams inside one defined request, planning checkpoints,
reviewing privacy and permissions, tracking provenance, verifying quality, and
preserving handoffs. The workflow router does not discover or select external
components.
The plugin has no installer or executable network client, writes no persistent
project state, and collects no project telemetry, accounts, or secrets.

### 한국어 설명

모호한 요청을 범위가 정해진 brief로 바꾸고, workspace context를 확립하며, 하나의
정해진 요청 안에 이미 제안된 workstream의 겹치는 책임을 분리하고, checkpoint를
계획하고, 개인정보·권한과 근거를 검토하고, 품질을 검증하며, handoff를 보존하는
사람이 읽을 수 있는 Claude Code workflow 스킬 8개입니다. workflow router는 외부
component를 발견하거나 선택하지 않습니다. 설치 프로그램이나 실행 가능한 네트워크
클라이언트가 없고 영구 프로젝트 상태를 쓰지 않으며 프로젝트 텔레메트리, 계정 또는
비밀 값을 수집하지 않습니다.

### Working Use Cases / 실제 사용 사례

1. `/shared-core:intent-to-brief Turn this broad repository request into a brief that labels confirmed facts, assumptions, open questions, and completion evidence.`
2. `/shared-core:risk-privacy-permissions Review this planned support-log disclosure, minimize personal data and permissions, and identify the exact approval point.`
3. `/shared-core:quality-verification Build a verification matrix for this release and distinguish fresh evidence from unverified claims.`

1. `/shared-core:intent-to-brief 이 넓은 저장소 요청을 확인된 사실, 가정, 열린 질문, 완료 근거로 구분한 brief로 바꿔줘.`
2. `/shared-core:risk-privacy-permissions 이 지원 로그 공개 계획의 개인정보와 권한을 최소화하고 정확한 승인 지점을 정해줘.`
3. `/shared-core:quality-verification 이 릴리스의 검증 matrix를 만들고 최신 근거와 미검증 주장을 구분해줘.`

### Honest Disclosure / 과장 없는 공개 문구

Shared Core is instructional software. It does not add marketplaces, execute an
installer, or install, update, or remove external plugins. Its skills may help a
user plan work that later uses other tools, but those tools are selected and
governed separately. It has been tested for Claude Code only; Cowork support is
not claimed.

공용 코어는 지침형 소프트웨어입니다. 마켓플레이스를 추가하거나 설치 프로그램을
실행하지 않으며 외부 플러그인을 설치, 업데이트 또는 제거하지 않습니다. 스킬은 이후
다른 도구를 사용하는 작업을 계획하는 데 도움을 줄 수 있지만 그 도구는 별도로
선택되고 관리됩니다. Claude Code에서만 검증했으며 Cowork 지원은 주장하지 않습니다.

### Semantic RC Evidence And Waiver Disclosure / Semantic RC 근거와 면제 공개

The exact submission candidate must use one and only one Stage 3 disposition: either
the full exact-SHA semantic RC passed, or the user approved a manual exact-SHA owner
waiver after the protected public remote `main` final SHA was confirmed. The manual
waiver creates no local waiver receipt or verifier and is not a pass.

정확한 제출 후보는 Stage 3 처리 방식 하나만 사용해야 합니다. 전체 exact-SHA semantic
RC가 통과했거나, 보호된 public remote `main`의 최종 SHA가 확정된 뒤 사용자가 수동
exact-SHA owner waiver를 승인한 경우 중 하나입니다. 수동 waiver는 로컬 waiver 영수증이나
verifier를 만들지 않으며 통과가 아닙니다.

For the manual waiver, the repository README, release body, and submission-visible
description or disclosure field must contain this exact sentence:

> Full exact-SHA semantic RC was not run; semantic coverage is not proven; release proceeds under an explicit owner waiver.

수동 waiver를 사용하는 경우 repository README, release body와 제출 화면의 설명 또는 공개
필드에 위 영문 문장을 그대로 표시해야 합니다. 이 owner attestation은 알려진 실패가
없다는 역사적 부재를 기계적으로 증명하지 않으며, 알려진 실패를 삭제하거나 숨긴 뒤
사용하면 안 됩니다.

## CURRENT POLICY HOLD - DO NOT SUBMIT: Skillset Manager

`skillset-manager` is not a Claude plugin directory submission candidate under the
current policy reading. Do not open or submit a form for it, do not describe it
as community-listed, approved, verified, or endorsed, and do not treat owner risk
acceptance as authority to waive a directory requirement. This is this project's
conservative compliance decision, not a claim that Anthropic has formally
rejected the plugin.

현재 정책 해석에서 `skillset-manager`는 Claude plugin directory 제출 후보가 아닙니다.
폼을 열거나 제출하지 말고, community 등재, 승인, 검증 또는 보증을 받았다고 표현하지
마세요. 소유자의 위험 수용을 directory 요구사항을 면제하는 권한으로 취급해서도 안
됩니다. 이는 이 프로젝트의 보수적 준수 결정이며 Anthropic이 플러그인을 공식
거절했다는 주장이 아닙니다.

### Section 2.D And Section 2.F / 2.D와 2.F 구분

Directory Policy Section 2.D permits an instructional plugin to call external
software when that call is requested and intended by the user. The manager's
separate risk acknowledgement and exact execution approval are designed to
satisfy that user-intent boundary.

Section 2.F separately says instructional software must not direct Claude to
dynamically pull behavioral instructions from external sources for Claude to
execute. The manager selects an external plugin at runtime and directs Claude to
invoke native `claude plugin install` for that plugin. Exact approval, a bounded
local index, and use of the native marketplace path do not create an exception
in Section 2.F. The manager therefore stays on hold while that behavior exists.

Directory Policy 2.D는 사용자가 요청하고 의도한 경우 지침형 플러그인이 외부
소프트웨어를 호출할 수 있게 합니다. 관리자의 별도 위험 인지와 정확한 실행 승인은 이
사용자 의도 경계를 충족하도록 설계되었습니다.

2.F는 별도로 Claude가 실행할 행동 지침을 외부 소스에서 동적으로 가져오도록 지시하면
안 된다고 규정합니다. 관리자는 runtime에서 외부 플러그인을 선택하고 native
`claude plugin install`을 호출하도록 Claude에 지시합니다. 정확한 승인, 제한된 로컬
인덱스 및 native marketplace 경로는 2.F의 예외가 아닙니다. 이 동작이 존재하는 동안
관리자는 제출 보류 상태를 유지합니다.

The manager's same-marketplace static dependency on `shared-core` is different.
It is a named, manifest-declared dependency known before installation and uses
Claude Code's documented dependency resolver. It is not the reason for this
hold. When the manager is installed from the author's marketplace, that resolver
installs the `shared-core` entry from the same author-owned marketplace.

관리자의 `shared-core` same-marketplace static dependency는 다릅니다. 설치 전에
이름과 manifest 선언이 정해져 있고 Claude Code의 공식 dependency resolver를
사용하므로 이번 보류의 원인이 아닙니다. 관리자를 작성자 marketplace에서 설치하면
resolver는 같은 작성자 소유 marketplace의 `shared-core` entry를 설치합니다.

### Current Distribution / 현재 유통 경로

Distribute `skillset-manager` only through the author-owned GitHub marketplace:

```sh
claude plugin marketplace add seunghyeon1004/claude-code-skillsets --scope user
claude plugin install skillset-manager@claude-code-skillsets --scope user
```

Current verified Claude Code version: `2.1.198`. This is evidence for the tested
manager path at the audited commit, not a minimum version, compatibility range,
or promise about a future release. 현재 검증한 Claude Code 버전은 `2.1.198`입니다.
이는 감사한 commit의 manager 경로에 대한 근거일 뿐 최소 버전, 호환 범위 또는 향후
release에 대한 약속이 아닙니다.

This independent distribution is not a `claude-plugins-official` directory
listing. A future directory listing of `shared-core` would not list or approve
`skillset-manager`.
The manager must retain its external-plugin, local-state, unknown-provider, and
separate-approval disclosures in its own marketplace documentation.

`skillset-manager`는 위 작성자 소유 GitHub marketplace에서만 유통합니다. 이는
`claude-plugins-official` directory 등재가 아닙니다. 나중에 `shared-core`가 directory에 등재되어도
`skillset-manager`가 등재되거나 승인되는 것은 아닙니다. 관리자의 자체 marketplace
문서에는 외부 플러그인, 로컬 상태, 알 수 없는 공급자 동작 및 별도 승인 공개를
유지해야 합니다.

### Reconsideration Conditions / 재검토 조건

Reconsider a manager submission only when at least one of these conditions is
met, then rerun the complete policy and technical review from a new exact commit:

1. The policy text changes, or Anthropic provides a written determination that
   this exact native external-plugin installation design complies with Section 2.F.
2. The manager is redesigned so it never directs Claude to install or otherwise
   dynamically pull an external plugin's behavioral instructions.

Even after either condition, review whether a recommendation broker could exist
primarily as an advertising or promotional vehicle under the then-current policy.
Do not reuse this hold decision as proof of future eligibility.

다음 중 하나가 충족된 뒤 새로운 정확한 commit에서 정책 및 기술 검토 전체를 다시
수행해야만 관리자 제출을 재검토합니다.

1. 정책 문구가 바뀌거나 Anthropic이 이 정확한 native 외부 플러그인 설치 설계가
   2.F를 준수한다고 서면으로 판단합니다.
2. 관리자가 Claude에 외부 플러그인 설치 또는 외부 행동 지침의 동적 취득을 지시하지
   않도록 다시 설계됩니다.

어느 조건이 충족되어도 추천 broker가 당시 정책상 주로 광고 또는 홍보 수단으로
존재하는지 다시 검토해야 합니다. 이번 보류 결정을 미래 적격성의 증거로 재사용하지
마세요.

## Shared Core Policy Review / 공용 코어 정책 검토

Shared Core has no installer, external network client, dynamic instruction pull,
or paid-placement mechanism. Before submission, review its broad workflow trigger
descriptions for confusion or conflict with other directory software and narrow
them if necessary. This check applies only to the Shared Core form.

공용 코어에는 설치 프로그램, 외부 네트워크 클라이언트, 동적 지침 취득 또는 유료 배치
기능이 없습니다. 제출 전 넓은 workflow trigger 설명이 다른 directory software와
혼동이나 충돌을 일으키지 않는지 검토하고 필요하면 좁히세요. 이 검토는 공용 코어
폼에만 적용됩니다.

## Submission Gates / 제출 게이트

Every item must pass before the single Shared Core form is submitted:

- [ ] The exact repository commit is public and anonymously cloneable.
- [ ] Stage 3 has exactly one candidate-bound disposition: either the full semantic RC
      passed, or the manual exact-SHA owner waiver was approved after the protected
      public remote `main` final SHA was confirmed.
- [ ] For a manual waiver, the repository README, release body, and submission-visible
      description contain the exact disclosure above.
- [ ] GitHub Release `v0.1.0`, its lightweight tag, exact body, and protected `main`
      all resolve to the same approved SHA.
- [ ] The standalone post-release inventory in the release runbook passed freshly and
      unmodified immediately before opening this submission.
- [ ] Clean-environment marketplace add and the `shared-core` install identity and
      load checks pass against that exact commit.
- [ ] The three documented use cases map to actual named skills. They are
      illustrative examples, not execution evidence, and are not claimed to have
      run or passed without separate candidate-bound evaluation evidence for each
      exact prompt.
- [ ] `claude plugin validate plugins/shared-core --strict` passes.
- [ ] Homepage, privacy, support, license, and security-reporting URLs are public
      and usable without maintainer credentials.
- [ ] `shared-core` is still an available name in the live
      `claude-plugins-official` marketplace.
- [ ] Before any address is entered, the owner gives separate explicit consent
      for its possible public display, approves a public alias, or obtains
      official clarification from Anthropic that the selected address will not
      be displayed.
- [ ] The owner reviews the Software Directory Terms and manually accepts them.
- [ ] The Shared Core trigger review above is complete.
- [ ] The user gives a separate final approval to submit `shared-core`.
- [ ] No form for `skillset-manager` is opened or submitted.

공용 코어 폼 하나를 제출하기 전에 모든 항목이 통과해야 합니다.

- [ ] 정확한 저장소 커밋이 공개되어 있고 인증 없이 clone할 수 있습니다.
- [ ] Stage 3은 전체 semantic RC 통과 또는 보호된 public remote `main`의 최종 SHA 확정
      뒤 승인된 수동 exact-SHA owner waiver 중 하나만 사용합니다.
- [ ] 수동 waiver를 사용하면 repository README, release body와 submission-visible 설명에
      위 정확한 공개 문장이 포함됩니다.
- [ ] GitHub Release `v0.1.0`, lightweight tag, 정확한 body와 보호된 `main`이 모두 같은
      승인 SHA를 가리킵니다.
- [ ] 릴리스 runbook의 독립 post-release inventory를 이 제출 직전에 수정 없이 새로
      실행하여 통과했습니다.
- [ ] 동일 커밋의 깨끗한 환경에서 marketplace 추가와 `shared-core` 설치 identity 및
      load 검사가 통과합니다.
- [ ] 문서화된 사용 사례 3개가 실제 이름 있는 스킬에 연결됩니다. 이들은 실행 근거가
      아닌 설명용 예시이며, 각 exact prompt에 대한 별도의 candidate-bound 평가 근거가
      없으면 실행 또는 통과했다고 주장하지 않습니다.
- [ ] `shared-core`의 strict validation이 통과합니다.
- [ ] homepage, privacy, support, license 및 보안 신고 URL을 관리자 인증 없이 사용할
      수 있습니다.
- [ ] live `claude-plugins-official` marketplace에서 `shared-core` 이름을 여전히
      사용할 수 있습니다.
- [ ] 주소를 입력하기 전에 소유자가 공개 표시 가능성에 별도로 명시적으로 동의하거나,
      공개용 별칭을 승인하거나, 선택한 주소가 표시되지 않는다는 Anthropic의 공식
      확인을 받습니다.
- [ ] 소유자가 Software Directory Terms를 검토하고 직접 동의합니다.
- [ ] 위 공용 코어 trigger 검토가 완료되었습니다.
- [ ] 사용자가 `shared-core` 제출을 별도로 최종 승인합니다.
- [ ] `skillset-manager` 폼을 열거나 제출하지 않습니다.

## After Submission / 제출 후

Review timing varies with queue volume. Do not treat form submission as approval
or proof that installation is available. After publication, updates pushed to
the submitted public GitHub repository are picked up automatically and screened;
the official documentation says authors do not need to re-submit the form for
updates. Keep the public default branch releasable, bump explicit plugin versions
for user-visible updates, monitor support and security reports, and maintain
ongoing compliance. Anthropic may decline or later remove a plugin.

검토 기간은 대기열에 따라 달라집니다. 폼 제출을 승인이나 설치 가능성의 증거로
취급하지 마세요. 게시된 뒤 제출한 공개 GitHub 저장소에 push한 업데이트는 자동으로
반영되고 screening을 거치며, 공식 문서는 업데이트 때 폼을 다시 제출할 필요가 없다고
안내합니다. 공개 default branch를 항상 release 가능한 상태로 유지하고, 사용자에게
보이는 업데이트에는 명시적 plugin version을 올리며, 지원·보안 신고와 지속적인 정책
준수를 관리해야 합니다. Anthropic은 플러그인을 거절하거나 이후 제거할 수 있습니다.

## Official References / 공식 근거

- [Submitting your plugin](https://claude.com/docs/plugins/submit)
- [Claude Code Plugins Directory](https://github.com/anthropics/claude-plugins-official)
- [Anthropic Software Directory Policy](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy)
- [Anthropic Software Directory Terms](https://support.claude.com/en/articles/13145338-anthropic-software-directory-terms)
- [Plugin dependencies](https://code.claude.com/docs/en/plugin-dependencies)
