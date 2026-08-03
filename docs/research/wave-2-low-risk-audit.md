# 2차 저위험 후보 정적 감사

- 감사일: 2026-07-30
- 기준 브랜치: `release/public-candidate`
- 공개 기준: 이 감사의 비공개 개발 기준선은 공개 이력에 포함하지 않는다.
- 범위: 아래 5개 upstream의 12개 후보 경로
- 방법: exact commit checkout 뒤 Markdown, YAML/JSON frontmatter, 참조 파일, Python 소스를 읽기만 했다. 후보를 설치하거나 후보 코드, 스크립트, 빌드, 테스트, 예제 명령을 실행하지 않았다.

## 결론

| 판정 | 수 | 의미 |
| --- | ---: | --- |
| `eligible-for-independent-review` | 3 | 정적 감사에서 즉시 차단 사유를 찾지 못했다. 설치 승인이나 안전 인증이 아니며 별도 독립 리뷰가 필요하다. |
| `held` | 8 | bounded capability는 식별했지만 권한, 의존성, 민감 데이터 또는 고위험 결과물 때문에 기본 경로에서 보류한다. |
| `blocked` | 1 | 현재 upstream 단위는 저위험 기본 경로와 구조적으로 맞지 않는다. |

통과 후보는 `kepano/obsidian-skills`의 세 경로뿐이다. 이 결과는 어떤 대분류나 broad profile도 완결한다는 뜻이 아니다. 세 후보를 묶어도 Obsidian 형식의 로컬 문서 편집 일부만 담당한다.

## 소스 및 라이선스 고정

