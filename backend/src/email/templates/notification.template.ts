/**
 * Data-driven, on-brand template for per-event notification emails.
 *
 * One small helper renders EVERY notification email: a subject, a one-line body,
 * and a single deep-link CTA to the relevant entity. This deliberately mirrors
 * the visual language of the other Project Ops templates (e.g.
 * task-assigned.template.ts) — same gradient header, card, CTA button, footer —
 * without duplicating a full bespoke template per event type. New event types
 * just pass a different subject/headline/body/cta; no new HTML file needed.
 */

export interface NotificationEmailContent {
  /** Email subject line. */
  subject: string;
  /** Short headline shown in the gradient header (e.g. "New task assigned"). */
  headline: string;
  /** One-line plain-language body (e.g. "Alex assigned you 'Wire the API'."). */
  body: string;
  /** Deep link to the entity (task/project). */
  url: string;
  /** CTA button label (e.g. "View task"). */
  cta: string;
}

/** HTML-escape interpolated, user-influenced strings to avoid markup injection. */
function esc(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Render the branded HTML body for a notification email. */
export function getNotificationEmailHtml(
  content: NotificationEmailContent,
  recipientName: string,
  firmName: string,
): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(content.headline)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background-color: #F5F9FC; padding: 40px 20px; line-height: 1.6;
    }
    .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); overflow: hidden; }
    .header { background: linear-gradient(135deg, #005AF5 0%, #0042B8 100%); padding: 36px 30px; text-align: center; }
    .header h1 { color: #ffffff; font-size: 24px; font-weight: 700; }
    .content { padding: 36px 30px; }
    .greeting { color: #10172B; font-size: 18px; font-weight: 600; margin-bottom: 16px; }
    .message { color: #4A5568; font-size: 16px; line-height: 1.7; margin-bottom: 8px; }
    .cta-container { text-align: center; margin: 32px 0 8px; }
    .cta-button { display: inline-block; background: #005AF5; color: #ffffff; font-size: 16px; font-weight: 600; text-decoration: none; padding: 14px 36px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,90,245,0.3); }
    .cta-button:hover { background: #0042B8; }
    .footer { background-color: #F5F9FC; padding: 28px 30px; text-align: center; border-top: 1px solid #D4DADE; }
    .footer p { color: #A5A6AA; font-size: 13px; margin-bottom: 8px; }
    .footer .firm-name { color: #10172B; font-weight: 600; font-size: 15px; margin-bottom: 4px; }
    @media only screen and (max-width: 600px) {
      .header h1 { font-size: 20px; }
      .content { padding: 28px 20px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${esc(content.headline)}</h1>
    </div>
    <div class="content">
      <p class="greeting">Hello ${esc(recipientName)},</p>
      <p class="message">${esc(content.body)}</p>
      <div class="cta-container">
        <a href="${esc(content.url)}" class="cta-button">${esc(content.cta)}</a>
      </div>
    </div>
    <div class="footer">
      <p class="firm-name">${esc(firmName)}</p>
      <p>You're receiving this because of your notification settings.</p>
      <p style="margin-top: 14px;">This is an automated notification. Please do not reply to this email.</p>
      <p style="font-size: 12px; color: #A5A6AA; margin-top: 8px;">Powered by Project Ops Platform</p>
    </div>
  </div>
</body>
</html>
  `.trim();
}

/** Render the plain-text fallback for a notification email. */
export function getNotificationEmailText(
  content: NotificationEmailContent,
  recipientName: string,
  firmName: string,
): string {
  return [
    `Hello ${recipientName},`,
    '',
    content.body,
    '',
    `${content.cta}: ${content.url}`,
    '',
    '—',
    firmName,
    "You're receiving this because of your notification settings.",
    'This is an automated notification. Please do not reply to this email.',
  ].join('\n');
}
