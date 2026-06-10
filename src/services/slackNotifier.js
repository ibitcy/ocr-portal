'use strict';

const config = require('../config');

const STATUS_PRESENTATION = {
  completed: { emoji: ':white_check_mark:', label: 'completed' },
  failed: { emoji: ':x:', label: 'failed' },
  cancelled: { emoji: ':no_entry_sign:', label: 'cancelled' }
};

/**
 * Optional Slack notifications for finished review jobs.
 * Fully env-driven; when disabled or misconfigured the app works normally
 * and notifications are skipped with a log message. Notification failures
 * never affect the review job itself.
 */
class SlackNotifier {
  constructor(slackConfig) {
    this.config = slackConfig;
    this.enabled = false;

    if (!slackConfig.enabled) {
      console.log('Slack notifications disabled (SLACK_ENABLED is not "true")');
      return;
    }
    if (!slackConfig.botToken || !slackConfig.channelId) {
      console.warn(
        'Slack notifications disabled: SLACK_ENABLED=true but ' +
          'SLACK_BOT_TOKEN and/or SLACK_CHANNEL_ID is missing'
      );
      return;
    }

    this.enabled = true;
    console.log(`Slack notifications enabled for channel ${slackConfig.channelId}`);
  }

  shouldNotify(status) {
    if (!this.enabled) return false;
    switch (status) {
      case 'completed':
        return this.config.notifyOnSuccess;
      case 'failed':
        return this.config.notifyOnFailure;
      case 'cancelled':
        return this.config.notifyOnCancelled;
      default:
        return false;
    }
  }

  buildMessage(job, { summary, error } = {}) {
    const { emoji, label } = STATUS_PRESENTATION[job.status] || { emoji: '', label: job.status };
    const diff =
      job.mode === 'pr'
        ? `PR/MR #${job.pr_number}${job.pr_title ? ` — ${job.pr_title}` : ''} (${job.base_branch} → ${job.feature_branch})`
        : `${job.base_branch} → ${job.feature_branch}`;

    const lines = [
      `${emoji} Code review *#${job.id}* ${label}`,
      `*Repository:* ${job.repository_name}`,
      `*Diff:* ${diff}`,
      `*Started by:* ${job.user_email}`
    ];
    if (job.duration_seconds != null) lines.push(`*Duration:* ${job.duration_seconds}s`);
    if (summary) lines.push(`*Summary:* ${summary}`);
    if (error) lines.push(`*Error:* ${error}`);
    return lines.join('\n');
  }

  /**
   * Send a notification for a finished review job (completed/failed/cancelled).
   * Never throws.
   */
  async notifyReviewFinished(job, extra = {}) {
    try {
      if (!this.shouldNotify(job.status)) {
        if (this.enabled) {
          console.log(
            `Slack notification skipped for review #${job.id} (status "${job.status}" is muted)`
          );
        }
        return;
      }

      const res = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.botToken}`,
          'Content-Type': 'application/json; charset=utf-8'
        },
        body: JSON.stringify({
          channel: this.config.channelId,
          text: this.buildMessage(job, extra),
          unfurl_links: false
        })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok !== true) {
        console.error(
          `Slack notification failed for review #${job.id}: ` +
            `${data.error || `HTTP ${res.status}`}`
        );
        return;
      }
      console.log(`Slack notification sent for review #${job.id} (${job.status})`);
    } catch (err) {
      console.error(`Slack notification error for review #${job.id}: ${err.message}`);
    }
  }
}

module.exports = new SlackNotifier(config.slack);