| upstream | exact commit | 라이선스 | 라이선스 blob |
| --- | --- | --- | --- |
| `microsoft/skills` | [`4a2873faffc1b101a33a0b59c24713d4ed78142f`](https://github.com/microsoft/skills/commit/4a2873faffc1b101a33a0b59c24713d4ed78142f) | MIT, Microsoft Corporation | [`79656060de00aa4659ad2c276d5be8830664d544`](https://github.com/microsoft/skills/blob/4a2873faffc1b101a33a0b59c24713d4ed78142f/LICENSE) |
| `trailofbits/skills` | [`ca08fc8a91f64d80b00d48597907c579d0a85c6f`](https://github.com/trailofbits/skills/commit/ca08fc8a91f64d80b00d48597907c579d0a85c6f) | CC BY-SA 4.0 | [`3b7b82d0da2db857eda1a798dbd908ea136f07b5`](https://github.com/trailofbits/skills/blob/ca08fc8a91f64d80b00d48597907c579d0a85c6f/LICENSE) |
| `K-Dense-AI/scientific-agent-skills` | [`ab2f84ab10597c59fac186ecda6d5edd5dcc8b92`](https://github.com/K-Dense-AI/scientific-agent-skills/commit/ab2f84ab10597c59fac186ecda6d5edd5dcc8b92) | MIT, K-Dense Inc. | [`eb246475fd5a66b9bb56176f3a718984632dd98d`](https://github.com/K-Dense-AI/scientific-agent-skills/blob/ab2f84ab10597c59fac186ecda6d5edd5dcc8b92/LICENSE.md) |
| `kepano/obsidian-skills` | [`a1dc48e68138490d522c04cbf5822214c6eb1202`](https://github.com/kepano/obsidian-skills/commit/a1dc48e68138490d522c04cbf5822214c6eb1202) | MIT, Steph Ango | [`33d692ee84f4464f575f2d1e927f19cf1c8ccc57`](https://github.com/kepano/obsidian-skills/blob/a1dc48e68138490d522c04cbf5822214c6eb1202/LICENSE) |
| `OneWave-AI/claude-skills` | [`27f8cdcea225e627a73de89b9a3d477af9e249da`](https://github.com/OneWave-AI/claude-skills/commit/27f8cdcea225e627a73de89b9a3d477af9e249da) | MIT, OneWave AI | [`ba9bc7348e3eeecac945972be16ccc1a6dd22f3d`](https://github.com/OneWave-AI/claude-skills/blob/27f8cdcea225e627a73de89b9a3d477af9e249da/LICENSE) |

라이선스 이름만으로 통과시키지 않았다. 경로 단위 패키징에서 루트 라이선스가 빠질 수 있으므로, 향후 세 통과 후보를 연결할 때도 **루트 저장소 + exact SHA + exact `skills` 경로**를 사용하고 카탈로그에 저작권과 라이선스를 노출해야 한다. 라이선스 파일이 제외되는 `git-subdir` 단독 포장은 독립 리뷰에서 다시 확인하기 전에는 쓰지 않는다.

## 경로별 판정과 blob identity

`tree`는 exact commit에서 후보 디렉터리의 Git tree object이고, `entry blob`은 `SKILL.md` 또는 플러그인 manifest의 Git blob이다.

| 후보 경로 | tree | entry blob | 판정 | bounded capability |
| --- | --- | --- | --- | --- |
| `microsoft/skills/.github/plugins/deep-wiki` | `c6a14efb1c2e915ccc8ad75452efb407dd4f39db` | `62f7f4b790879186f19cbe88efb7a31bd9176146` (`plugin.json`) | `blocked` | 로컬 코드 저장소를 읽어 wiki와 파생 문서를 만드는 전체 플러그인 |
| `trailofbits/skills/plugins/insecure-defaults` | `b5ad58ed99008e16363cca5a51fa5cea40673cd7` | `4516c901956f76faa9f98e82e2555e731ee0bad9` | `held` | 소스와 설정에서 fail-open 기본값 후보를 찾아 정적 근거를 보고 |
| `K-Dense-AI/scientific-agent-skills/skills/statistical-analysis` | `8184a536c3b26ccb8b447735cc4e35d05b66b991` | `ac1caa3fb0a6c94ae572a58ae7589bcb5af21b97` | `held` | 사용자가 제공한 연구 데이터의 통계 검정, 진단, 효과크기 및 보고 보조 |
| `K-Dense-AI/scientific-agent-skills/skills/statistical-power` | `41e5f089d617c7ddab71abb97f08bd69e5f7eb6e` | `2657bc2b4cd0a6fc38ff6705588e9985198b5284` | `held` | 연구 설계의 표본수, 검정력, MDE 계산 보조 |
| `K-Dense-AI/scientific-agent-skills/skills/experimental-design` | `1113781edec1e917bba17f1800664d7b364bd624` | `44c17b75391bc27e4fe575e61d175bb49c8485e4` | `held` | 무작위화, 블로킹, DOE 배치 설계 보조 |
| `kepano/obsidian-skills/skills/obsidian-markdown` | `4723197c6dc59abc29819da87863b1ac20b96095` | `bca51a429c020a4cb6740a917517116e66d428b1` | `eligible-for-independent-review` | 사용자가 지정한 로컬 `.md`를 Obsidian 문법으로 작성 또는 편집 |
| `kepano/obsidian-skills/skills/obsidian-bases` | `f3330f27de4d7907ead57d0f48672f4d3280bb77` | `e857041265fb8ac9f6f7c6606f2dbc762c45a91d` | `eligible-for-independent-review` | 사용자가 지정한 로컬 `.base` YAML을 작성, 편집, 구문 검토 |
| `kepano/obsidian-skills/skills/json-canvas` | `9df7971db7ffebf96f2a207840b9f4765aa11b04` | `8fb2c9de2bbba52b53ca243fbfdab650ee61711c` | `eligible-for-independent-review` | 사용자가 지정한 로컬 `.canvas` JSON을 작성, 편집, 구조 검토 |
| `OneWave-AI/claude-skills/cowork-sop-writer` | `35a050351acda9d3341a1ea3781ef8b12d56194a` | `b01a408e7e545fc9db13ce083c796fd98d79b0be` | `held` | 사용자 제공 절차 자료를 로컬 SOP 초안으로 변환 |
| `OneWave-AI/claude-skills/cash-flow-forecaster` | `ec6f325a708e6568a65a3fc89f7c8a0c8e717b1c` | `d8a0fc0d1ad73badddd07f53594737314c91d1b6` | `held` | 사용자 제공 재무 자료로 13주 현금흐름 초안을 작성 |
| `OneWave-AI/claude-skills/hiring-scorecard` | `a4023ca4c2a90e2979250ac7a822d08e10f408f8` | `023e838d78313c31622b712822001696143380a4` | `held` | 사용자 제공 직무 정보로 채용 평가표 초안을 작성 |
| `OneWave-AI/claude-skills/meeting-to-tasks` | `823e52ac0b378c3de80476f2342272ba5e30eaac` | `59031aea13a47fc684ebf0564ed7d73004d66408` | `held` | 사용자 제공 회의록에서 로컬 요약, 작업, 후속 메일 초안을 작성 |

## 상세 근거

### 1. Microsoft `deep-wiki`: `blocked`

- 한 기능이 아니라 13개 slash command, 3개 subagent, 자동 호출 가능한 skill 10개가 함께 활성화되는 플러그인이다. manifest에는 commands, agents, skills의 도구 권한을 제한하는 경계가 없다.
- `generate`, `crisp`, `build`, `deploy`, `agents`, `llms`, `ado`는 대상 저장소에 wiki, `AGENTS.md`, `CLAUDE.md`, Node 스크립트, `package.json`, lockfile, GitHub Actions workflow 등을 쓴다. 문서에는 `npm install`, `npm run`, `git add`, `git commit`, `git push`까지 후속 절차로 제시된다.
- 소스, README, 설정, CI/CD를 폭넓게 읽고 일부 결과를 `llms-full.txt`나 공개 Pages workflow로 연결한다. 비밀값을 전역적으로 탐지·마스킹하는 경계와, 저장소 텍스트를 명령이 아닌 불신 데이터로 취급하는 prompt-injection 경계가 없다.
- 네트워크 코드는 번들되지 않았지만 Git remote/URL을 해석하고 GitHub Pages 및 npm 공급망을 연결한다. 설치 후 자동 실행 코드는 없으나 broad description의 skills는 작업 맥락에서 자동 호출될 수 있다.
- 플러그인 디렉터리 자체는 독립 manifest를 가져 패키지 경계는 닫혀 있다. 문제는 경로 누락이 아니라 전체 기능의 권한과 부작용 범위다.
- `wiki-qa`나 `wiki-researcher`만 exact skill path로 떼는 방안도 이번에는 통과시키지 않는다. 두 entry에도 명시적 read-only tool 경계와 untrusted-repository-content 경계가 없다. upstream에 해당 경계가 생긴 별도 경로가 나오면 새 SHA에서 다시 감사한다.
- 한국어 전용 출력 또는 한국어 QA 규칙은 없다. 모델이 한국어로 답할 수 있다는 일반 능력을 호환성 증거로 간주하지 않는다.

### 2. Trail of Bits `insecure-defaults`: `held`

- `SKILL.md`와 `references/examples.md`의 상대 참조는 후보 디렉터리 안에서 닫힌다. 번들 스크립트, 외부 패키지, 네트워크 호출 지시는 없다.
- frontmatter가 `Read Grep Glob Bash`를 허용한다. 본문은 정적 code-path 추적을 말하지만 “실제로 앱이 시작되는가” 같은 검증 질문도 있어 Bash로 대상 코드를 실행하지 않는다고 보장할 수 없다.
- 비밀·API key·credential을 의도적으로 검색하면서 보고 예시는 원문 값을 그대로 싣는다. 실제 비밀값을 마스킹하라는 규칙이 없다. 악성 주석이나 문서 문자열을 불신 데이터로 취급하라는 prompt-injection 규칙도 없다.
- CC BY-SA 4.0은 금지 라이선스가 아니지만, 수정·분할 사본을 만들면 attribution과 share-alike 의무를 따로 관리해야 한다.
- 저위험 split은 `Read/Grep/Glob`만 허용하고, 실행 없이 위치·데이터흐름·마스킹된 근거만 보고하는 형태다. 그러나 그 split은 이 exact pin에 독립 upstream 경로로 존재하지 않는다. 중계자가 내용을 복사해 파생 skill을 만들지 않으므로 현재 경로는 보류한다.
- 자동 호출을 끄는 frontmatter는 없고 description은 일반 보안 감사까지 넓게 잡는다. 한국어 전용 규칙도 없다.

### 3. K-Dense 통계 3종: 모두 `held`

- 세 디렉터리의 `references/`와 총 5개 Python 스크립트는 각 skill 안에서 닫혀 있고 symlink/submodule은 없다. 스크립트에서 네트워크, subprocess, shell 실행, 비밀값 접근은 발견하지 못했다.
- `statistical-analysis`는 `numpy`, `pandas`, `scipy`, `matplotlib`, `seaborn`, 선택적으로 `statsmodels`를 import한다. `statistical-power`는 `statsmodels`, `scipy`, `numpy`, `matplotlib`, `pandas`와 선택적으로 `lifelines`를 사용한다. `experimental-design`은 `numpy`, `pandas`, `pyDOE3`를 사용한다.
- SKILL 본문은 `uv pip install`을 지시하며 일부 의존성은 범위만 있고 완전 pin이 아니다. `statistical-power`와 `experimental-design`은 `Read Write Edit Bash`를 허용하고, `statistical-analysis`는 스크립트 실행을 지시하면서도 `allowed-tools` 경계가 없다.
- 세 skill 모두 `${CLAUDE_SKILL_DIR}`를 사용하지 않고 “skill directory에서 실행하거나 `scripts/`를 `sys.path`에 추가”하라고 한다. 일반 프로젝트 cwd에서 상대 import가 안정적으로 후보 패키지에 닫힌다는 보장이 없다.
- `power.py`는 요청 시 plot 파일을 저장하고, 가정 진단은 plotting을 수행한다. 나머지 main block은 예제 계산을 수행한다. 설치나 실행을 이번 감사에서 하지 않았으므로 실제 수치 정확도와 버전 호환성은 검증하지 않았다.
- 표본수, IRB, 임상·실험 배치에 영향을 줄 수 있는 고위험 결과다. 데이터 최소화, 비식별화, 전문가 검토, 결과 재현 receipt가 기본 경계로 고정돼 있지 않다. 외부 web ingestion은 지시하지 않지만 로컬 연구 데이터의 민감성을 다룬다.
- broad description 때문에 자동 호출 범위가 넓고, 한국어 입력·보고 형식에 대한 별도 검증은 없다. scripts/의 없는 advisory-only split은 upstream 경로가 아니므로 이번 후보로 만들지 않는다.

### 4. Kepano Obsidian 3종: `eligible-for-independent-review`

- 각 경로는 `SKILL.md`와 자기 디렉터리의 `references/`만 참조한다. 상위 상대경로, `${CLAUDE_SKILL_DIR}`, 스크립트, 실행 파일, 외부 패키지, shell 명령, 네트워크 fetch 지시, 환경변수·비밀값 접근이 없다.
- 외부 URL은 Obsidian/JSON Canvas 사양 참고 링크와 예시 데이터일 뿐 자동 수집 지시가 아니다. symlink/submodule도 없다.
- side effect는 사용자가 지정한 로컬 `.md`, `.base`, `.canvas`의 작성·편집이다. `json-canvas`는 JSON parse와 node/edge 참조 검증, `obsidian-bases`는 YAML 구문 확인, `obsidian-markdown`은 Obsidian 문법 적용으로 범위가 제한된다.
- frontmatter에 `allowed-tools`와 `disable-model-invocation`은 없다. 다만 description이 Obsidian 및 해당 확장자 작업으로 좁다. 독립 리뷰에서는 “사용자가 지정한 경로만 수정”, overwrite 전 diff/승인, 불신 note content를 명령으로 따르지 않기, 원격 URL을 fetch하지 않기를 설치 조건으로 확인해야 한다.
- 모든 문서는 영어다. Markdown/YAML/JSON 형식 자체는 한국어 텍스트를 담을 수 있지만, 한국어 문장 품질이나 Obsidian 한국어 사용 사례는 이번 정적 감사가 보증하지 않는다.
- 권장 패키징은 root GitHub source를 exact SHA에 pin하고 `strict:false`의 exact skills 경로만 노출하는 방식이다. 세 skill을 하나로 묶어 자동 설치하거나 Obsidian 이외 기능을 주장해서는 안 된다.

### 5. OneWave 4종: 모두 `held`

- 네 경로에는 실행 스크립트, 외부 패키지, 네트워크 호출, 환경변수 접근이 없다. `hiring-scorecard`와 `meeting-to-tasks`의 `references/`도 각 디렉터리 안에서 닫히며 symlink/submodule은 없다.
- 네 SKILL 모두 `allowed-tools`가 아니라 `tools` 키를 쓴다. 이 키가 현재 Claude Code에서 권한 제한으로 집행된다는 증거를 이번 정적 감사에서 확보하지 않았으므로 선언된 도구 목록을 안전 경계로 인정하지 않는다. `cowork-sop-writer`, `cash-flow-forecaster`, `meeting-to-tasks`는 불필요해 보이는 Bash까지 선언한다.
- `cowork-sop-writer`는 transcript와 문서 폴더, `meeting-to-tasks`는 HR·개인·기밀 회의록, `cash-flow-forecaster`는 계좌·AR/AP·급여, `hiring-scorecard`는 채용 판단 자료를 읽는다. 로컬 출력이지만 민감 정보 최소화·보관·삭제 정책과 untrusted-input prompt-injection 경계가 없다.
- `cash-flow-forecaster`는 생존 가능성에 관한 재무 전망을 만들고 `.xlsx` 입력도 주장하지만 파서·계산 receipt·전문가 검토 경계가 없다. `hiring-scorecard`는 anti-bias와 법률 주의를 포함하지만 점수 임계값이 채용 결정에 영향을 줄 수 있다. 둘은 정확성만으로 저위험이 되지 않는다.
- `meeting-to-tasks`는 요청하지 않아도 follow-up email을 항상 생성하라고 하지만 실제 전송 지시는 없다. 외부 서비스 업로드·발송은 bounded capability 밖이며 허용하면 안 된다.
- 자동 호출을 끄는 frontmatter는 없고, 한국어 전용 규칙도 없다. 독립 upstream에서 표준 `allowed-tools`, Bash 제거, 민감 데이터와 prompt-injection 경계를 제공하기 전에는 기본 설치 후보로 올리지 않는다.

## 독립 리뷰로 넘길 정확한 범위

다음 세 경로만 다음 단계 입력이다. 이 문서 자체는 설치나 카탈로그 eligibility 변경을 승인하지 않는다.

1. `kepano/obsidian-skills@a1dc48e68138490d522c04cbf5822214c6eb1202:skills/obsidian-markdown`
2. `kepano/obsidian-skills@a1dc48e68138490d522c04cbf5822214c6eb1202:skills/obsidian-bases`
3. `kepano/obsidian-skills@a1dc48e68138490d522c04cbf5822214c6eb1202:skills/json-canvas`

독립 리뷰는 exact tree/blob identity, root MIT license 보존, `strict:false` exact-path 패키징, 설치 전 preview, 사용자 지정 로컬 경로만 수정, 네트워크 없음, diff/approval 경계를 다시 확인해야 한다. 어떤 profile도 이 세 경로만으로 완결됐다고 표시해서는 안 된다.
