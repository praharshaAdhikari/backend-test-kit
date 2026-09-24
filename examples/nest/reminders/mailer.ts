export interface Email {
  to: string;
  subject: string;
  text: string;
}

/**
 * Sending email, behind a small class of our own. The real implementation wraps the provider's
 * SDK (nodemailer, SES, SendGrid) in one place; everything else depends on this class, so tests
 * replace it with a fake that records what was sent (booking-reminders.job.spec.ts). The same
 * pattern works for S3, payment providers, SMS: wrap the SDK, fake the wrapper.
 */
export abstract class Mailer {
  abstract send(email: Email): Promise<void>;
}
