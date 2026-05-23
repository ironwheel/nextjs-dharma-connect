import React, { useCallback, useMemo, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, useStripe, useElements, PaymentElement } from '@stripe/react-stripe-js';
import {
  getStripeConfig,
  createStripePaymentIntent,
  completeOffering,
} from 'sharedFrontend';
import { promptLookup } from './script/StepComponents';
import type { ScriptContext } from './script/types';
import {
  ANONYMOUS_HEART_GIFT_CART_ID,
  heartGiftShortcutAmountsFromConfig,
  type OfferingConfigLike,
} from '../lib/heartGiftConstants';

const StripeElements = Elements as unknown as React.JSX.ElementType;
const StripePaymentElement = PaymentElement as unknown as React.JSX.ElementType;

type PaymentStep = 'amount' | 'email' | 'stripe' | 'complete';

function currencySymbol(currency: string): string {
  return currency === 'USD' ? '$' : currency === 'CAD' ? '$' : currency === 'EUR' ? '€' : '$';
}

function formatAmount(amountCents: number, currency: string): string {
  return `${currencySymbol(currency)}${(amountCents / 100).toFixed(2)} ${currency}`;
}

function parseMoneyDollars(val: string): number {
  if (val == null) return Number.NaN;
  const cleaned = String(val).replace(/[^0-9.]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : Number.NaN;
}

function sanitizePromptHtml(raw: string): string {
  if (!raw) return '';
  return String(raw)
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '')
    .replace(/\s(href|src)=["']\s*javascript:[^"']*["']/gi, ' $1="#"');
}

function HtmlPrompt({ html, className }: { html: string; className?: string }) {
  return <div className={className} dangerouslySetInnerHTML={{ __html: sanitizePromptHtml(html) }} />;
}

function isPromptResolved(text: string | undefined): boolean {
  const t = String(text ?? '').trim();
  return t !== '' && !t.endsWith('-unknown');
}

function resolvedPrompt(context: ScriptContext, key: string, fallback = ''): string {
  const raw = promptLookup(context, key);
  return isPromptResolved(raw) ? raw : fallback;
}

function AmountStepper({
  value,
  min,
  currency,
  onChange,
  placeholder,
}: {
  value: string;
  min: number;
  currency: string;
  onChange: (val: string) => void;
  placeholder?: string;
}) {
  const sym = currencySymbol(currency);
  const parsed = parseMoneyDollars(value);
  const step = 1;
  const dec = () => {
    const next = Number.isFinite(parsed) ? Math.max(min, parsed - step) : min;
    onChange(next.toFixed(2));
  };
  const inc = () => {
    const next = Number.isFinite(parsed) ? parsed + step : min;
    onChange(next.toFixed(2));
  };
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={dec}
        className="px-3 py-2 rounded bg-reg-button text-reg-text hover:bg-reg-button-hover"
        aria-label="Decrease amount"
      >
        −
      </button>
      <div className="relative flex-1 min-w-[8rem]">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-reg-muted text-sm">{sym}</span>
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full pl-7 pr-3 py-2 rounded border border-reg-border bg-reg-panel text-reg-text"
        />
      </div>
      <button
        type="button"
        onClick={inc}
        className="px-3 py-2 rounded bg-reg-button text-reg-text hover:bg-reg-button-hover"
        aria-label="Increase amount"
      >
        +
      </button>
    </div>
  );
}

