-- 032: Teams and Slack Webhook URLs (encrypted)
ALTER TABLE tenant_settings
  ADD COLUMN teams_webhook_url_encrypted TEXT,
  ADD COLUMN slack_webhook_url_encrypted TEXT;
