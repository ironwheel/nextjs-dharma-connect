/**
 * @file packages/api/lib/translate.ts
 * @description Translate prompt text from English to other languages using AWS Translate.
 * Uses OIDC token to assume the app role (same pattern as DynamoDB/SQS) so calls are not made with CLI identity.
 */

import { TranslateClient, TranslateTextCommand } from '@aws-sdk/client-translate';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { fromWebToken } from '@aws-sdk/credential-provider-web-identity';

/** Map our display language names to AWS Translate language codes */
export const LANGUAGE_NAME_TO_AWS_CODE: Record<string, string> = {
  Czech: 'cs',
  English: 'en',
  French: 'fr',
  German: 'de',
  Italian: 'it',
  Portuguese: 'pt',
  Spanish: 'es',
};

/** Target languages we support for prompts (all except English; English is source) */
export const PROMPT_TARGET_LANGUAGES = ['Czech', 'French', 'German', 'Italian', 'Portuguese', 'Spanish'];

const SOURCE_LANGUAGE_CODE = 'en';

/**
 * Get a TranslateClient using the app role (assumed via OIDC token when present, else default credential chain).
 */
async function getTranslateClient(appRoleArn: string, oidcToken?: string): Promise<TranslateClient> {
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';

  let baseCredentials;
  if (oidcToken) {
    const proxyRoleArn = process.env.OIDC_PROXY_ROLE_ARN;
    if (!proxyRoleArn) {
      throw new Error('Server configuration error: Missing OIDC_PROXY_ROLE_ARN.');
    }
    baseCredentials = fromWebToken({
      roleArn: proxyRoleArn,
      webIdentityToken: oidcToken,
      roleSessionName: 'DharmaConnectProxySession',
    });
  }

  const stsClient = new STSClient({
    region,
    credentials: baseCredentials,
  });
  const { Credentials } = await stsClient.send(
    new AssumeRoleCommand({
      RoleArn: appRoleArn,
      RoleSessionName: 'AppTranslateSession',
    })
  );
  if (!Credentials?.AccessKeyId || !Credentials?.SecretAccessKey || !Credentials?.SessionToken) {
    throw new Error('Failed to obtain temporary credentials from STS for Translate.');
  }

  return new TranslateClient({
    region,
    credentials: {
      accessKeyId: Credentials.AccessKeyId,
      secretAccessKey: Credentials.SecretAccessKey,
      sessionToken: Credentials.SessionToken,
    },
  });
}

/**
 * Translate a single text from English to one target language.
 */
async function translateToLanguage(
  client: TranslateClient,
  text: string,
  targetLanguageCode: string
): Promise<string> {
  if (!text || !text.trim()) return '';
  const command = new TranslateTextCommand({
    Text: text,
    SourceLanguageCode: SOURCE_LANGUAGE_CODE,
    TargetLanguageCode: targetLanguageCode,
  });
  const response = await client.send(command);
  return response.TranslatedText ?? '';
}

/**
 * Translate English prompt text to the given target languages using AWS Translate.
 * Uses appRoleArn and oidcToken to derive credentials (OIDC -> proxy role -> assume app role), same as DynamoDB/SQS.
 * @param englishText - Source text in English.
 * @param targetLanguageNames - Display names: Czech, French, German, Italian, Portuguese, Spanish.
 * @param appRoleArn - Role ARN to assume (from actions profile; must allow translate:TranslateText).
 * @param oidcToken - Optional OIDC token; when set, used with OIDC_PROXY_ROLE_ARN to obtain base credentials.
 * @returns Record of language name -> translated text. Does not include English (caller adds that).
 */
export async function translatePromptFromEnglish(
  englishText: string,
  targetLanguageNames: string[] = PROMPT_TARGET_LANGUAGES,
  appRoleArn?: string,
  oidcToken?: string
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!englishText || !englishText.trim()) {
    targetLanguageNames.forEach((name) => (out[name] = ''));
    return out;
  }

  const roleArn = appRoleArn || process.env.DEFAULT_GUEST_ROLE_ARN;
  if (!roleArn) {
    throw new Error('Server configuration error: No app role ARN available for Translate.');
  }

  const client = await getTranslateClient(roleArn, oidcToken);

  await Promise.all(
    targetLanguageNames.map(async (name) => {
      const code = LANGUAGE_NAME_TO_AWS_CODE[name];
      if (!code || code === SOURCE_LANGUAGE_CODE) {
        out[name] = '';
        return;
      }
      try {
        const translated = await translateToLanguage(client, englishText.trim(), code);
        out[name] = translated;
      } catch (err) {
        console.error(`[translate] Failed to translate to ${name} (${code}):`, err);
        out[name] = '';
      }
    })
  );

  return out;
}
