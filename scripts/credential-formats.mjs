/**
 * The credential shapes both scanners look for.
 *
 * One list, two places a key must not appear: the shipped bundle and the repository
 * itself. Keeping them in step by hand would mean a format added for one being missing
 * from the other, which is exactly the gap a scanner is supposed to close.
 *
 * Every entry is a *published prefix*, so a match is a real key rather than a string that
 * happens to look like one.
 */
export const KEY_FORMATS = [
  [/\bghp_[A-Za-z0-9]{36}\b/, 'a GitHub personal access token'],
  [/\bgho_[A-Za-z0-9]{36}\b/, 'a GitHub OAuth token'],
  [/\bghs_[A-Za-z0-9]{36}\b/, 'a GitHub server token'],
  [/\bgithub_pat_[A-Za-z0-9_]{60,}\b/, 'a fine-grained GitHub token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'an AWS access key id'],
  [/\bASIA[0-9A-Z]{16}\b/, 'an AWS temporary access key id'],
  [/\bsk-[A-Za-z0-9]{32,}\b/, 'an OpenAI-style secret key'],
  [/\bsk-ant-[A-Za-z0-9-]{32,}\b/, 'an Anthropic API key'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, 'a Slack token'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'a Google API key'],
  [/\bya29\.[0-9A-Za-z_-]{20,}\b/, 'a Google OAuth token'],
  [/-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, 'a private key'],
  [/\bnpm_[A-Za-z0-9]{36}\b/, 'an npm token'],
  [/\bglpat-[A-Za-z0-9_-]{20,}\b/, 'a GitLab token'],
  [/\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/, 'a SendGrid key'],
  [/\bsk_live_[A-Za-z0-9]{24,}\b/, 'a live Stripe secret key'],
  [/\brk_live_[A-Za-z0-9]{24,}\b/, 'a live Stripe restricted key'],
];

/** Something named like a secret with a literal on the right of it. */
export const SECRET_NAMED =
  /\b(?:SECRET|PRIVATE_KEY|PASSWORD|PASSWD|CREDENTIAL|API_KEY|APIKEY|ACCESS_TOKEN|AUTH_TOKEN|CLIENT_SECRET)\b\s*[:=]\s*["'][^"']{8,}["']/i;
