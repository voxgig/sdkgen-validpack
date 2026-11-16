# Workflow patch

GitHub refuses a change under `.github/workflows/` pushed by a token without
the `workflow` scope, and a session's token has none. So the workflow is here
as a patch, for a maintainer to apply.

**A `patch/` folder means one thing: work nobody has applied yet.** Apply
it, then delete the folder. Applied, the file only repeats the history it
made.


## Applying it

```sh
git switch main && git pull --ff-only
git am patch/build-workflow.patch
git rm -r -q patch
git commit -m "patch: the build workflow is applied"
git push                  # with a token that has the workflow scope
```

The patch was cut from the commit before this folder was added. It touches
three files, none of which this folder's commit changes, so it applies to
`main` once the branch that carries it has merged.


## What it holds

| Patch | What it does | Checked |
| --- | --- | --- |
| `build-workflow.patch` | Adds `.github/workflows/build.yml`. On a push to `main`, a pull request, a daily schedule and on demand, it installs, then runs `npm test`, the comment gate's own tests, and sdkgen's package check. Two lanes: the dependencies a consumer resolves today, and the floor `peerDependencies` declares. It also corrects `AGENTS.md` and `COMMENT-POLICY.md`, which say that no CI runs. | actionlint 1.7.12 with shellcheck 0.9.0, clean. `git am` on a clean checkout of this branch. Each step's commands run by hand in both lanes on Node 22.23.4, and the suite on Node 24.22.3, which the workflow sets up. **The workflow itself has not run.** |

No workflow here publishes anything, and none should until the owner asks
for a release.
