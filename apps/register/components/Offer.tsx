import React, { useState, useEffect, useCallback } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, useStripe, useElements, PaymentElement } from '@stripe/react-stripe-js';

/** React 19 JSX compatibility: @stripe/react-stripe-js types don't match React 19 ReactNode. */
const StripeElements = Elements as unknown as React.JSX.ElementType;
const StripePaymentElement = PaymentElement as unknown as React.JSX.ElementType;
import { getTableItem, getStripeConfig, createStripePaymentIntent, completeOffering } from 'sharedFrontend';
import { promptLookup } from './script/StepComponents';
import type { ScriptContext } from './script/types';

const eventCodeFromContext = (ctx: ScriptContext) => ctx.event?.aid ?? '';

function currencySymbol(currency: string): string {
  return currency === 'USD' ? '$' : currency === 'CAD' ? '$' : currency === 'EUR' ? '€' : '$';
}

function formatAmount(amountCents: number, currency: string): string {
  return `${currencySymbol(currency)}${(amountCents / 100).toFixed(2)} ${currency}`;
}

function isOwyaaPrompt(promptKey: string): boolean {
  const key = String(promptKey).trim();
  const lower = key.toLowerCase();
  // Recognise OWYAA by key name or by label text used in config.
  return (
    key === 'offeringOWYAAButton' ||
    lower === 'owyaa' ||
    lower.includes('owyaa') ||
    key === 'Offer what you are able'
  );
}

/** Full Offering Plus / Sponsoring: prompt key or its label contains "Sponsoring". */
function isSponsoringPrompt(promptKey: string, context: ScriptContext): boolean {
  const label = promptLookup(context, promptKey) || '';
  const key = String(promptKey);
  return key.includes('Sponsoring') || label.includes('Sponsoring');
}

/** True if student has owyaaLease and it is <= 90 days old (can enter amount). */
function hasValidOwyaaLease(student: any): boolean {
  const lease = student?.owyaaLease;
  if (lease == null || typeof lease !== 'string') return false;
  const then = new Date(lease).getTime();
  if (Number.isNaN(then)) return false;
  const days = (Date.now() - then) / (24 * 60 * 60 * 1000);
  return days <= 90;
}

type OfferingConfig = { oid: string; amounts: number[]; fees: number[]; prompts: string[]; config?: Record<string, any> };
type Person = {
  index: number;
  id: string;
  name: string;
  email?: string;
  currentOfferings: Record<string, any>;
  offeringHistory: Record<string, any>;
  whichRetreats?: Record<string, boolean>;
  canOffer: boolean;
  owyaaLease?: string;
};

function useOfferingData(context: ScriptContext) {
  const [configs, setConfigs] = useState<Record<string, OfferingConfig>>({});
  const [fafFull, setFafFull] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!context.event?.subEvents) {
      setLoading(false);
      return;
    }
    const eventCode = eventCodeFromContext(context);
    const student = context.student;
    const oids = new Set<string>();
    Object.values(context.event.subEvents).forEach((se: any) => {
      if (se?.offeringMode) oids.add(se.offeringMode);
    });
    const load = async () => {
      try {
        const configMap: Record<string, OfferingConfig> = {};
        for (const oid of oids) {
          const row = await getTableItem('offering-config', oid, context.pid, context.hash);
          if (row && !row.redirected) configMap[oid] = row;
        }
        setConfigs(configMap);

        const people: Person[] = [];
        const prog = student?.programs?.[eventCode];
        const selfHistory = prog?.offeringHistory ?? {};
        people.push({
          index: 0,
          id: student.id,
          name: [student.first, student.last].filter(Boolean).join(' ') || 'You',
          email: student.email,
          currentOfferings: {},
          offeringHistory: selfHistory,
          whichRetreats: prog?.whichRetreats,
          canOffer: true,
          owyaaLease: student.owyaaLease,
        });
        if (Array.isArray(student.faf)) {
          for (let i = 0; i < student.faf.length; i++) {
            const fid = student.faf[i];
            try {
              const f = await getTableItem('students', fid, context.pid, context.hash);
              if (f && !f.redirected) {
                const fp = f.programs?.[eventCode];
                people.push({
                  index: i + 1,
                  id: f.id,
                  name: [f.first, f.last].filter(Boolean).join(' ') || fid,
                  email: f.email,
                  currentOfferings: {},
                  offeringHistory: fp?.offeringHistory ?? {},
                  whichRetreats: fp?.whichRetreats,
                  canOffer: fp?.join === true,
                  owyaaLease: f.owyaaLease,
                });
              }
            } catch (_) {}
          }
        }
        setFafFull(people);
      } catch (e: any) {
        setError(e.message || 'Failed to load offering data');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [context.event?.subEvents, context.student?.id, context.pid, context.hash]);

  return { configs, fafFull, setFafFull, loading, error };
}

/** Sum of offering amounts in cents (only for persons who canOffer). */
function cartTotalCents(fafFull: Person[]): number {
  let total = 0;
  for (const p of fafFull) {
    if (!p.canOffer) continue;
    for (const obj of Object.values(p.currentOfferings || {})) {
      if (obj?.offeringAmount != null) total += Number(obj.offeringAmount);
    }
  }
  return total;
}

function cartHasOwyaaSelection(fafFull: Person[]): boolean {
  for (const p of fafFull) {
    if (!p.canOffer) continue;
    for (const obj of Object.values(p.currentOfferings || {})) {
      if (!obj) continue;
      const sel = (obj as any).offeringSelection;
      if (typeof sel === 'string' && isOwyaaPrompt(sel)) {
        return true;
      }
    }
  }
  return false;
}

function buildSkuSummary(
  fafFull: Person[],
  currency: string,
  kmFeeCents: number,
): Array<{ personName: string; subEvent: string; offeringSKU?: string; amountCents?: number; currency?: string }> {
  const list: Array<{ personName: string; subEvent: string; offeringSKU?: string; amountCents?: number; currency?: string }> = [];
  for (const p of fafFull) {
    if (!p.canOffer) continue;
    for (const [subEvent, obj] of Object.entries(p.currentOfferings || {})) {
      if (!obj || (obj.offeringSKU == null && obj.offeringAmount == null)) continue;
      list.push({
        personName: p.name,
        subEvent,
        offeringSKU: obj.offeringSKU,
        amountCents: obj.offeringAmount != null ? Number(obj.offeringAmount) : undefined,
        currency,
      });
    }
  }
  if (kmFeeCents > 0) {
    list.push({
      personName: '',
      subEvent: 'kmFee',
      amountCents: kmFeeCents,
      currency,
    });
  }
  return list;
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
  onSuccess: () => void;
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
      setLoading(false);
      onSuccess();
      return;
    }
    setLoading(false);
    onError(paymentIntent?.status === 'requires_action' ? 'Additional authentication is required.' : 'Payment could not be completed.');
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

