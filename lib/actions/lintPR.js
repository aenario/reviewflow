'use strict';

exports.lintPR = (repoContext, context) => {
  if (!repoContext.config.prLint) return;

  const repo = context.payload.repository;
  const pr = context.payload.pull_request;

  // do not lint pr from forks
  if (pr.head.repo.id !== repo.id) return;

  const isPrFromBot = pr.user.type === 'Bot';

  const statuses = [];

  const errorRule = repoContext.config.prLint.title.find((rule) => {
    if (rule.bot === false && isPrFromBot) return false;

    const match = rule.regExp.exec(pr.title);
    if (match === null) {
      if (rule.status) {
        statuses.push({ name: rule.status, error: rule.error });
      }
      return true;
    }

    if (rule.status) {
      statuses.push({
        name: rule.status,
        info: rule.statusInfoFromMatch(match),
      });
      return false;
    }

    return false;
  });

  const date = new Date();

  return Promise.all([
    ...statuses.map(({ name, error, info }) =>
      context.github.repos.createStatus(
        context.repo({
          context: `reviewflow/${name}`,
          sha: pr.head.sha,
          state: error ? 'failure' : 'success',
          target_url: error ? undefined : info.url,
          description: error || info.title,
        })
      )
    ),
    context.github.checks.create(
      context.repo({
        name: 'reviewflow/lint-pr',
        head_sha: pr.head.sha,
        status: 'completed',
        conclusion: errorRule ? 'failure' : 'success',
        started_at: date,
        completed_at: date,
        output: errorRule
          ? errorRule.error
          : {
              title: '✓ Your PR is valid',
              summary: '',
            },
      })
    ),
  ]);
};