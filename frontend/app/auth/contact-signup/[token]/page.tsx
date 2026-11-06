import { redirect } from "next/navigation";

/**
 * Older invitation emails linked here. The signup form lives at
 * /auth/client-signup/[token]. Keep this redirect so those links still open.
 */
export default async function ContactSignupRedirect({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  redirect(`/auth/client-signup/${encodeURIComponent(token)}`);
}
