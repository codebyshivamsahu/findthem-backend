// src/services/notification.ts
// Transactional email via the Brevo HTTP API. If BREVO_API_KEY is not set,
// every send is a no-op — email is optional, never a hard dependency.
import { config } from '../config';

const PORTAL_URL = 'https://findthemindia.vercel.app';

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function shell(title: string, bodyHtml: string, caseId: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  body { font-family: 'Segoe UI', Arial, sans-serif; background:#f9fafb; margin:0; padding:20px; }
  .container { max-width:560px; margin:0 auto; background:#fff; border-radius:16px; overflow:hidden; border:1px solid #f3f4f6; }
  .header { background:linear-gradient(135deg,#ea580c,#f97316); padding:24px 32px; color:#fff; }
  .header h1 { margin:0; font-size:20px; }
  .header p { margin:6px 0 0; opacity:.85; font-size:13px; }
  .body { padding:26px 32px; color:#374151; font-size:14px; line-height:1.6; }
  .row { margin-bottom:10px; }
  .label { color:#6b7280; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; }
  .value { color:#111827; font-size:14px; }
  .box { background:#fef3c7; border:1px solid #fde68a; border-radius:10px; padding:14px 16px; margin-bottom:18px; }
  .help { background:#f0fdf4; border:1px solid #bbf7d0; border-radius:10px; padding:14px; margin-top:18px; font-size:13px; color:#166534; }
  .footer { background:#f9fafb; padding:16px 32px; text-align:center; color:#9ca3af; font-size:11px; border-top:1px solid #f3f4f6; }
</style></head><body>
<div class="container">
  <div class="header"><h1>Find Them India</h1><p>${escapeHtml(title)}</p></div>
  <div class="body">${bodyHtml}
    <div class="help">Emergency: <strong>112</strong> &nbsp;|&nbsp; Child Helpline: <strong>1098</strong> &nbsp;|&nbsp; Women's Helpline: <strong>1091</strong></div>
  </div>
  <div class="footer">
    <p>Find Them India is an independent community platform. It is not operated by, or affiliated with, any government body.</p>
    <p>Case ${escapeHtml(caseId)} &bull; Automated message, please do not reply. ${PORTAL_URL}</p>
  </div>
</div></body></html>`;
}

function row(label: string, value: unknown): string {
  return `<div class="row"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div></div>`;
}

export interface SightingReportedData {
  personName: string;
  caseId: string;
  location: string;
  description: string;
  reportedAt: string | Date;
}

/**
 * Sent automatically, the moment a sighting is filed. No review, no waiting.
 *
 * There is deliberately no "match confidence" figure in here. The face service
 * compares image gradients, not identities — it cannot tell you a sighting is
 * the missing person, and a percentage in this email would read as if it could.
 * The family gets what is actually actionable: where, when, and what was seen.
 */
function sightingReportedTemplate(data: SightingReportedData) {
  const when = new Date(data.reportedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const html = shell(
    'New sighting reported on your case',
    `<div class="box"><strong>Someone has reported a possible sighting on your case.</strong>
       This report has not been checked by anyone yet. Please pass the details to
       the police handling your case, along with the case ID.</div>
     ${row('Case ID', data.caseId)}
     ${row('Person', data.personName)}
     ${row('Reported near', data.location)}
     ${row('Reported at', when)}
     ${row('What was reported', data.description)}
     <p>Anyone can submit a sighting, so this may or may not be your family member.
     Treat it as a lead to give the police, not as confirmation.</p>`,
    data.caseId
  );
  const text = [
    'Find Them India — new sighting reported',
    '',
    `Case ID: ${data.caseId}`,
    `Person: ${data.personName}`,
    `Reported near: ${data.location}`,
    `Reported at: ${when}`,
    `What was reported: ${data.description}`,
    '',
    'This report has not been checked by anyone. Treat it as a lead for the police,',
    'not as confirmation. Emergency: 112 | Child Helpline: 1098',
  ].join('\n');

  return { subject: `New sighting on case ${data.caseId} — Find Them India`, html, text };
}

export interface SightingAlertData {
  personName: string;
  caseId: string;
  location: string;
  description: string;
  reviewedBy: string;
  reportedAt: string | Date;
}

/**
 * Sent only after a police/admin reviewer has verified a sighting. There is no
 * "match confidence" in this email — the platform does not produce a number it
 * can stand behind, and telling a family "87% match" when nothing was compared
 * is worse than telling them nothing.
 */
function sightingVerifiedTemplate(data: SightingAlertData) {
  const when = new Date(data.reportedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const html = shell(
    'Verified sighting on your case',
    `<div class="box"><strong>A sighting on your case has been reviewed and verified.</strong>
       Please contact your local police with the case ID below.</div>
     ${row('Case ID', data.caseId)}
     ${row('Person', data.personName)}
     ${row('Reported near', data.location)}
     ${row('Reported at', when)}
     ${row('Verified by', data.reviewedBy)}
     ${row('Details', data.description)}
     <p>A verified sighting means a reviewer considered the report credible. It is not
     a confirmed identification — only the police can confirm that.</p>`,
    data.caseId
  );
  const text = [
    'Find Them India — verified sighting',
    '',
    `Case ID: ${data.caseId}`,
    `Person: ${data.personName}`,
    `Reported near: ${data.location}`,
    `Reported at: ${when}`,
    `Verified by: ${data.reviewedBy}`,
    `Details: ${data.description}`,
    '',
    'A verified sighting is a credible report, not a confirmed identification.',
    'Please contact your local police. Emergency: 112 | Child Helpline: 1098',
  ].join('\n');

  return { subject: `Verified sighting on case ${data.caseId} — Find Them India`, html, text };
}

export interface CaseFiledData {
  personName: string;
  caseId: string;
  reporterName: string;
  lastSeenLocation: string;
  lastSeenDate: string;
  district: string;
  state: string;
}

function caseFiledTemplate(data: CaseFiledData) {
  const html = shell(
    'Case registered',
    `<p>Hello ${escapeHtml(data.reporterName)}, your report has been registered.
       Keep the case ID safe — you will need it for any follow-up.</p>
     ${row('Case ID', data.caseId)}
     ${row('Person', data.personName)}
     ${row('Last seen', `${data.lastSeenLocation}, ${data.district}, ${data.state}`)}
     ${row('Last seen on', data.lastSeenDate)}
     <p><strong>If you have not already filed a police complaint, do that now.</strong>
     A police FIR is what actually starts an official search; this portal only helps
     circulate the details.</p>`,
    data.caseId
  );
  const text = [
    'Find Them India — case registered',
    '',
    `Case ID: ${data.caseId}`,
    `Person: ${data.personName}`,
    `Last seen: ${data.lastSeenLocation}, ${data.district}, ${data.state} on ${data.lastSeenDate}`,
    '',
    'If you have not filed a police complaint yet, do that now — an FIR is what',
    'starts an official search. Emergency: 112 | Child Helpline: 1098',
  ].join('\n');

  return { subject: `Case ${data.caseId} registered — Find Them India`, html, text };
}

async function send(to: string, subject: string, html: string, text: string): Promise<void> {
  if (!config.emailEnabled) {
    console.warn('Email disabled (BREVO_API_KEY not set) — skipping message to', to);
    return;
  }

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'api-key': config.BREVO_API_KEY as string,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: 'Find Them India', email: config.EMAIL_FROM },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text,
    }),
  });

  if (!response.ok) {
    throw new Error(`Brevo API returned ${response.status}`);
  }
}

export async function sendSightingReported(to: string, data: SightingReportedData): Promise<void> {
  const { subject, html, text } = sightingReportedTemplate(data);
  await send(to, subject, html, text);
}

export async function sendSightingAlert(to: string, data: SightingAlertData): Promise<void> {
  const { subject, html, text } = sightingVerifiedTemplate(data);
  await send(to, subject, html, text);
}

export async function sendCaseFiledConfirmation(to: string, data: CaseFiledData): Promise<void> {
  const { subject, html, text } = caseFiledTemplate(data);
  await send(to, subject, html, text);
}