function PaymentForm({
  clientSecret,
  amount,
  currency,
  onSuccess,
  onError,
  context,
}: {
  clientSecret: string;
  amount: number;
  currency: string;
  onSuccess: () => void | Promise<void>;
  onError: (msg: string) => void;
  context: ScriptContext;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setLoading(true);
    setMessage(promptLookup(context, 'pleaseWait') || 'Please wait...');
    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: typeof window !== 'undefined' ? window.location.href : '' },
      redirect: 'if_required',
    });
    if (error) {
      onError(error.message ?? 'Payment failed');
      setLoading(false);
      return;
    }
    if (paymentIntent?.status === 'succeeded') {
      setMessage(promptLookup(context, 'stripeCaptureLoading') || 'Finalizing your offering…');
      try {
        await onSuccess();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to complete offering';
        onError(msg);
        setLoading(false);
      }
      return;
    }
    setLoading(false);
    onError(
      paymentIntent?.status === 'requires_action'
        ? 'Additional authentication is required.'
        : 'Payment could not be completed.',
    );
  };

  const buttonLabel =
    (promptLookup(context, 'offeringClick') || 'Pay') +
    ` ${currencySymbol(currency)}${(amount / 100).toFixed(2)} ${currency}`;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <StripePaymentElement />
      {message && <p className="text-reg-muted text-sm">{message}</p>}
      <button
        type="submit"
        disabled={loading || !stripe || !elements}
        className="w-full px-4 py-3 rounded bg-reg-accent-button text-reg-accent-button-text hover:bg-reg-accent-button-hover disabled:opacity-50"
      >
        {loading ? (promptLookup(context, 'pleaseWait') || 'Processing...') : buttonLabel}
      </button>
    </form>
  );
}

export type HeartGiftAnonymousProps = {
  context: ScriptContext;
  servicePid: string;
  serviceHash: string;
  eventCode: string;
  subEventKey: string;
  offeringConfig: OfferingConfigLike;
  initialCaptureComplete?: boolean;
};

