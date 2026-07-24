import { z } from 'zod';

/** `POST /voice/client-secret` takes no body: the short-lived secret is minted for the fixed demo actor, not scoped to a specific task. */
export const CreateVoiceClientSecretRequestSchema = z.object({}).strict();
export type CreateVoiceClientSecretRequest = z.infer<typeof CreateVoiceClientSecretRequestSchema>;

export const CreateVoiceClientSecretResponseSchema = z.object({
  clientSecret: z.string().min(1),
  expiresAt: z.string().datetime(),
});
export type CreateVoiceClientSecretResponse = z.infer<typeof CreateVoiceClientSecretResponseSchema>;
