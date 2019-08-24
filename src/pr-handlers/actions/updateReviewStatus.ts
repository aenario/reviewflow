import Webhooks from '@octokit/webhooks';
import { PullsGetResponse } from '@octokit/rest';
import { Context } from 'probot';
import { LabelResponse } from '../../context/initRepoLabels';
import { GroupLabels } from '../../orgsConfigs/types';
import { RepoContext } from '../../context/repoContext';
import { updateStatusCheckFromLabels } from './updateStatusCheckFromLabels';

export const updateReviewStatus = async <
  E extends Webhooks.WebhookPayloadPullRequest,
  GroupNames extends string = any
>(
  pr: PullsGetResponse,
  context: Context<E>,
  repoContext: RepoContext,
  reviewGroup: GroupNames,
  {
    add: labelsToAdd,
    remove: labelsToRemove,
  }: {
    add?: (GroupLabels | false | undefined)[];
    remove?: (GroupLabels | false | undefined)[];
  },
): Promise<LabelResponse[]> => {
  context.log.info('updateReviewStatus', {
    reviewGroup,
    labelsToAdd,
    labelsToRemove,
  });

  let prLabels: LabelResponse[] = pr.labels || [];
  if (!reviewGroup) return prLabels;

  const newLabelNames = new Set<string>(
    prLabels.map((label: LabelResponse) => label.name),
  );

  const toAdd = new Set<GroupLabels | string>();
  const toAddNames = new Set<string>();
  const toDelete = new Set<GroupLabels>();
  const toDeleteNames = new Set<string>();
  const labels = repoContext.labels;

  const getLabelFromKey = (key: GroupLabels): undefined | LabelResponse => {
    const reviewConfig = repoContext.config.labels.review[reviewGroup];
    if (!reviewConfig) return undefined;

    return reviewConfig[key] && labels[reviewConfig[key]]
      ? labels[reviewConfig[key]]
      : undefined;
  };

  if (labelsToAdd) {
    labelsToAdd.forEach((key) => {
      if (!key) return;
      const label = getLabelFromKey(key);
      if (!label || prLabels.some((prLabel) => prLabel.id === label.id)) {
        return;
      }
      newLabelNames.add(label.name);
      toAdd.add(key);
      toAddNames.add(label.name);
    });
  }

  if (labelsToRemove) {
    labelsToRemove.forEach((key) => {
      if (!key) return;
      const label = getLabelFromKey(key);
      if (!label) return;
      const existing = prLabels.find((prLabel) => prLabel.id === label.id);
      if (existing) {
        newLabelNames.delete(existing.name);
        toDelete.add(key);
        toDeleteNames.add(existing.name);
      }
    });
  }

  // TODO move that elsewhere

  repoContext.getTeamsForLogin(pr.user.login).forEach((teamName) => {
    const team = repoContext.config.teams[teamName];
    if (team.labels) {
      team.labels.forEach((labelKey) => {
        const label = repoContext.labels[labelKey];
        if (label && !prLabels.some((prLabel) => prLabel.id === label.id)) {
          newLabelNames.add(label.name);
          toAdd.add(labelKey);
        }
      });
    }
  });

  // if (process.env.DRY_RUN) return;

  if (toAdd.size !== 0 || toDelete.size !== 0) {
    if (toDelete.size === 0 || toDelete.size < 4) {
      context.log.info('updateReviewStatus', {
        reviewGroup,
        toAdd: [...toAdd],
        toDelete: [...toDelete],
        toAddNames: [...toAddNames],
        toDeleteNames: [...toDeleteNames],
      });

      if (toAdd.size !== 0) {
        const result = await context.github.issues.addLabels(
          context.issue({
            labels: [...toAddNames],
          }),
        );
        prLabels = result.data;
      }

      if (toDelete.size !== 0) {
        for (const toDeleteName of [...toDeleteNames]) {
          const result = await context.github.issues.removeLabel(
            context.issue({
              name: toDeleteName,
            }),
          );
          prLabels = result.data;
        }
      }
    } else {
      const newLabelNamesArray = [...newLabelNames];

      context.log.info('updateReviewStatus', {
        reviewGroup,
        toAdd: [...toAdd],
        toDelete: [...toDelete],
        oldLabels: prLabels.map((l: LabelResponse) => l.name),
        newLabelNames: newLabelNamesArray,
      });

      const result = await context.github.issues.replaceLabels(
        context.issue({
          labels: newLabelNamesArray,
        }),
      );
      prLabels = result.data;
    }
  }

  // if (toAdd.has('needsReview')) {
  //   createInProgressStatusCheck(context);
  // } else if (
  //   toDelete.has('needsReview') ||
  //   (prLabels.length === 0 && toAdd.size === 1 && toAdd.has('approved'))
  // ) {
  await updateStatusCheckFromLabels(pr, context, repoContext, prLabels);
  // }

  return prLabels;
};
