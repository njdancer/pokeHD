// The sign-in email (D23), sent with Cloudflare Email Service through the EMAIL binding.

/** A sign-in link: the email and code ride in the fragment, which never reaches a server log. */
export function signInLink(origin: string, email: string, code: string): string {
  return `${origin}/login#${new URLSearchParams({ email, code })}`;
}

export interface SignInMail {
  to: string;
  /** Who it's for, when Nick is inviting them. */
  name?: string;
  code: string;
  link: string;
  /** True for Nick's invite (a link code), false for a code the player asked for. */
  invite: boolean;
}

/** Sends a sign-in email. Throws if Email Service refuses it. */
export async function sendSignIn(env: Env, mail: SignInMail): Promise<void> {
  const greeting = mail.name ? `Hi ${mail.name},` : "Hi,";
  const intro = mail.invite
    ? "You've been invited to pokeHD. Open this link to sign in:"
    : "Here's your pokeHD sign-in code:";
  const text = mail.invite
    ? `${greeting}\n\n${intro}\n\n${mail.link}\n\nIt works once, for 7 days. After that, sign in with this email address whenever you like.\n`
    : `${greeting}\n\n${intro}\n\n${mail.code}\n\nOr open ${mail.link}\n\nIt works once, for 15 minutes. If you didn't ask for it, ignore this email.\n`;
  const html = `<p>${escape(greeting)}</p><p>${escape(intro)}</p>${
    mail.invite
      ? `<p><a href="${escape(mail.link)}">Sign in to pokeHD</a></p><p>It works once, for 7 days. After that, sign in with this email address whenever you like.</p>`
      : `<p style="font:600 28px ui-monospace,monospace;letter-spacing:4px">${escape(mail.code)}</p><p>Or <a href="${escape(mail.link)}">sign in with this link</a>. It works once, for 15 minutes. If you didn't ask for it, ignore this email.</p>`
  }`;
  await env.EMAIL.send({
    to: mail.to,
    from: { name: "pokeHD", email: env.EMAIL_FROM },
    subject: mail.invite ? "You're invited to pokeHD" : `pokeHD sign-in code: ${mail.code}`,
    text,
    html,
  });
}

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