export const HeartGiftAnonymous: React.FC<HeartGiftAnonymousProps> = ({
  context,
  servicePid,
  serviceHash,
  eventCode,
  subEventKey,
  offeringConfig,
  initialCaptureComplete,
}) => {
  const event = context.event;
  const promptKey =
    offeringConfig.prompts?.find((p) => p === 'offeringHeartGift') ||
    offeringConfig.prompts?.[0] ||
    'offeringHeartGift';

  const minDollars = Number(offeringConfig.config?.minDollars ?? 1);
  const shortcutAmounts = useMemo(
    () => heartGiftShortcutAmountsFromConfig(offeringConfig),
    [offeringConfig],
  );
  const initialAmountDollarsRaw = offeringConfig.config?.initialAmount;
  const initialAmountDollars =
    typeof initialAmountDollarsRaw === 'number' && Number.isFinite(initialAmountDollarsRaw)
      ? Math.max(minDollars, initialAmountDollarsRaw)
      : shortcutAmounts[0] ?? minDollars;
  const currency = ((event?.config?.offeringCurrency as string) || 'USD').toUpperCase();

  const [paymentStep, setPaymentStep] = useState<PaymentStep>(
    initialCaptureComplete ? 'complete' : 'amount',
  );
  const [amountInput, setAmountInput] = useState(String(initialAmountDollars.toFixed(2)));
  const [payerEmail, setPayerEmail] = useState('');
  const [receiptDeclined, setReceiptDeclined] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const receiptDeclinedEmail = (process.env.EMAIL_RECEIPT_DECLINED_EMAIL ?? '').trim();
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [publishableKey, setPublishableKey] = useState<string | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  const parsedDollars = parseMoneyDollars(amountInput);
  const amountCents = Number.isFinite(parsedDollars) && parsedDollars >= minDollars
    ? Math.round(parsedDollars * 100)
    : 0;
  const hasValidAmount = amountCents >= Math.round(minDollars * 100);

  const offeringSku = `${eventCode}-${subEventKey}-${promptKey}`;
  const promptIdx = offeringConfig.prompts?.indexOf(promptKey) ?? -1;

  const cart = useMemo(
    () => [
      {
        id: ANONYMOUS_HEART_GIFT_CART_ID,
        name: 'Heart Gift',
        currentOfferings: {
          [subEventKey]: {
            offeringSelection: promptKey,
            offeringIndex: promptIdx,
            offeringSKU: offeringSku,
            offeringAmount: amountCents,
          },
        },
        offeringHistory: {},
      },
    ],
    [subEventKey, promptKey, promptIdx, offeringSku, amountCents],
  );

  const skuSummary = useMemo(
    () => [
      {
        personName: 'Heart Gift',
        subEvent: subEventKey,
        offeringSKU: offeringSku,
        amountCents,
        currency,
      },
    ],
    [subEventKey, offeringSku, amountCents, currency],
  );

  const rawEventImage = event?.config?.eventImage ?? context.config?.eventImage;
  const eventImageUrl =
    typeof rawEventImage === 'string' &&
    (rawEventImage.startsWith('http://') || rawEventImage.startsWith('https://'))
      ? rawEventImage
      : null;

  const stripePromise = useMemo(
    () => (publishableKey ? loadStripe(publishableKey) : null),
    [publishableKey],
  );

  const applyAmountDollars = (dollars: number) => {
    setAmountInput(Number(dollars).toFixed(2));
  };

  const validateEmail = (email: string): boolean => {
    if (receiptDeclined && receiptDeclinedEmail) {
      setEmailError(null);
      return true;
    }
    const t = email.trim();
    if (!t) {
      setEmailError(receiptEmailRequiredMessage);
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) {
      setEmailError(receiptEmailInvalidMessage);
      return false;
    }
    setEmailError(null);
    return true;
  };

  const handlePaymentSuccess = useCallback(async () => {
    if (!paymentIntentId) return;
    setProcessing(true);
    setPayError(null);
    try {
      await completeOffering(servicePid, serviceHash, {
        paymentIntentId,
        pid: servicePid,
        eventCode,
        cart,
        subEventNames: [subEventKey],
        skipStudentHistory: true,
      });
      setPaymentStep('complete');
    } catch (e: unknown) {
      setPayError(e instanceof Error ? e.message : 'Failed to complete offering');
      throw e;
    } finally {
      setProcessing(false);
    }
  }, [paymentIntentId, servicePid, serviceHash, eventCode, cart, subEventKey]);

  const startStripe = async () => {
    if (!hasValidAmount) return;
    if (!validateEmail(payerEmail)) return;
    setProcessing(true);
    setPayError(null);
    try {
      let pk = publishableKey;
      if (!pk) {
        const configResp = await getStripeConfig(servicePid, serviceHash);
        if (configResp && 'redirected' in configResp) {
          setPayError('Session expired. Please refresh the page.');
          return;
        }
        pk = (configResp as { publishableKey: string }).publishableKey;
        if (pk) setPublishableKey(pk);
      }
      const summaryString = `Heart Gift: ${subEventKey}`;
      const createResp = await createStripePaymentIntent(servicePid, serviceHash, {
        aid: eventCode,
        pid: servicePid,
        amount: amountCents,
        currency: currency.toLowerCase(),
        description: event?.name || 'Heart Gift',
        cart,
        summaryString,
        skuSummary,
        eventCode,
        eventName: event?.name,
        payerEmail: (receiptDeclined ? receiptDeclinedEmail : payerEmail).trim(),
        anonymousHeartGift: true,
        subEvent: subEventKey,
      });
      if (createResp && 'redirected' in createResp) {
        setPayError('Session expired. Please refresh the page.');
        return;
      }
      const { id, clientSecret: secret, publishableKey: createPk } = createResp as {
        id: string;
        clientSecret: string;
        publishableKey?: string;
      };
      if (createPk) setPublishableKey(createPk);
      setClientSecret(secret);
      setPaymentIntentId(id);
      setPaymentStep('stripe');
    } catch (e: unknown) {
      setPayError(e instanceof Error ? e.message : 'Failed to start payment');
    } finally {
      setProcessing(false);
    }
  };

  const offeringIntro = resolvedPrompt(context, 'heartGiftOfferingIntroduction');
  const receiptEmailHtml = resolvedPrompt(context, 'receiptEmail');
  const emailReceiptDeclinedHtml = resolvedPrompt(context, 'emailReceiptDeclined');
  const emailReceiptDeclinedConfirmationHtml = resolvedPrompt(context, 'emailReceiptDeclinedConfirmation');
  const continueToPaymentLabel = resolvedPrompt(context, 'continueToPayment', 'Continue to payment');

  const handleReceiptDeclinedChange = (checked: boolean) => {
    setEmailError(null);
    if (checked) {
      if (!receiptDeclinedEmail) {
        setEmailError(
          resolvedPrompt(
            context,
            'emailReceiptDeclinedUnavailable',
            'Receipt decline is not configured on this server.',
          ),
        );
        return;
      }
      setReceiptDeclined(true);
      setPayerEmail(receiptDeclinedEmail);
      return;
    }
    setReceiptDeclined(false);
    setPayerEmail('');
  };
  const receiptEmailRequiredMessage = resolvedPrompt(
    context,
    'receiptEmailRequired',
    'Please enter your email address for a receipt.',
  );
  const receiptEmailInvalidMessage = resolvedPrompt(
    context,
    'receiptEmailInvalid',
    'Please enter a valid email address.',
  );
  const bodyText = promptLookup(context, 'offeringHeartGiftBody') || '';
  const headerLabel = promptLookup(context, subEventKey) || subEventKey;

  if (paymentStep === 'complete') {
    const completeTitle = resolvedPrompt(context, 'heartGiftOfferingCompleteTitle', 'Thank you');
    const completeBody = resolvedPrompt(
      context,
      'heartGiftOfferingCompleteBody',
      'Your heart gift has been received. A receipt will be sent to your email when processing completes.',
    );
    return (
      <div className="max-w-2xl mx-auto rounded-lg shadow-xl border border-reg-border overflow-hidden bg-reg-panel text-reg-text p-6 space-y-4">
        <h2 className="text-xl font-semibold text-reg-accent">{completeTitle}</h2>
        <p className="text-reg-text">{completeBody}</p>
      </div>
    );
  }

  if (paymentStep === 'stripe' && clientSecret && stripePromise) {
    return (
      <div className="max-w-2xl mx-auto rounded-lg shadow-xl border border-reg-border overflow-hidden bg-reg-panel text-reg-text">
        {eventImageUrl && (
          <img
            src={eventImageUrl}
            alt={event?.name ? `Event: ${event.name}` : 'Event'}
            className="w-full h-auto block"
          />
        )}
        <div className="p-6 space-y-4">
          <h2 className="text-lg font-semibold text-reg-accent">
            {promptLookup(context, 'offeringClick') || 'Complete your offering'}
          </h2>
          {payError && <p className="text-reg-error text-sm">{payError}</p>}
          <StripeElements stripe={stripePromise} options={{ clientSecret }}>
            <PaymentForm
              clientSecret={clientSecret}
              amount={amountCents}
              currency={currency}
              onSuccess={handlePaymentSuccess}
              onError={(msg) => setPayError(msg)}
              context={context}
            />
          </StripeElements>
          <button
            type="button"
            onClick={() => setPaymentStep('email')}
            className="px-4 py-2 rounded bg-reg-button text-reg-text hover:bg-reg-button-hover"
          >
            {promptLookup(context, 'back') || 'Back'}
          </button>
        </div>
      </div>
    );
  }

  if (paymentStep === 'email') {
    return (
      <div className="max-w-2xl mx-auto rounded-lg shadow-xl border border-reg-border overflow-hidden bg-reg-panel text-reg-text">
        {eventImageUrl && (
          <img
            src={eventImageUrl}
            alt={event?.name ? `Event: ${event.name}` : 'Event'}
            className="w-full h-auto block"
          />
        )}
        <div className="p-6 space-y-6">
          {receiptDeclined ? (
            emailReceiptDeclinedConfirmationHtml ? (
              <HtmlPrompt html={emailReceiptDeclinedConfirmationHtml} className="text-reg-text" />
            ) : null
          ) : (
            <>
              {receiptEmailHtml ? (
                <HtmlPrompt html={receiptEmailHtml} className="text-reg-text" />
              ) : null}
              <label className="block space-y-1">
                <span className="text-sm text-reg-text">Email</span>
                <input
                  type="email"
                  autoComplete="email"
                  value={payerEmail}
                  onChange={(e) => {
                    setPayerEmail(e.target.value);
                    setEmailError(null);
                  }}
                  className="w-full px-3 py-2 rounded border border-reg-border bg-reg-panel text-reg-text"
                />
              </label>
            </>
          )}
          {(emailReceiptDeclinedHtml || receiptDeclinedEmail) && (
            <div className="space-y-2">
              {emailReceiptDeclinedHtml ? (
                <HtmlPrompt html={emailReceiptDeclinedHtml} className="text-sm text-reg-text" />
              ) : null}
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={receiptDeclined}
                  onChange={(e) => handleReceiptDeclinedChange(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-reg-accent"
                  aria-label={
                    emailReceiptDeclinedHtml
                      ? undefined
                      : resolvedPrompt(context, 'emailReceiptDeclined', 'Decline email receipt')
                  }
                />
              </label>
            </div>
          )}
          {emailError && <p className="text-reg-error text-sm">{emailError}</p>}
          {payError && <p className="text-reg-error text-sm">{payError}</p>}
          <div className="flex justify-between gap-4 pt-2">
            <button
              type="button"
              onClick={() => setPaymentStep('amount')}
              className="px-4 py-2 rounded bg-reg-button text-reg-text hover:bg-reg-button-hover"
            >
              {promptLookup(context, 'back') || 'Back'}
            </button>
            <button
              type="button"
              onClick={startStripe}
              disabled={processing || !hasValidAmount}
              className="px-6 py-2 rounded bg-reg-accent-button text-reg-accent-button-text hover:bg-reg-accent-button-hover disabled:opacity-50"
            >
              {processing ? (promptLookup(context, 'pleaseWait') || 'Please wait...') : continueToPaymentLabel}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto rounded-lg shadow-xl border border-reg-border overflow-hidden bg-reg-panel text-reg-text">
      {eventImageUrl && (
        <img
          src={eventImageUrl}
          alt={event?.name ? `Event: ${event.name}` : 'Event'}
          className="w-full h-auto block"
        />
      )}
      <div className="p-6 space-y-6">
        <div className="mb-4">
          {offeringIntro ? (
            <HtmlPrompt html={offeringIntro} className="text-base text-reg-text italic" />
          ) : (
            <h2 className="text-lg font-semibold text-reg-accent">{headerLabel}</h2>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {shortcutAmounts.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => applyAmountDollars(d)}
              className="px-4 py-2 rounded border border-reg-border bg-reg-button text-reg-text hover:bg-reg-button-hover tabular-nums"
            >
              {currencySymbol(currency)}
              {d}
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-col md:flex-row gap-4 md:gap-6 items-start">
          <div className="flex-1 text-reg-text text-sm whitespace-pre-wrap">{bodyText}</div>
          <div className="w-full md:w-auto md:flex-none">
            <AmountStepper
              value={amountInput}
              min={minDollars}
              currency={currency}
              onChange={setAmountInput}
              placeholder={Number(minDollars).toFixed(2)}
            />
          </div>
        </div>
        {payError && <p className="text-reg-error text-sm">{payError}</p>}
        {hasValidAmount && (
          <div className="flex justify-end pt-4">
            <button
              type="button"
              onClick={() => {
                setPayError(null);
                setPaymentStep('email');
              }}
              disabled={processing}
              className="w-full max-w-2xl flex items-center justify-between min-h-[2.75rem] px-6 py-2 rounded font-medium transition-colors shadow-lg bg-reg-accent-button text-reg-accent-button-text hover:bg-reg-accent-button-hover disabled:bg-reg-button-disabled disabled:text-reg-text-disabled disabled:cursor-not-allowed"
            >
              <span className="text-sm">
                {processing
                  ? (promptLookup(context, 'pleaseWait') || 'Please wait...')
                  : (promptLookup(context, 'offeringClick') || 'Click here to make an offering')}
              </span>
              <span className="text-sm tabular-nums">{formatAmount(amountCents, currency)}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
