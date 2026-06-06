\# Duel of Fate Development Rules



\## Commands

\- Lint: `npm.cmd run lint`

\- Build: `npm.cmd run build`

\- Dev: `npm.cmd run dev`



\## Workflow

\- Before editing, run `git status --short`.

\- If the working tree is dirty, stop and report.

\- After editing, run lint, build, `git status --short`, and `git diff --stat`.

\- Never run `git commit` unless explicitly requested.



\## Stable Systems

Do not change unrelated stable systems:

\- Base rock-paper-scissors resolution

\- Home/away rotation

\- Player pass-defense action

\- Shared deck recycle flow

\- Challenge stage freeze flow

\- Environment rotation

\- Existing deity abilities

\- Quick-match rules

\- AI hidden-information isolation



\## Scope

\- Only edit files required by the current task.

\- Avoid large refactors.

\- Report modified files and validation results.