export const Offer: React.FC<{ context: ScriptContext; onComplete: () => void }> = ({ context, onComplete }) => {
  const eventCode = eventCodeFromContext(context);
  const event = context.event;
  const { configs, fafFull, setFafFull, loading, error } = useOfferingData(context);
  const [paymentStep, setPaymentStep] = useState<'selection' | 'owyaa' | 'sponsoring' | 'stripe'>('selection');
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [publishableKey, setPublishableKey] = useState<string | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [owyaaModal, setOwyaaModal] = useState<{ personIndex: number; subName: string; promptKey: string } | null>(null);
  const [owyaaAmountInput, setOwyaaAmountInput] = useState('');
  const [sponsoringModal, setSponsoringModal] = useState<{
    personIndex: number;
    subName: string;
    promptKey: string;
    minAmountDollars?: number;
  } | null>(null);
  const [sponsoringAmountInput, setSponsoringAmountInput] = useState('');
  // For series offerings: per-person choice between "next only" and "all remaining".
  const [seriesChoiceByPerson, setSeriesChoiceByPerson] = useState<Record<string, 'next' | 'remaining'>>({});

  const studentCountry = context.student?.country;
  const offeringCADPar = event?.config?.offeringCADPar === true;
  const offeringKMFee = event?.config?.offeringKMFee === true;
  const hasOwyaaInCart = cartHasOwyaaSelection(fafFull);
  const currency =
    offeringCADPar && studentCountry === 'Canada'
      ? 'CAD'
      : ((event?.config?.offeringCurrency as string) || 'USD');
  const baseTotalCents = cartTotalCents(fafFull);
  const kmFeeCents = offeringKMFee && !hasOwyaaInCart ? Math.round(baseTotalCents * 0.05) : 0;
  const totalCents = baseTotalCents + kmFeeCents;
  const subEvents = event?.subEvents ? Object.entries(event.subEvents) : [];
  const subEventNames = subEvents.map(([name]) => name);
  const subEventCount = subEvents.length;
  const offeringIntro = promptLookup(context, 'offeringIntroduction') || '';
  const offeringPresentation = event?.config?.offeringPresentation as string | undefined;

  /** Subevent names sorted by date ascending (earliest first). Missing/invalid dates go at the end. */
  const subEventNamesByDate = React.useMemo(() => {
    const withDate = subEvents.map(([name, se]: [string, any]) => {
      const d = se?.date;
      const t =
        typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)
          ? new Date(d + 'T12:00:00').getTime()
          : Number.MAX_SAFE_INTEGER;
      return { name, t };
    });
    withDate.sort((a, b) => a.t - b.t);
    return withDate.map((x) => x.name);
  }, [subEvents]);

  const getUnpaidSubEventsForPerson = (person: Person): string[] => {
    const history = person.offeringHistory || {};
    return subEventNamesByDate.filter((name) => !history[name]);
  };

  /** Sum of amounts for this offering type across all remaining (unpaid) subevents; each subevent may have different amounts. */
  const getRemainingSumCents = useCallback(
    (person: Person, promptKey: string): number => {
      const unpaid = getUnpaidSubEventsForPerson(person);
      let sum = 0;
      for (const name of unpaid) {
        const subEv = event?.subEvents?.[name];
        const oid = subEv?.offeringMode;
        const oc = oid ? configs[oid] : null;
        if (!oc) continue;
        const promptIdx = oc.prompts?.indexOf(promptKey) ?? -1;
        if (promptIdx >= 0) sum += Math.round((oc.amounts[promptIdx] ?? 0) * 100);
      }
      return sum;
    },
    [event?.subEvents, configs, subEventNames],
  );

  /** Sum of amounts[0] across all remaining (unpaid) subevents; used as minimum for offering-plus when "remaining" is selected. */
  const getRemainingMinDollars = useCallback(
    (person: Person): number => {
      const unpaid = getUnpaidSubEventsForPerson(person);
      let sum = 0;
      for (const name of unpaid) {
        const subEv = event?.subEvents?.[name];
        const oid = subEv?.offeringMode;
        const oc = oid ? configs[oid] : null;
        if (!oc || !oc.amounts?.length) continue;
        sum += oc.amounts[0] ?? 0;
      }
      return Math.max(0, sum);
    },
    [event?.subEvents, configs, subEventNames],
  );

  // Which subevents currently have any offering selected (among people who canOffer)?
  const selectedSubEvents = new Set<string>();
  for (const person of fafFull) {
    if (!person.canOffer) continue;
    for (const [name, obj] of Object.entries(person.currentOfferings || {})) {
      if (!obj) continue;
      if (subEventNames.includes(name)) {
        selectedSubEvents.add(name);
      }
    }
  }

  const setPersonOffering = useCallback((personIndex: number, subEventName: string, value: any) => {
    setFafFull((prev) => {
      const next = prev.map((p, i) => {
        if (i !== personIndex) return p;
        const cur = { ...p.currentOfferings };
        if (value == null) delete cur[subEventName];
        else cur[subEventName] = value;
        return { ...p, currentOfferings: cur };
      });
      return next;
    });
  }, [setFafFull]);

  const handlePay = useCallback(async () => {
    if (totalCents <= 0) return;
    setProcessing(true);
    setPayError(null);
    try {
      let pk = publishableKey;
      if (!pk) {
        const configResp = await getStripeConfig(context.pid, context.hash);
        if (configResp && 'redirected' in configResp) return;
        pk = (configResp as { publishableKey: string }).publishableKey;
        if (pk) setPublishableKey(pk);
      }
      let summaryString = fafFull.map((p) => p.name + ': ' + Object.keys(p.currentOfferings || {}).join(', ')).join('; ');
      if (kmFeeCents > 0) {
        summaryString += `; KM fee 5%: ${formatAmount(kmFeeCents, currency)}`;
      }
      const skuSummary = buildSkuSummary(fafFull, currency, kmFeeCents);
      const cart = fafFull.filter((p) => p.canOffer).map((p) => ({
        id: p.id,
        name: p.name,
        currentOfferings: p.currentOfferings,
        offeringHistory: p.offeringHistory,
      }));
      const createResp = await createStripePaymentIntent(context.pid, context.hash, {
        aid: eventCode,
        pid: context.pid,
        amount: totalCents,
        currency,
        description: event?.name || 'Offering',
        cart,
        summaryString,
        skuSummary,
        eventCode,
        eventName: event?.name,
        payerEmail: context.student?.email,
      });
      if (createResp && 'redirected' in createResp) return;
      const { id, clientSecret: secret, publishableKey: createPk } = createResp as { id: string; clientSecret: string; publishableKey?: string };
      if (createPk) setPublishableKey(createPk);
      setClientSecret(secret);
      setPaymentIntentId(id);
      setPaymentStep('stripe');
    } catch (e: any) {
      setPayError(e.message || 'Failed to start payment');
    } finally {
      setProcessing(false);
    }
  }, [context, eventCode, event, fafFull, totalCents, currency, publishableKey]);

  const handlePaymentSuccess = useCallback(async () => {
    if (!paymentIntentId) return;
    setProcessing(true);
    setPayError(null);
    try {
      const cart = fafFull.filter((p) => p.canOffer).map((p) => ({
        id: p.id,
        name: p.name,
        currentOfferings: p.currentOfferings,
        offeringHistory: p.offeringHistory,
      }));
      await completeOffering(context.pid, context.hash, {
        paymentIntentId,
        pid: context.pid,
        eventCode,
        cart,
        subEventNames,
      });
      onComplete();
    } catch (e: any) {
      setPayError(e.message || 'Failed to complete offering');
    } finally {
      setProcessing(false);
    }
  }, [paymentIntentId, fafFull, context, eventCode, subEventNames, onComplete]);

  if (loading) {
    return (
      <div className="max-w-xl mx-auto p-6 text-reg-muted">
        Loading offering...
      </div>
    );
  }
  if (error) {
    return (
      <div className="max-w-xl mx-auto p-6 rounded-lg border border-reg-error bg-reg-error-bg text-reg-error">
        {error}
      </div>
    );
  }

  const hasOfferings = subEvents.some(([, se]: [string, any]) => se?.offeringMode && configs[se.offeringMode]);
  if (!hasOfferings && paymentStep === 'selection') {
    return (
      <div className="max-w-xl mx-auto p-6 text-reg-muted">
        {promptLookup(context, 'offeringNotConfigured') || 'No offerings configured for this event.'}
      </div>
    );
  }

  const rawEventImage = event?.config?.eventImage ?? context.config?.eventImage;
  const eventImageUrl =
    typeof rawEventImage === 'string' && (rawEventImage.startsWith('http://') || rawEventImage.startsWith('https://'))
      ? rawEventImage
      : null;

  if (paymentStep === 'stripe' && clientSecret && publishableKey) {
    const stripePromise = loadStripe(publishableKey);
    return (
      <div className="max-w-2xl mx-auto rounded-lg shadow-xl border border-reg-border overflow-hidden bg-reg-panel text-reg-text">
        {eventImageUrl && (
          <img
            src={eventImageUrl}
            alt={event?.name ? `Event: ${event.name}` : 'Event'}
            className="w-full h-auto block"
          />
        )}
        <div className="p-6">
          <h2 className="text-xl font-semibold text-reg-accent mb-4">{promptLookup(context, 'paymentDetails') || 'Payment details'}</h2>
          {payError && <p className="text-reg-error text-sm mb-4">{payError}</p>}
          <StripeElements stripe={stripePromise} options={{ clientSecret }}>
            <PaymentForm
              clientSecret={clientSecret}
              amount={totalCents}
              currency={currency}
              onSuccess={handlePaymentSuccess}
              onError={setPayError}
              context={context}
            />
          </StripeElements>
        </div>
      </div>
    );
  }

  const openOwyaaCard = (personIndex: number, subName: string, promptKey: string) => {
    setOwyaaModal({ personIndex, subName, promptKey });
    const existing = fafFull[personIndex]?.currentOfferings?.[subName];
    const existingCents = existing?.offeringSelection === promptKey ? existing?.offeringAmount : undefined;
    setOwyaaAmountInput(existingCents != null ? String(Math.round(existingCents / 100)) : '');
    setPaymentStep('owyaa');
  };

  const openSponsoringCard = (
    personIndex: number,
    subName: string,
    promptKey: string,
    defaultAmountDollars: number,
    minAmountDollars?: number,
  ) => {
    const effectiveDefault =
      minAmountDollars !== undefined ? Math.max(defaultAmountDollars, minAmountDollars) : defaultAmountDollars;
    const defaultCents = Math.round(effectiveDefault * 100);
    const subEv = event?.subEvents?.[subName];
    const oid = subEv?.offeringMode;
    const ocLocal = oid ? configs[oid] : null;
    const idx = ocLocal?.prompts?.indexOf(promptKey) ?? -1;
    setPersonOffering(personIndex, subName, {
      offeringSelection: promptKey,
      offeringIndex: idx,
      offeringSKU: `${eventCode}-${subName}-${promptKey}`,
      offeringAmount: defaultCents,
    });
    setSponsoringAmountInput(String(Math.round(effectiveDefault)));
    setSponsoringModal({ personIndex, subName, promptKey, minAmountDollars });
    setPaymentStep('sponsoring');
  };

  if (paymentStep === 'owyaa' && owyaaModal) {
    const person = fafFull[owyaaModal.personIndex];
    if (!person) return null;
    const canEnterAmount = hasValidOwyaaLease(person);
    const subName = owyaaModal.subName;
    const promptKey = owyaaModal.promptKey;
    const headerLabel = promptLookup(context, subName) || subName;
    const offeringIntroOwyaa = promptLookup(context, 'offeringIntroduction') || '';
    const bodyText = canEnterAmount
      ? promptLookup(context, 'offeringOWYAABodyActive')
      : promptLookup(context, 'offeringOWYAABodyEnable');

    const parsed = parseInt(owyaaAmountInput, 10);
    const hasAmount = canEnterAmount && Number.isFinite(parsed) && parsed > 0;

    const handleOwyaaAmountChange = (val: string) => {
      setOwyaaAmountInput(val);
      const num = parseInt(val, 10);
      if (!Number.isFinite(num) || num <= 0) {
        setPersonOffering(owyaaModal.personIndex, subName, null);
        return;
      }
      const amountCents = num * 100;
      const subEv = event?.subEvents?.[subName];
      const oid = subEv?.offeringMode;
      const ocLocal = oid ? configs[oid] : null;
      const idx = ocLocal?.prompts?.indexOf(promptKey) ?? -1;
      setPersonOffering(owyaaModal.personIndex, subName, {
        offeringSelection: promptKey,
        offeringIndex: idx,
        offeringSKU: `${eventCode}-${subName}-${promptKey}`,
        offeringAmount: amountCents,
      });
    };

    const handleOwyaaBack = () => {
      setPaymentStep('selection');
    };

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
            {canEnterAmount && offeringIntroOwyaa ? (
              <p className="text-base text-reg-text italic">{offeringIntroOwyaa}</p>
            ) : (
              <h2 className="text-lg font-semibold text-reg-accent">{headerLabel}</h2>
            )}
          </div>
          <div className="text-reg-text text-sm whitespace-pre-wrap">
            {bodyText}
          </div>
          {!canEnterAmount && (
            <div className="flex justify-start pt-4">
              <button
                type="button"
                onClick={handleOwyaaBack}
                className="px-4 py-2 rounded bg-reg-button text-reg-text hover:bg-reg-button-hover transition-colors"
              >
                {promptLookup(context, 'back') || 'Back'}
              </button>
            </div>
          )}
          {canEnterAmount && (
            <>
              <div className="mt-4">
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={owyaaAmountInput}
                  onChange={(e) => handleOwyaaAmountChange(e.target.value)}
                  className="w-full px-3 py-2 rounded border border-reg-border bg-reg-input text-reg-text"
                  placeholder="0"
                />
              </div>
              {hasAmount && (
                <div className="flex justify-end pt-4">
                  <button
                    type="button"
                    onClick={handlePay}
                    disabled={processing}
                    className="w-full max-w-2xl flex items-center justify-between min-h-[2.75rem] px-6 py-2 rounded font-medium transition-colors shadow-lg bg-reg-accent-button text-reg-accent-button-text hover:bg-reg-accent-button-hover disabled:bg-reg-button-disabled disabled:text-reg-text-disabled disabled:cursor-not-allowed"
                  >
                    <span className="text-sm">
                      {processing ? (promptLookup(context, 'pleaseWait') || 'Please wait...') : (promptLookup(context, 'offeringClick') || 'Click here to make an offering')}
                    </span>
                    <span className="text-sm tabular-nums">{formatAmount(totalCents, currency)}</span>
                  </button>
                </div>
              )}
              <div className="flex justify-start pt-4">
                <button
                  type="button"
                  onClick={handleOwyaaBack}
                  className="px-4 py-2 rounded bg-reg-button text-reg-text hover:bg-reg-button-hover transition-colors"
                >
                  {promptLookup(context, 'back') || 'Back'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  if (paymentStep === 'sponsoring' && sponsoringModal) {
    const person = fafFull[sponsoringModal.personIndex];
    if (!person) return null;
    const subName = sponsoringModal.subName;
    const promptKey = sponsoringModal.promptKey;
    const subEv = event?.subEvents?.[subName];
    const oid = subEv?.offeringMode;
    const ocLocal = oid ? configs[oid] : null;
    const minSponsoringDollars =
      sponsoringModal.minAmountDollars !== undefined
        ? Math.max(0, sponsoringModal.minAmountDollars)
        : Math.max(0, (ocLocal?.amounts && ocLocal.amounts[0]) ?? 0);
    const offeringIntroSponsoring = promptLookup(context, 'offeringIntroduction') || '';
    const bodyText = promptLookup(context, 'offeringSponsoringBody') || promptLookup(context, 'offeringOWYAABodyActive');

    const parsed = parseInt(sponsoringAmountInput, 10);
    const hasAmount = Number.isFinite(parsed) && parsed >= minSponsoringDollars;

    const handleSponsoringAmountChange = (val: string) => {
      // Allow free typing (including backspace) while editing.
      setSponsoringAmountInput(val);
    };

    const commitSponsoringAmount = () => {
      const num = parseInt(sponsoringAmountInput, 10);
      const effectiveDollars = Number.isFinite(num)
        ? Math.max(num, minSponsoringDollars)
        : minSponsoringDollars;

      // If entered value is below the minimum or invalid, snap back to the minimum.
      setSponsoringAmountInput(String(effectiveDollars));

      if (effectiveDollars <= 0) {
        setPersonOffering(sponsoringModal.personIndex, subName, null);
        return;
      }

      const amountCents = effectiveDollars * 100;
      const idx = ocLocal?.prompts?.indexOf(promptKey) ?? -1;
      setPersonOffering(sponsoringModal.personIndex, subName, {
        offeringSelection: promptKey,
        offeringIndex: idx,
        offeringSKU: `${eventCode}-${subName}-${promptKey}`,
        offeringAmount: amountCents,
      });
    };

    const handleSponsoringBack = () => {
      // Make sure the latest typed amount is committed (and clamped)
      // so the main card reflects the chosen Full Offering Plus amount.
      commitSponsoringAmount();
      setSponsoringModal(null);
      setPaymentStep('selection');
    };

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
            {offeringIntroSponsoring ? (
              <p className="text-base text-reg-text italic">{offeringIntroSponsoring}</p>
            ) : null}
          </div>
          <div className="text-reg-text text-sm whitespace-pre-wrap">
            {bodyText}
          </div>
          <div className="mt-4">
            <input
              type="number"
              min={minSponsoringDollars}
              step="1"
              value={sponsoringAmountInput}
              onChange={(e) => handleSponsoringAmountChange(e.target.value)}
              onBlur={commitSponsoringAmount}
              className="w-full px-3 py-2 rounded border border-reg-border bg-reg-input text-reg-text"
              placeholder={String(minSponsoringDollars)}
            />
          </div>
          {hasAmount && (
            <div className="flex flex-col items-end pt-4 space-y-1">
              <button
                type="button"
                onClick={handlePay}
                disabled={processing}
                className="w-full max-w-2xl flex items-center justify-between min-h-[2.75rem] px-6 py-2 rounded font-medium transition-colors shadow-lg bg-reg-accent-button text-reg-accent-button-text hover:bg-reg-accent-button-hover disabled:bg-reg-button-disabled disabled:text-reg-text-disabled disabled:cursor-not-allowed"
              >
                <span className="text-sm">
                  {processing ? (promptLookup(context, 'pleaseWait') || 'Please wait...') : (promptLookup(context, 'offeringClick') || 'Click here to make an offering')}
                </span>
                <span className="text-sm tabular-nums">{formatAmount(totalCents, currency)}</span>
              </button>
              {offeringKMFee && kmFeeCents > 0 && (
                <p className="text-xs text-reg-muted">
                  {(promptLookup(context, 'offeringKMFeeNote') || 'Includes KM 5% Fee:') +
                    ' ' +
                    formatAmount(kmFeeCents, currency)}
                </p>
              )}
            </div>
          )}
          <div className="flex justify-start pt-4">
            <button
              type="button"
              onClick={handleSponsoringBack}
              className="px-4 py-2 rounded bg-reg-button text-reg-text hover:bg-reg-button-hover transition-colors"
            >
              {promptLookup(context, 'back') || 'Back'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Single card for nextAndRemaining: header from first canOffer person's unpaid (sorted) and choice.
  const firstCanOffer = fafFull.find((p) => p.canOffer);
  const unpaidForHeader = firstCanOffer ? getUnpaidSubEventsForPerson(firstCanOffer) : [];
  const choiceForHeader = firstCanOffer ? seriesChoiceByPerson[firstCanOffer.id] || 'next' : 'next';
  const nextAndRemainingHeaderLabel =
    offeringPresentation === 'nextAndRemaining' && unpaidForHeader.length > 0
      ? unpaidForHeader.length === 1
        ? promptLookup(context, unpaidForHeader[0]) || unpaidForHeader[0]
        : choiceForHeader === 'next'
          ? promptLookup(context, unpaidForHeader[0]) || unpaidForHeader[0]
          : unpaidForHeader.map((n) => promptLookup(context, n) || n).join(', ')
      : null;

  if (offeringPresentation === 'nextAndRemaining') {
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
          {payError && <p className="text-reg-error text-sm">{payError}</p>}
          <div className="p-6 rounded-lg border border-reg-border bg-reg-card-muted">
            {nextAndRemainingHeaderLabel != null ? (
              <div className="flex items-baseline justify-between mb-4 gap-4">
                <h3 className="text-lg font-semibold text-reg-accent">{nextAndRemainingHeaderLabel}</h3>
                {offeringIntro && (
                  <p className="text-base text-reg-muted max-w-xs text-right italic">{offeringIntro}</p>
                )}
              </div>
            ) : offeringIntro ? (
              <p className="mb-4 text-base text-reg-text italic">{offeringIntro}</p>
            ) : null}
            {fafFull.map((person, pIdx) => {
              const unpaid = getUnpaidSubEventsForPerson(person);
              if (unpaid.length === 0) return null;
              const nextSubName = unpaid[0];
              const subEv = event?.subEvents?.[nextSubName];
              const oid = subEv?.offeringMode;
              const oc = oid ? configs[oid] : null;
              if (!oc) return null;
              return (
                <div key={person.id} className="mb-4 pt-3 border-t border-reg-border">
                  <p className="text-sm font-semibold text-reg-text mb-2">
                    {person.name}
                    {person.index >= 1 && !person.canOffer && (
                      <span className="ml-2 text-reg-muted font-normal">
                        {promptLookup(context, 'fafNotJoined')}
                      </span>
                    )}
                  </p>
                  {person.canOffer ? (
                    <div className="space-y-2">
                      {unpaid.length >= 2 && (() => {
                        const remainingCount = unpaid.length;
                        const choice = seriesChoiceByPerson[person.id] || 'next';
                        const nextLabel = promptLookup(context, 'next') || 'Next event only';
                        const remainingTemplate =
                          promptLookup(context, 'remaining') || 'All |X| remaining events in the series';
                        const remainingLabel = remainingTemplate.replace('|X|', String(remainingCount));
                        const question =
                          promptLookup(context, 'nextOrRemaining') ||
                          'Will you be making an offering for the next event only or all remaining events in the series?';
                        return (
                          <>
                            <div className="mb-3 space-y-2">
                              <p className="text-sm text-reg-text">{question}</p>
                              <div className="flex flex-wrap gap-3">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setSeriesChoiceByPerson((prev) => ({ ...prev, [person.id]: 'next' }))
                                  }
                                  className={`px-3 py-1 rounded text-xs font-medium border ${
                                    choice === 'next'
                                      ? 'bg-reg-accent-button text-reg-accent-button-text border-reg-accent-button'
                                      : 'bg-reg-card border-reg-border text-reg-text hover:border-reg-border-light'
                                  }`}
                                >
                                  {nextLabel}
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setSeriesChoiceByPerson((prev) => ({ ...prev, [person.id]: 'remaining' }))
                                  }
                                  className={`px-3 py-1 rounded text-xs font-medium border ${
                                    choice === 'remaining'
                                      ? 'bg-reg-accent-button text-reg-accent-button-text border-reg-accent-button'
                                      : 'bg-reg-card border-reg-border text-reg-text hover:border-reg-border-light'
                                  }`}
                                >
                                  {remainingLabel}
                                </button>
                              </div>
                            </div>
                            <div className="border-t border-reg-border my-3" />
                          </>
                        );
                      })()}
                      {oc.prompts.map((promptKey, idx) => {
                        const amount = oc.amounts[idx] ?? 0;
                        const baseAmountCents = Math.round((amount ?? 0) * 100);
                        const isOwyaa = isOwyaaPrompt(promptKey);
                        const isSponsoring = isSponsoringPrompt(promptKey, context);
                        const isSelected =
                          person.currentOfferings[nextSubName]?.offeringSelection === promptKey ||
                          person.currentOfferings[nextSubName]?.offeringIndex === idx;
                        const current = person.currentOfferings[nextSubName];
                        const owyaaSelectedAmountCents =
                          isOwyaa && isSelected && typeof current?.offeringAmount === 'number'
                            ? current.offeringAmount
                            : undefined;
                        const defaultSponsoringDollars = (oc.amounts && oc.amounts[0]) ?? 0;
                        const defaultSponsoringCents = Math.round(defaultSponsoringDollars * 100);
                        const offeringOWYAAButtonText = promptLookup(context, 'offeringOWYAAButton') || 'OWYAA';
                        const owyaaEnabled = hasValidOwyaaLease(person);
                        const owyaaButtonLabel =
                          owyaaSelectedAmountCents != null
                            ? formatAmount(owyaaSelectedAmountCents, currency)
                            : owyaaEnabled
                              ? offeringOWYAAButtonText
                              : promptLookup(context, 'enable') || 'Enable';
                        const sponsoringSelectedAmountCents =
                          isSponsoring && isSelected && typeof current?.offeringAmount === 'number'
                            ? current.offeringAmount
                            : undefined;
                        const remainingCount = unpaid.length;
                        const seriesChoice = seriesChoiceByPerson[person.id] || 'next';
                        const isNextAndRemainingContext = remainingCount >= 2;
                        const displayAmountCents =
                          isNextAndRemainingContext && seriesChoice === 'remaining' && remainingCount > 1
                            ? getRemainingSumCents(person, promptKey)
                            : baseAmountCents;
                        const defaultSponsoringDisplayCents =
                          isNextAndRemainingContext && seriesChoice === 'remaining' && remainingCount > 1
                            ? getRemainingSumCents(person, promptKey)
                            : defaultSponsoringCents;
                        const sponsoringButtonLabel = formatAmount(
                          sponsoringSelectedAmountCents ?? defaultSponsoringDisplayCents,
                          currency,
                        );
                        if (isNextAndRemainingContext && seriesChoice === 'remaining' && isOwyaa) {
                          return null;
                        }
                        const handleSelectFixedAmount = () => {
                          if (isNextAndRemainingContext && seriesChoice === 'remaining') {
                            setFafFull((prev) => {
                              const next = prev.map((p, i) => {
                                if (i !== pIdx) return p;
                                const cur = { ...(p.currentOfferings || {}) };
                                unpaid.forEach((name) => {
                                  const subEvFor = event?.subEvents?.[name];
                                  const oidFor = subEvFor?.offeringMode;
                                  const ocForSub = oidFor ? configs[oidFor] : null;
                                  const promptIdxForSub = ocForSub?.prompts?.indexOf(promptKey) ?? -1;
                                  const amountForSub =
                                    promptIdxForSub >= 0
                                      ? Math.round((ocForSub!.amounts[promptIdxForSub] ?? 0) * 100)
                                      : 0;
                                  cur[name] = {
                                    offeringSelection: promptKey,
                                    offeringIndex: promptIdxForSub >= 0 ? promptIdxForSub : idx,
                                    offeringSKU: `${eventCode}-${name}-${promptKey}`,
                                    offeringAmount: amountForSub,
                                  };
                                });
                                return { ...p, currentOfferings: cur };
                              });
                              return next;
                            });
                          } else {
                            setPersonOffering(pIdx, nextSubName, {
                              offeringSelection: promptKey,
                              offeringIndex: idx,
                              offeringSKU: `${eventCode}-${nextSubName}-${promptKey}`,
                              offeringAmount: baseAmountCents,
                            });
                          }
                        };
                        return (
                          <div key={promptKey} className="flex items-center justify-between gap-4">
                            <span className="text-reg-text text-sm flex-1">
                              {promptLookup(context, promptKey) || promptKey}
                            </span>
                            {isOwyaa ? (
                              <button
                                type="button"
                                onClick={() => openOwyaaCard(pIdx, nextSubName, promptKey)}
                                className={`min-w-[8rem] px-4 py-2 rounded text-sm font-medium transition-colors shadow-lg ${
                                  owyaaSelectedAmountCents != null
                                    ? 'bg-reg-accent-button text-reg-accent-button-text hover:bg-reg-accent-button-hover text-right'
                                    : 'bg-reg-card border border-reg-border text-reg-text hover:border-reg-border-light hover:bg-reg-card-muted text-center'
                                }`}
                              >
                                {owyaaButtonLabel}
                              </button>
                            ) : isSponsoring ? (
                              <button
                                type="button"
                                onClick={() => {
                                  const minDollars =
                                    isNextAndRemainingContext && seriesChoice === 'remaining' && remainingCount > 1
                                      ? getRemainingMinDollars(person)
                                      : undefined;
                                  openSponsoringCard(
                                    pIdx,
                                    nextSubName,
                                    promptKey,
                                    defaultSponsoringDollars,
                                    minDollars,
                                  );
                                }}
                                className={`min-w-[8rem] px-4 py-2 rounded text-sm font-medium transition-colors shadow-lg text-right ${
                                  isSelected
                                    ? 'bg-reg-accent-button text-reg-accent-button-text hover:bg-reg-accent-button-hover'
                                    : 'bg-reg-card border border-reg-border text-reg-text hover:border-reg-border-light hover:bg-reg-card-muted'
                                }`}
                              >
                                {sponsoringButtonLabel}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={handleSelectFixedAmount}
                                className={`min-w-[8rem] px-4 py-2 rounded text-sm text-right font-medium transition-colors shadow-lg ${
                                  isSelected
                                    ? 'bg-reg-accent-button text-reg-accent-button-text hover:bg-reg-accent-button-hover'
                                    : 'bg-reg-card border border-reg-border text-reg-text hover:border-reg-border-light hover:bg-reg-card-muted'
                                }`}
                              >
                                {formatAmount(displayAmountCents, currency)}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          {totalCents > 0 && (
            <div className="flex flex-col items-end pt-4 space-y-1">
              <button
                type="button"
                onClick={handlePay}
                disabled={processing}
                className="w-full max-w-2xl flex items-center justify-between min-h-[2.75rem] px-6 py-2 rounded font-medium transition-colors shadow-lg bg-reg-accent-button text-reg-accent-button-text hover:bg-reg-accent-button-hover disabled:bg-reg-button-disabled disabled:text-reg-text-disabled disabled:cursor-not-allowed"
              >
                <span className="text-sm">
                  {processing ? (promptLookup(context, 'pleaseWait') || 'Please wait...') : (promptLookup(context, 'offeringClick') || 'Click here to make an offering')}
                </span>
                <span className="text-sm tabular-nums">{formatAmount(totalCents, currency)}</span>
              </button>
              {offeringKMFee && kmFeeCents > 0 && (
                <p className="text-xs text-reg-muted">
                  {(promptLookup(context, 'offeringKMFeeNote') || 'Includes KM 5% Fee:') +
                    ' ' +
                    formatAmount(kmFeeCents, currency)}
                </p>
              )}
            </div>
          )}
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
      {payError && <p className="text-reg-error text-sm">{payError}</p>}
      {subEvents.map(([subName, subEvent]: [string, any]) => {
        const oid = subEvent?.offeringMode;
        const oc = oid ? configs[oid] : null;
        if (!oc) return null;

        // Header label logic based on number of subevents and what user is offering for.
        let headerLabel: string | null = null;
        if (subEventCount === 1) {
          headerLabel = null;
        } else {
          const selectedCount = selectedSubEvents.size;
          if (selectedCount === 1) {
            const onlyName = Array.from(selectedSubEvents)[0];
            headerLabel = promptLookup(context, onlyName) || onlyName;
          } else if (selectedCount === subEventCount && subEventCount >= 2) {
            const firstName = subEvents[0][0];
            const lastName = subEvents[subEvents.length - 1][0];
            const firstLabel = promptLookup(context, firstName) || firstName;
            const lastLabel = promptLookup(context, lastName) || lastName;
            headerLabel = `${firstLabel} - ${lastLabel}`;
          } else {
            headerLabel = promptLookup(context, subName) || subName;
          }
        }

        return (
          <div key={subName} className="p-6 rounded-lg border border-reg-border bg-reg-card-muted">
            {subEventCount === 1 ? (
              offeringIntro && (
                <p className="mb-4 text-base text-reg-text italic">
                  {offeringIntro}
                </p>
              )
            ) : (
              <div className="flex items-baseline justify-between mb-4 gap-4">
                {headerLabel && (
                  <h3 className="text-lg font-semibold text-reg-accent">{headerLabel}</h3>
                )}
                {offeringIntro && (
                  <p className="text-base text-reg-muted max-w-xs text-right italic">
                    {offeringIntro}
                  </p>
                )}
              </div>
            )}
            {fafFull.map((person, pIdx) => (
              <div key={person.id} className="mb-4 pt-3 border-t border-reg-border">
                <p className="text-sm font-semibold text-reg-text mb-2">
                  {person.name}
                  {person.index >= 1 && !person.canOffer && (
                    <span className="ml-2 text-reg-muted font-normal">
                      {promptLookup(context, 'fafNotJoined')}
                    </span>
                  )}
                </p>
                {person.canOffer ? (
                  <div className="space-y-2">
                    {offeringPresentation === 'nextAndRemaining' && (() => {
                      const unpaid = getUnpaidSubEventsForPerson(person);
                      if (unpaid.length <= 1) return null;
                      const nextSubName = unpaid[0];
                      if (subName !== nextSubName) return null;
                      const remainingCount = unpaid.length;
                      const choice = seriesChoiceByPerson[person.id] || 'next';
                      const nextLabel = promptLookup(context, 'next') || 'Next event only';
                      const remainingTemplate =
                        promptLookup(context, 'remaining') || 'All |X| remaining events in the series';
                      const remainingLabel = remainingTemplate.replace('|X|', String(remainingCount));
                      const question =
                        promptLookup(context, 'nextOrRemaining') ||
                        'Will you be making an offering for the next event only or all remaining events in the series?';
                      return (
                        <>
                          <div className="mb-3 space-y-2">
                            <p className="text-sm text-reg-text">{question}</p>
                            <div className="flex flex-wrap gap-3">
                              <button
                                type="button"
                                onClick={() =>
                                  setSeriesChoiceByPerson((prev) => ({ ...prev, [person.id]: 'next' }))
                                }
                                className={`px-3 py-1 rounded text-xs font-medium border ${
                                  choice === 'next'
                                    ? 'bg-reg-accent-button text-reg-accent-button-text border-reg-accent-button'
                                    : 'bg-reg-card border-reg-border text-reg-text hover:border-reg-border-light'
                                }`}
                              >
                                {nextLabel}
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setSeriesChoiceByPerson((prev) => ({ ...prev, [person.id]: 'remaining' }))
                                }
                                className={`px-3 py-1 rounded text-xs font-medium border ${
                                  choice === 'remaining'
                                    ? 'bg-reg-accent-button text-reg-accent-button-text border-reg-accent-button'
                                    : 'bg-reg-card border-reg-border text-reg-text hover:border-reg-border-light'
                                }`}
                              >
                                {remainingLabel}
                              </button>
                            </div>
                          </div>
                          <div className="border-t border-reg-border my-3" />
                        </>
                      );
                    })()}
                    {oc.prompts.map((promptKey, idx) => {
                      const amount = oc.amounts[idx] ?? 0;
                      const baseAmountCents = Math.round((amount ?? 0) * 100);
                      const isOwyaa = isOwyaaPrompt(promptKey);
                      const isSponsoring = isSponsoringPrompt(promptKey, context);
                      const isSelected =
                        person.currentOfferings[subName]?.offeringSelection === promptKey ||
                        person.currentOfferings[subName]?.offeringIndex === idx;
                      const current = person.currentOfferings[subName];
                      const owyaaSelectedAmountCents =
                        isOwyaa && isSelected && typeof current?.offeringAmount === 'number'
                          ? current.offeringAmount
                          : undefined;
                      const defaultSponsoringDollars = (oc.amounts && oc.amounts[0]) ?? 0;
                      const defaultSponsoringCents = Math.round(defaultSponsoringDollars * 100);
                      const offeringOWYAAButtonText = promptLookup(context, 'offeringOWYAAButton') || 'OWYAA';
                      const owyaaEnabled = hasValidOwyaaLease(person);
                      const owyaaButtonLabel =
                        owyaaSelectedAmountCents != null
                          ? formatAmount(owyaaSelectedAmountCents, currency)
                          : owyaaEnabled
                            ? offeringOWYAAButtonText
                            : promptLookup(context, 'enable') || 'Enable';
                      const sponsoringSelectedAmountCents =
                        isSponsoring && isSelected && typeof current?.offeringAmount === 'number'
                          ? current.offeringAmount
                          : undefined;
                      // nextAndRemaining presentation: per-person choice of covering only the next unpaid event
                      // or all remaining unpaid events in the series, with button amounts scaled accordingly.
                      let seriesChoice: 'next' | 'remaining' | null = null;
                      let remainingCount = 0;
                      let isNextAndRemainingContext = false;
                      if (offeringPresentation === 'nextAndRemaining') {
                        const unpaid = getUnpaidSubEventsForPerson(person);
                        remainingCount = unpaid.length;
                        if (remainingCount >= 2) {
                          const nextSubName = unpaid[0];
                          if (subName === nextSubName) {
                            isNextAndRemainingContext = true;
                            seriesChoice = seriesChoiceByPerson[person.id] || 'next';
                          } else {
                            // This person has multiple unpaid events but this is not the "next" one:
                            // do not render per-event buttons here.
                            return null;
                          }
                        }
                      }

                      const displayAmountCents =
                        isNextAndRemainingContext && seriesChoice === 'remaining' && remainingCount > 1
                          ? getRemainingSumCents(person, promptKey)
                          : baseAmountCents;

                      const defaultSponsoringDisplayCents =
                        isNextAndRemainingContext && seriesChoice === 'remaining' && remainingCount > 1
                          ? getRemainingSumCents(person, promptKey)
                          : defaultSponsoringCents;
                      const sponsoringButtonLabel = formatAmount(
                        sponsoringSelectedAmountCents ?? defaultSponsoringDisplayCents,
                        currency,
                      );

                      // When covering all remaining events, OWYAA is not offered.
                      if (isNextAndRemainingContext && seriesChoice === 'remaining' && isOwyaa) {
                        return null;
                      }

                      const handleSelectFixedAmount = () => {
                        if (isNextAndRemainingContext && seriesChoice === 'remaining') {
                          const unpaid = getUnpaidSubEventsForPerson(person);
                          setFafFull((prev) => {
                            const next = prev.map((p, i) => {
                              if (i !== pIdx) return p;
                              const cur = { ...(p.currentOfferings || {}) };
                              unpaid.forEach((name) => {
                                const subEv = event?.subEvents?.[name];
                                const oid = subEv?.offeringMode;
                                const ocForSub = oid ? configs[oid] : null;
                                const promptIdxForSub = ocForSub?.prompts?.indexOf(promptKey) ?? -1;
                                const amountForSub =
                                  promptIdxForSub >= 0
                                    ? Math.round((ocForSub!.amounts[promptIdxForSub] ?? 0) * 100)
                                    : 0;
                                cur[name] = {
                                  offeringSelection: promptKey,
                                  offeringIndex: promptIdxForSub >= 0 ? promptIdxForSub : idx,
                                  offeringSKU: `${eventCode}-${name}-${promptKey}`,
                                  offeringAmount: amountForSub,
                                };
                              });
                              return { ...p, currentOfferings: cur };
                            });
                            return next;
                          });
                        } else {
                          setPersonOffering(pIdx, subName, {
                            offeringSelection: promptKey,
                            offeringIndex: idx,
                            offeringSKU: `${eventCode}-${subName}-${promptKey}`,
                            offeringAmount: baseAmountCents,
                          });
                        }
                      };

                      return (
                        <div key={promptKey} className="flex items-center justify-between gap-4">
                          <span className="text-reg-text text-sm flex-1">
                            {promptLookup(context, promptKey) || promptKey}
                          </span>
                          {isOwyaa ? (
                            <button
                              type="button"
                              onClick={() => openOwyaaCard(pIdx, subName, promptKey)}
                              className={`min-w-[8rem] px-4 py-2 rounded text-sm font-medium transition-colors shadow-lg ${
                                owyaaSelectedAmountCents != null
                                  ? 'bg-reg-accent-button text-reg-accent-button-text hover:bg-reg-accent-button-hover text-right'
                                  : 'bg-reg-card border border-reg-border text-reg-text hover:border-reg-border-light hover:bg-reg-card-muted text-center'
                              }`}
                            >
                              {owyaaButtonLabel}
                            </button>
                          ) : isSponsoring ? (
                            <button
                              type="button"
                              onClick={() => {
                                const minDollars =
                                  isNextAndRemainingContext && seriesChoice === 'remaining' && remainingCount > 1
                                    ? getRemainingMinDollars(person)
                                    : undefined;
                                openSponsoringCard(
                                  pIdx,
                                  subName,
                                  promptKey,
                                  defaultSponsoringDollars,
                                  minDollars,
                                );
                              }}
                              className={`min-w-[8rem] px-4 py-2 rounded text-sm font-medium transition-colors shadow-lg text-right ${
                                isSelected
                                  ? 'bg-reg-accent-button text-reg-accent-button-text hover:bg-reg-accent-button-hover'
                                  : 'bg-reg-card border border-reg-border text-reg-text hover:border-reg-border-light hover:bg-reg-card-muted'
                              }`}
                            >
                              {sponsoringButtonLabel}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={handleSelectFixedAmount}
                              className={`min-w-[8rem] px-4 py-2 rounded text-sm text-right font-medium transition-colors shadow-lg ${
                                isSelected
                                  ? 'bg-reg-accent-button text-reg-accent-button-text hover:bg-reg-accent-button-hover'
                                  : 'bg-reg-card border border-reg-border text-reg-text hover:border-reg-border-light hover:bg-reg-card-muted'
                              }`}
                            >
                              {formatAmount(displayAmountCents, currency)}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        );
      })}
      {totalCents > 0 && (
        <div className="flex flex-col items-end pt-4 space-y-1">
          <button
            type="button"
            onClick={handlePay}
            disabled={processing}
            className="w-full max-w-2xl flex items-center justify-between min-h-[2.75rem] px-6 py-2 rounded font-medium transition-colors shadow-lg bg-reg-accent-button text-reg-accent-button-text hover:bg-reg-accent-button-hover disabled:bg-reg-button-disabled disabled:text-reg-text-disabled disabled:cursor-not-allowed"
          >
            <span className="text-sm">
              {processing ? (promptLookup(context, 'pleaseWait') || 'Please wait...') : (promptLookup(context, 'offeringClick') || 'Click here to make an offering')}
            </span>
            <span className="text-sm tabular-nums">{formatAmount(totalCents, currency)}</span>
          </button>
          {offeringKMFee && kmFeeCents > 0 && (
            <p className="text-xs text-reg-muted">
              {(promptLookup(context, 'offeringKMFeeNote') || 'Includes KM 5% Fee:') +
                ' ' +
                formatAmount(kmFeeCents, currency)}
            </p>
          )}
        </div>
      )}
      </div>
    </div>
  );
};
