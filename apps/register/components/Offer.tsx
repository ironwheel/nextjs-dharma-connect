import React, { useState, useEffect, useCallback } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, useStripe, useElements, PaymentElement } from '@stripe/react-stripe-js';

/** React 19 JSX compatibility: @stripe/react-stripe-js types don't match React 19 ReactNode. */
const StripeElements = Elements as unknown as React.JSX.ElementType;
const StripePaymentElement = PaymentElement as unknown as React.JSX.ElementType;
import {
  getTableItem,
  getStripeConfig,
  createStripePaymentIntent,
  createMockOfferingTransaction,
  completeOffering,
  sumInstallmentPaymentsCents,
} from 'sharedFrontend';
import { promptLookup } from './script/StepComponents';
import type { ScriptContext } from './script/types';

const eventCodeFromContext = (ctx: ScriptContext) => ctx.event?.aid ?? '';

/** promptLookup returns `${aid}-${key}-${lang}-unknown` when missing; treat as no prompt. */
function isPromptTextResolved(text: string | undefined): boolean {
  const t = String(text ?? '').trim();
  return t !== '' && !t.endsWith('-unknown');
}

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

function clampMoney(n: number, min: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, n);
}

function AmountStepper({
  value,
  min,
  max,
  step = 1,
  currency,
  onChange,
  placeholder,
}: {
  value: string;
  min: number;
  max?: number;
  step?: number;
  currency: string;
  onChange: (val: string) => void;
  placeholder?: string;
}) {
  const parsed = parseMoneyDollars(value);
  const current = Number.isFinite(parsed) ? parsed : min;
  const hasMax = typeof max === 'number' && Number.isFinite(max);
  const atOrBelowMin = current <= min;
  const atOrAboveMax = hasMax ? current >= (max as number) : false;

  const bump = (delta: number) => {
    const nextRaw = clampMoney(current + delta, min);
    const next = hasMax ? Math.min(nextRaw, max as number) : nextRaw;
    onChange(next.toFixed(2));
  };

  return (
    <div className="flex justify-end">
      <div className="flex items-stretch gap-2">
      <button
        type="button"
        onClick={() => bump(-step)}
        disabled={atOrBelowMin}
        aria-label="Decrease amount"
        className="w-12 rounded border border-reg-border bg-reg-card text-reg-text hover:bg-reg-card-muted transition-colors text-xl font-semibold disabled:bg-reg-button-disabled disabled:text-reg-text-disabled disabled:cursor-not-allowed"
      >
        −
      </button>
      <div className="flex items-stretch rounded border border-reg-border overflow-hidden bg-reg-input text-reg-text">
        <div className="px-3 flex items-center text-sm text-reg-muted border-r border-reg-border select-none">
          {currencySymbol(currency)}
        </div>
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-[7.25rem] px-3 py-3 bg-transparent text-sm tabular-nums text-right outline-none"
          placeholder={placeholder}
        />
        <div className="px-3 flex items-center text-sm text-reg-muted border-l border-reg-border select-none">
          {currency}
        </div>
      </div>
      <button
        type="button"
        onClick={() => bump(step)}
        disabled={atOrAboveMax}
        aria-label="Increase amount"
        className="w-12 rounded border border-reg-border bg-reg-card text-reg-text hover:bg-reg-card-muted transition-colors text-xl font-semibold disabled:bg-reg-button-disabled disabled:text-reg-text-disabled disabled:cursor-not-allowed"
      >
        +
      </button>
      </div>
    </div>
  );
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

function isHeartGiftConfig(oc: OfferingConfig | null | undefined): boolean {
  return oc?.config?.mode === 'variable';
}

function heartGiftButtonPromptKey(promptKey: string): string {
  return promptKey === 'offeringHeartGift' ? 'offeringHeartGiftButton' : promptKey;
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

type InstallmentsRetreatConfig = {
  prompt?: string;
  offeringMinimum?: number;
  offeringTotal?: number;
  offeringCashTotal?: number;
  /** When true, retreat is at capacity; selected students may be wait-listed (see waitListWarning prompt). */
  retreatFull?: boolean;
};

type InstallmentsStatus = 'incomplete' | 'complete' | 'overpaid';

function useOfferingData(context: ScriptContext) {
  const [configs, setConfigs] = useState<Record<string, OfferingConfig>>({});
  const [fafFull, setFafFull] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  React.useLayoutEffect(() => {
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
      // Keep the button disabled while we finalize the offering server-side.
      // (Otherwise the form briefly re-enables before the UI transitions away.)
      setMessage(promptLookup(context, 'stripeCaptureLoading') || 'Finalizing your offering…');
      try {
        await onSuccess();
      } catch (e: any) {
        onError(e?.message || 'Failed to complete offering');
        setLoading(false);
      }
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

export const Offer: React.FC<{ context: ScriptContext; onComplete: () => void | Promise<void> }> = ({ context, onComplete }) => {
  const eventCode = eventCodeFromContext(context);
  const event = context.event;
  const isRegisterTestMode = context.student?.debug?.registerTest === true;
  const { configs, fafFull, setFafFull, loading, error } = useOfferingData(context);
  const [paymentStep, setPaymentStep] = useState<'selection' | 'owyaa' | 'heartGift' | 'sponsoring' | 'stripe'>('selection');
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [publishableKey, setPublishableKey] = useState<string | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
  const [checkoutCart, setCheckoutCart] = useState<Array<{ id: string; name: string; currentOfferings?: Record<string, any>; offeringHistory?: Record<string, any> }> | null>(null);
  const [processing, setProcessing] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [owyaaModal, setOwyaaModal] = useState<{ personIndex: number; subName: string; promptKey: string } | null>(null);
  const [owyaaAmountInput, setOwyaaAmountInput] = useState('');
  const [heartGiftModal, setHeartGiftModal] = useState<{
    personIndex: number;
    subName: string;
    promptKey: string;
    initialAmountDollars?: number;
    minAmountDollars?: number;
  } | null>(null);
  const [heartGiftAmountInput, setHeartGiftAmountInput] = useState('');
  const [sponsoringModal, setSponsoringModal] = useState<{
    personIndex: number;
    subName: string;
    promptKey: string;
    minAmountDollars?: number;
  } | null>(null);
  const [sponsoringAmountInput, setSponsoringAmountInput] = useState('');
  const [installmentsAmountInputByPerson, setInstallmentsAmountInputByPerson] = useState<Record<string, string>>({});
  // For series offerings: per-person choice between "next only" and "all remaining".
  const [seriesChoiceByPerson, setSeriesChoiceByPerson] = useState<Record<string, 'next' | 'remaining'>>({});

  const studentCountry = context.student?.country;
  const offeringCADPar = event?.config?.offeringCADPar === true;
  const offeringKMFee = event?.config?.offeringKMFee === true;
  const offeringPresentation = event?.config?.offeringPresentation as string | undefined;
  const hasOwyaaInCart = cartHasOwyaaSelection(fafFull);
  const currency =
    offeringPresentation === 'installments'
      ? ((event?.config?.offeringCurrency as string) || 'USD')
      : offeringCADPar && studentCountry === 'Canada'
        ? 'CAD'
        : ((event?.config?.offeringCurrency as string) || 'USD');
  const baseTotalCents = cartTotalCents(fafFull);
  const kmFeeCents = offeringKMFee && !hasOwyaaInCart ? Math.round(baseTotalCents * 0.05) : 0;
  const totalCents = baseTotalCents + kmFeeCents;
  const subEvents = event?.subEvents ? Object.entries(event.subEvents) : [];
  const subEventNames = subEvents.map(([name]) => name);
  const subEventCount = subEvents.length;
  const offeringIntro = promptLookup(context, 'offeringIntroduction') || '';
  const isInstallmentsPresentation = offeringPresentation === 'installments';
  const installmentStepDollarsRaw = Number(event?.config?.installmentStep);
  const installmentStepDollars =
    Number.isFinite(installmentStepDollarsRaw) && installmentStepDollarsRaw > 0
      ? installmentStepDollarsRaw
      : 1;
  const installmentsIntroduction = promptLookup(context, 'installmentsIntroduction') || '';
  const waitListWarningRaw = promptLookup(context, 'waitListWarning');
  const waitListWarningHtml = isPromptTextResolved(waitListWarningRaw) ? waitListWarningRaw : '';
  const offeringsReceivedPrompt = promptLookup(context, 'offeringsReceived') || 'Offerings Received:';
  const balanceDuePrompt = promptLookup(context, 'balanceDue') || 'Balance Due:';

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

  const installmentsSubEventName = React.useMemo(() => {
    if (!isInstallmentsPresentation) return '';
    if (event?.subEvents?.retreat) return 'retreat';
    return subEventNamesByDate[0] || subEventNames[0] || 'retreat';
  }, [isInstallmentsPresentation, event?.subEvents, subEventNamesByDate, subEventNames]);

  const installmentsRetreatConfig = React.useMemo(() => {
    if (!isInstallmentsPresentation) return null;
    const cfg = event?.config?.whichRetreatsConfig;
    if (!cfg || typeof cfg !== 'object') return null;
    return cfg as Record<string, InstallmentsRetreatConfig>;
  }, [isInstallmentsPresentation, event?.config?.whichRetreatsConfig]);

  const getInstallmentsSummary = useCallback((person: Person) => {
    if (!isInstallmentsPresentation) {
      return { ok: false as const, error: 'Installments mode is not active.' };
    }
    if (!installmentsRetreatConfig) {
      return { ok: false as const, error: 'Installments configuration is missing for this event.' };
    }
    const whichRetreats = person.whichRetreats;
    if (!whichRetreats || typeof whichRetreats !== 'object') {
      return { ok: false as const, error: 'Your retreat selections were not found for this event.' };
    }
    const selectedRetreats = Object.entries(whichRetreats)
      .filter(([, selected]) => selected === true)
      .map(([retreatKey]) => retreatKey);
    if (selectedRetreats.length === 0) {
      return { ok: false as const, error: 'No retreats were selected for installments offering.' };
    }
    for (const retreatKey of selectedRetreats) {
      if (!installmentsRetreatConfig[retreatKey]) {
        return {
          ok: false as const,
          error: `Selected retreat "${retreatKey}" is missing from whichRetreatsConfig.`,
        };
      }
      const promptKey = installmentsRetreatConfig[retreatKey]?.prompt;
      if (typeof promptKey !== 'string' || promptKey.trim() === '') {
        return {
          ok: false as const,
          error: `Selected retreat "${retreatKey}" is missing a prompt in whichRetreatsConfig.`,
        };
      }
    }

    const minimumDueCents = selectedRetreats.reduce((sum, retreatKey) => {
      const n = Number(installmentsRetreatConfig[retreatKey]?.offeringMinimum ?? 0);
      return sum + Math.max(0, Math.round(n * 100));
    }, 0);
    const maximumDueCents = selectedRetreats.reduce((sum, retreatKey) => {
      const total = Number(installmentsRetreatConfig[retreatKey]?.offeringTotal ?? 0);
      const cashTotal = Number(installmentsRetreatConfig[retreatKey]?.offeringCashTotal ?? 0);
      return sum + Math.max(0, Math.round((total - cashTotal) * 100));
    }, 0);

    const historyEntry = person.offeringHistory?.[installmentsSubEventName] || {};
    const installmentHistory = historyEntry?.installments || {};
    const offeredSoFarCents = sumInstallmentPaymentsCents(installmentHistory);
    const balanceDueCents = Math.max(0, maximumDueCents - offeredSoFarCents);
    const status: InstallmentsStatus =
      offeredSoFarCents > maximumDueCents ? 'overpaid' : offeredSoFarCents >= maximumDueCents ? 'complete' : 'incomplete';

    const hasSelectedRetreatFull = selectedRetreats.some(
      (k) => installmentsRetreatConfig[k]?.retreatFull === true,
    );

    return {
      ok: true as const,
      selectedRetreats,
      minimumDueCents,
      maximumDueCents,
      offeredSoFarCents,
      balanceDueCents,
      status,
      hasSelectedRetreatFull,
      retreatPromptKeys: selectedRetreats.map((k) => installmentsRetreatConfig[k]?.prompt || k),
    };
  }, [isInstallmentsPresentation, installmentsRetreatConfig, installmentsSubEventName]);

  useEffect(() => {
    if (!isInstallmentsPresentation || paymentStep !== 'selection') return;
    setFafFull((prev) =>
      prev.map((person, pIdx) => {
        if (!person.canOffer) return person;
        const summary = getInstallmentsSummary(person);
        if (!summary.ok || summary.status !== 'incomplete' || summary.balanceDueCents <= 0) return person;
        const existing = person.currentOfferings?.[installmentsSubEventName];
        if (existing && Number(existing.offeringAmount) > 0) return person;
        const minCents = Math.max(1, Math.min(summary.minimumDueCents, summary.balanceDueCents));
        const minDollars = minCents / 100;
        setInstallmentsAmountInputByPerson((prevInputs) => ({
          ...prevInputs,
          [person.id]: minDollars.toFixed(2),
        }));
        const currentOfferings = { ...(person.currentOfferings || {}) };
        currentOfferings[installmentsSubEventName] = {
          offeringSelection: 'installments',
          offeringIndex: -1,
          offeringSKU: `${eventCode}-${installmentsSubEventName}-installments`,
          offeringAmount: minCents,
          offeringIntent: 'installments',
          installments: true,
        };
        return { ...person, currentOfferings };
      })
    );
  }, [
    isInstallmentsPresentation,
    paymentStep,
    setFafFull,
    getInstallmentsSummary,
    installmentsSubEventName,
    eventCode,
  ]);

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

  const setInstallmentsOfferingForPerson = useCallback((personIndex: number, amountDollars: number) => {
    const subName = installmentsSubEventName;
    const amountCents = Math.max(0, Math.round(amountDollars * 100));
    setPersonOffering(personIndex, subName, {
      offeringSelection: 'installments',
      offeringIndex: -1,
      offeringSKU: `${eventCode}-${subName}-installments`,
      offeringAmount: amountCents,
      offeringIntent: 'installments',
      installments: true,
    });
  }, [eventCode, installmentsSubEventName, setPersonOffering]);

  const checkoutTotalCents = React.useMemo(() => {
    if (!isInstallmentsPresentation) return totalCents;
    return fafFull.reduce((sum, person) => {
      if (!person.canOffer) return sum;
      const existing = Number(person.currentOfferings?.[installmentsSubEventName]?.offeringAmount);
      if (Number.isFinite(existing) && existing > 0) return sum + existing;
      const personSummary = getInstallmentsSummary(person);
      if (!personSummary.ok || personSummary.status !== 'incomplete' || personSummary.balanceDueCents <= 0) return sum;
      const personMinCents = Math.max(1, Math.min(personSummary.minimumDueCents, personSummary.balanceDueCents));
      return sum + personMinCents;
    }, 0);
  }, [isInstallmentsPresentation, totalCents, fafFull, installmentsSubEventName, getInstallmentsSummary]);

  const handlePay = useCallback(async () => {
    const amountForIntent = isInstallmentsPresentation ? checkoutTotalCents : totalCents;
    if (amountForIntent <= 0) return;
    setProcessing(true);
    setPayError(null);
    try {
      const effectiveFafFull = isInstallmentsPresentation
        ? fafFull.map((person) => {
            if (!person.canOffer) return person;
            const existing = Number(person.currentOfferings?.[installmentsSubEventName]?.offeringAmount);
            if (Number.isFinite(existing) && existing > 0) return person;
            const personSummary = getInstallmentsSummary(person);
            if (!personSummary.ok || personSummary.status !== 'incomplete' || personSummary.balanceDueCents <= 0) {
              return person;
            }
            const personMinCents = Math.max(1, Math.min(personSummary.minimumDueCents, personSummary.balanceDueCents));
            return {
              ...person,
              currentOfferings: {
                ...(person.currentOfferings || {}),
                [installmentsSubEventName]: {
                  offeringSelection: 'installments',
                  offeringIndex: -1,
                  offeringSKU: `${eventCode}-${installmentsSubEventName}-installments`,
                  offeringAmount: personMinCents,
                  offeringIntent: 'installments',
                  installments: true,
                },
              },
            };
          })
        : fafFull;

      let summaryString = effectiveFafFull.map((p) => p.name + ': ' + Object.keys(p.currentOfferings || {}).join(', ')).join('; ');
      if (kmFeeCents > 0) {
        summaryString += `; KM fee 5%: ${formatAmount(kmFeeCents, currency)}`;
      }
      const skuSummary = buildSkuSummary(effectiveFafFull, currency, kmFeeCents);
      const cart = effectiveFafFull.filter((p) => p.canOffer).map((p) => ({
        id: p.id,
        name: p.name,
        currentOfferings: p.currentOfferings,
        offeringHistory: p.offeringHistory,
      }));
      setCheckoutCart(cart);

      if (isRegisterTestMode) {
        const createResp = await createMockOfferingTransaction(context.pid, context.hash, {
          pid: context.pid,
          amount: amountForIntent,
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
        setPaymentIntentId((createResp as { id: string }).id);
        setPaymentStep('stripe');
        return;
      }

      let pk = publishableKey;
      if (!pk) {
        const configResp = await getStripeConfig(context.pid, context.hash);
        if (configResp && 'redirected' in configResp) return;
        pk = (configResp as { publishableKey: string }).publishableKey;
        if (pk) setPublishableKey(pk);
      }
      const createResp = await createStripePaymentIntent(context.pid, context.hash, {
        aid: eventCode,
        pid: context.pid,
        amount: amountForIntent,
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
  }, [
    context,
    eventCode,
    event,
    fafFull,
    totalCents,
    currency,
    publishableKey,
    isInstallmentsPresentation,
    isRegisterTestMode,
    checkoutTotalCents,
    installmentsSubEventName,
    getInstallmentsSummary,
    kmFeeCents,
  ]);

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
        cart: checkoutCart ?? cart,
        subEventNames,
        mockPayment: isRegisterTestMode,
      });
      const result = onComplete();
      if (result != null && typeof (result as Promise<unknown>).then === 'function') {
        await (result as Promise<void>);
      }
    } catch (e: any) {
      setPayError(e.message || 'Failed to complete offering');
    } finally {
      setProcessing(false);
    }
  }, [paymentIntentId, checkoutCart, fafFull, context, eventCode, subEventNames, onComplete, isRegisterTestMode]);

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

  if (paymentStep === 'stripe' && isRegisterTestMode && paymentIntentId) {
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
          <h2 className="text-xl font-semibold text-reg-accent">Test Checkout</h2>
          <p className="text-sm text-reg-muted">This is a simulated checkout page for register test mode.</p>
          {payError && <p className="text-reg-error text-sm">{payError}</p>}
          <div className="rounded border border-reg-border bg-reg-card p-4 flex items-center justify-between">
            <span className="text-sm text-reg-muted">Amount</span>
            <span className="text-sm font-semibold tabular-nums">{formatAmount(checkoutTotalCents, currency)}</span>
          </div>
          <button
            type="button"
            onClick={handlePaymentSuccess}
            disabled={processing}
            className="w-full flex items-center justify-between min-h-[2.75rem] px-6 py-2 rounded font-medium transition-colors shadow-lg bg-reg-accent-button text-reg-accent-button-text hover:bg-reg-accent-button-hover disabled:bg-reg-button-disabled disabled:text-reg-text-disabled disabled:cursor-not-allowed"
          >
            <span className="text-sm">{processing ? 'Please wait...' : 'Test Offering'}</span>
            <span className="text-sm tabular-nums">{formatAmount(checkoutTotalCents, currency)}</span>
          </button>
        </div>
      </div>
    );
  }

  if (paymentStep === 'stripe' && clientSecret && publishableKey) {
    const stripePromise = loadStripe(publishableKey);
    const paymentAmountCents = isInstallmentsPresentation ? checkoutTotalCents : totalCents;
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
              amount={paymentAmountCents}
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
    setOwyaaAmountInput(existingCents != null ? (Number(existingCents) / 100).toFixed(2) : '');
    setPaymentStep('owyaa');
  };

  const openHeartGiftCard = (personIndex: number, subName: string, promptKey: string, oc: OfferingConfig | null) => {
    const minAmountDollars = Number(oc?.config?.minDollars ?? 1);
    const initialAmountDollarsRaw = oc?.config?.initialAmount;
    const initialAmountDollars =
      typeof initialAmountDollarsRaw === 'number' && Number.isFinite(initialAmountDollarsRaw)
        ? Math.max(minAmountDollars, initialAmountDollarsRaw)
        : minAmountDollars;

    setHeartGiftModal({ personIndex, subName, promptKey, initialAmountDollars, minAmountDollars });
    const existing = fafFull[personIndex]?.currentOfferings?.[subName];
    const existingCents = existing?.offeringSelection === promptKey ? existing?.offeringAmount : undefined;
    const initialDollarsString =
      existingCents != null ? (Number(existingCents) / 100).toFixed(2) : Number(initialAmountDollars).toFixed(2);
    setHeartGiftAmountInput(initialDollarsString);

    // Preselect the initial amount so total + pay button reflect it immediately.
    const dollars = parseMoneyDollars(initialDollarsString);
    if (Number.isFinite(dollars) && dollars >= minAmountDollars) {
      const amountCents = Math.round(dollars * 100);
      const idx = oc?.prompts?.indexOf(promptKey) ?? -1;
      setPersonOffering(personIndex, subName, {
        offeringSelection: promptKey,
        offeringIndex: idx,
        offeringSKU: `${eventCode}-${subName}-${promptKey}`,
        offeringAmount: amountCents,
      });
    } else {
      setPersonOffering(personIndex, subName, null);
    }
    setPaymentStep('heartGift');
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
    setSponsoringAmountInput(Number(effectiveDefault).toFixed(2));
    setSponsoringModal({ personIndex, subName, promptKey, minAmountDollars });
    setPaymentStep('sponsoring');
  };

  const openInstallmentsCard = (
    personIndex: number,
    promptKey: string,
    minAmountDollars: number,
    defaultAmountDollars: number,
  ) => {
    const subName = installmentsSubEventName;
    const defaultCents = Math.round(defaultAmountDollars * 100);
    setPersonOffering(personIndex, subName, {
      offeringSelection: promptKey,
      offeringIndex: -1,
      offeringSKU: `${eventCode}-${subName}-${promptKey}`,
      offeringAmount: defaultCents,
      offeringIntent: 'installments',
      installments: true,
    });
    setSponsoringAmountInput(Number(defaultAmountDollars).toFixed(2));
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

    const parsed = parseMoneyDollars(owyaaAmountInput);
    const hasAmount = canEnterAmount && Number.isFinite(parsed) && parsed > 0;

    const handleOwyaaAmountChange = (val: string) => {
      setOwyaaAmountInput(val);
      const num = parseMoneyDollars(val);
      if (!Number.isFinite(num) || num <= 0) {
        setPersonOffering(owyaaModal.personIndex, subName, null);
        return;
      }
      const amountCents = Math.round(num * 100);
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
              <HtmlPrompt html={offeringIntroOwyaa} className="text-base text-reg-text italic" />
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
              <div className="mt-4 flex flex-col md:flex-row gap-4 md:gap-6 items-start">
                <div className="flex-1 text-reg-text text-sm whitespace-pre-wrap">
                  {bodyText}
                </div>
                <div className="w-full md:w-auto md:flex-none">
                  <AmountStepper
                    value={owyaaAmountInput}
                    min={0}
                    step={1}
                    currency={currency}
                    onChange={handleOwyaaAmountChange}
                    placeholder="0.00"
                  />
                </div>
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

  if (paymentStep === 'heartGift' && heartGiftModal) {
    const person = fafFull[heartGiftModal.personIndex];
    if (!person) return null;
    const subName = heartGiftModal.subName;
    const promptKey = heartGiftModal.promptKey;
    const headerLabel = promptLookup(context, subName) || subName;
    const offeringIntroHeartGift = promptLookup(context, 'offeringIntroduction') || '';
    const bodyText =
      promptLookup(context, 'offeringHeartGiftBody') ||
      '';

    const parsed = parseMoneyDollars(heartGiftAmountInput);
    const minDollars = typeof heartGiftModal.minAmountDollars === 'number' ? heartGiftModal.minAmountDollars : 1;
    const hasAmount = Number.isFinite(parsed) && parsed >= minDollars;

    const handleHeartGiftAmountChange = (val: string) => {
      setHeartGiftAmountInput(val);
      const num = parseMoneyDollars(val);
      if (!Number.isFinite(num) || num < minDollars) {
        setPersonOffering(heartGiftModal.personIndex, subName, null);
        return;
      }
      const amountCents = Math.round(num * 100);
      const subEv = event?.subEvents?.[subName];
      const oid = subEv?.offeringMode;
      const ocLocal = oid ? configs[oid] : null;
      const idx = ocLocal?.prompts?.indexOf(promptKey) ?? -1;
      setPersonOffering(heartGiftModal.personIndex, subName, {
        offeringSelection: promptKey,
        offeringIndex: idx,
        offeringSKU: `${eventCode}-${subName}-${promptKey}`,
        offeringAmount: amountCents,
      });
    };

    const handleHeartGiftBack = () => {
      setHeartGiftModal(null);
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
            {offeringIntroHeartGift ? (
              <HtmlPrompt html={offeringIntroHeartGift} className="text-base text-reg-text italic" />
            ) : (
              <h2 className="text-lg font-semibold text-reg-accent">{headerLabel}</h2>
            )}
          </div>
          <div className="mt-4 flex flex-col md:flex-row gap-4 md:gap-6 items-start">
            <div className="flex-1 text-reg-text text-sm whitespace-pre-wrap">
              {bodyText}
            </div>
            <div className="w-full md:w-auto md:flex-none">
              <AmountStepper
                value={heartGiftAmountInput}
                min={minDollars}
                step={1}
                currency={currency}
                onChange={handleHeartGiftAmountChange}
                placeholder={Number(minDollars).toFixed(2)}
              />
            </div>
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
              onClick={handleHeartGiftBack}
              className="px-4 py-2 rounded bg-reg-button text-reg-text hover:bg-reg-button-hover transition-colors"
            >
              {promptLookup(context, 'back') || 'Back'}
            </button>
          </div>
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

    const parsed = parseMoneyDollars(sponsoringAmountInput);
    const hasAmount = Number.isFinite(parsed) && parsed >= minSponsoringDollars;

    const handleSponsoringAmountChange = (val: string) => {
      // Allow free typing (including backspace) while editing.
      setSponsoringAmountInput(val);
    };

    const commitSponsoringAmount = () => {
      const num = parseMoneyDollars(sponsoringAmountInput);
      const effectiveDollars = Number.isFinite(num)
        ? Math.max(num, minSponsoringDollars)
        : minSponsoringDollars;

      // If entered value is below the minimum or invalid, snap back to the minimum.
      setSponsoringAmountInput(effectiveDollars.toFixed(2));

      if (effectiveDollars <= 0) {
        setPersonOffering(sponsoringModal.personIndex, subName, null);
        return;
      }

      const amountCents = Math.round(effectiveDollars * 100);
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
              <HtmlPrompt html={offeringIntroSponsoring} className="text-base text-reg-text italic" />
            ) : null}
          </div>
          <div className="mt-4 flex flex-col md:flex-row gap-4 md:gap-6 items-start">
            <div className="flex-1 text-reg-text text-sm whitespace-pre-wrap">
              {bodyText}
            </div>
            <div className="w-full md:w-auto md:flex-none">
              <AmountStepper
                value={sponsoringAmountInput}
                min={minSponsoringDollars}
                step={1}
                currency={currency}
                onChange={(val) => {
                  handleSponsoringAmountChange(val);
                }}
                placeholder={Number(minSponsoringDollars).toFixed(2)}
              />
            </div>
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
                  <HtmlPrompt html={offeringIntro} className="text-base text-reg-muted max-w-xs text-right italic" />
                )}
              </div>
            ) : offeringIntro ? (
              <HtmlPrompt html={offeringIntro} className="mb-4 text-base text-reg-text italic" />
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
                        const isHeartGift = isHeartGiftConfig(oc);
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
                            {isHeartGift ? (
                              <button
                                type="button"
                                onClick={() => openHeartGiftCard(pIdx, nextSubName, promptKey, oc)}
                                className={`min-w-[8rem] px-4 py-2 rounded text-sm font-medium transition-colors shadow-lg ${
                                  isSelected
                                    ? 'bg-reg-accent-button text-reg-accent-button-text hover:bg-reg-accent-button-hover text-right'
                                    : 'bg-reg-card border border-reg-border text-reg-text hover:border-reg-border-light hover:bg-reg-card-muted text-center'
                                }`}
                              >
                                {isSelected && typeof current?.offeringAmount === 'number'
                                  ? formatAmount(current.offeringAmount, currency)
                                  : (promptLookup(context, heartGiftButtonPromptKey(promptKey)) || heartGiftButtonPromptKey(promptKey))}
                              </button>
                            ) : isOwyaa ? (
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

  if (offeringPresentation === 'installments') {
    const canOfferInstallmentsPeople = fafFull.filter((p) => p.canOffer);
    let installmentsSummaryError: string | null = null;
    for (const p of canOfferInstallmentsPeople) {
      const s = getInstallmentsSummary(p);
      if (!s.ok) {
        installmentsSummaryError = s.error;
        break;
      }
    }
    if (canOfferInstallmentsPeople.length === 0) {
      return (
        <div className="max-w-xl mx-auto p-6 rounded-lg border border-reg-error bg-reg-error-bg text-reg-error">
          Installments cannot be offered because no eligible participant was found.
        </div>
      );
    }
    if (installmentsSummaryError) {
      return (
        <div className="max-w-xl mx-auto p-6 rounded-lg border border-reg-error bg-reg-error-bg text-reg-error">
          {installmentsSummaryError}
        </div>
      );
    }

    let totalOfferedSoFarCents = 0;
    let totalMaximumDueCents = 0;
    let totalBalanceDueCents = 0;
    const aggregatedRetreatPromptKeys: string[] = [];
    const retreatPromptKeySeen = new Set<string>();
    for (const p of canOfferInstallmentsPeople) {
      const s = getInstallmentsSummary(p);
      if (!s.ok) continue;
      totalOfferedSoFarCents += s.offeredSoFarCents;
      totalMaximumDueCents += s.maximumDueCents;
      totalBalanceDueCents += s.balanceDueCents;
      for (const pk of s.retreatPromptKeys) {
        if (!retreatPromptKeySeen.has(pk)) {
          retreatPromptKeySeen.add(pk);
          aggregatedRetreatPromptKeys.push(pk);
        }
      }
    }

    const familyInstallmentsOverpaid = totalOfferedSoFarCents > totalMaximumDueCents;
    const showFamilyInstallmentsComplete =
      totalBalanceDueCents <= 0 && !familyInstallmentsOverpaid && totalMaximumDueCents > 0;
    const installmentMaxCents = totalBalanceDueCents;
    const showInstallmentsWaitListWarning =
      waitListWarningHtml !== '' &&
      fafFull.some((p) => {
        if (!p.canOffer) return false;
        const s = getInstallmentsSummary(p);
        if (!s.ok) return false;
        // Show only when paid so far is below the combined minimum for the selected retreats.
        // (No dependence on retreatFull; no "balance < minimum" inference.)
        return s.minimumDueCents > 0 && s.offeredSoFarCents < s.minimumDueCents;
      });
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
          {offeringIntro && <HtmlPrompt html={offeringIntro} className="text-base text-reg-text italic" />}
          {showInstallmentsWaitListWarning && (
            <HtmlPrompt
              html={waitListWarningHtml}
              className="text-sm text-reg-text space-y-2 [&_a]:text-reg-accent [&_a]:underline"
            />
          )}
          {installmentsIntroduction && (
            <p className="text-sm text-reg-text whitespace-pre-wrap">{installmentsIntroduction}</p>
          )}
          <ul className="list-disc pl-6 text-sm text-reg-text space-y-1">
            {aggregatedRetreatPromptKeys.map((promptKey) => (
              <li key={promptKey}>{promptLookup(context, promptKey) || promptKey}</li>
            ))}
          </ul>
          {totalOfferedSoFarCents > 0 && (
            <div className="flex items-center justify-between border-t border-reg-border pt-4">
              <p className="text-sm text-reg-text">{offeringsReceivedPrompt}</p>
              <p className="text-sm font-semibold tabular-nums">{formatAmount(totalOfferedSoFarCents, currency)}</p>
            </div>
          )}
          <div className={`flex items-center justify-between ${totalOfferedSoFarCents > 0 ? '' : 'border-t border-reg-border pt-4'}`}>
            <p className="text-sm text-reg-text">{balanceDuePrompt}</p>
            <p className="text-sm font-semibold tabular-nums">{formatAmount(totalBalanceDueCents, currency)}</p>
          </div>
          {familyInstallmentsOverpaid && (
            <p className="text-sm text-reg-warning">
              {(promptLookup(context, 'offeringOverpaid') || 'You have offered more than your current total due.') +
                ` ${formatAmount(totalOfferedSoFarCents, currency)} / ${formatAmount(totalMaximumDueCents, currency)}`}
            </p>
          )}
          {!familyInstallmentsOverpaid && installmentMaxCents > 0 && (
            <div className="space-y-2">
              {fafFull.map((person, pIdx) => {
                if (!person.canOffer) return null;
                const personSummary = getInstallmentsSummary(person);
                if (!personSummary.ok) return null;
                const personMinCents = Math.max(1, Math.min(personSummary.minimumDueCents, personSummary.balanceDueCents));
                const personMinDollars = personMinCents / 100;
                const personBalanceCents = personSummary.balanceDueCents;
                const personBalanceDollars = personBalanceCents / 100;
                const currentCents = Number(person.currentOfferings?.[installmentsSubEventName]?.offeringAmount);
                const currentDollars = Number.isFinite(currentCents) ? currentCents / 100 : personMinDollars;
                const entered = installmentsAmountInputByPerson[person.id];
                const displayed = entered ?? currentDollars.toFixed(2);
                return (
                  <div key={person.id} className="pt-3 border-t border-reg-border space-y-2">
                    <span className="text-reg-text text-sm block">{person.name}</span>
                    <p className="text-xs text-reg-muted text-right">
                      {`${formatAmount(personMinCents, currency)} - ${formatAmount(personBalanceCents, currency)}`}
                    </p>
                    <AmountStepper
                      value={displayed}
                      min={personMinDollars}
                      max={personBalanceDollars}
                      step={installmentStepDollars}
                      currency={currency}
                      onChange={(val) => {
                        setInstallmentsAmountInputByPerson((prev) => ({ ...prev, [person.id]: val }));
                        const parsed = parseMoneyDollars(val);
                        if (!Number.isFinite(parsed)) {
                          return;
                        }
                        const clamped = Math.min(Math.max(parsed, personMinDollars), personBalanceDollars);
                        setInstallmentsOfferingForPerson(pIdx, clamped);
                      }}
                      placeholder={personMinDollars.toFixed(2)}
                    />
                  </div>
                );
              })}
            </div>
          )}
          {showFamilyInstallmentsComplete && (
            <p className="text-sm text-reg-muted">
              {promptLookup(context, 'offeringCompleteCold') || 'Your offering is complete.'}
            </p>
          )}
          {checkoutTotalCents > 0 && (
            <div className="flex flex-col items-end pt-1 space-y-1">
              <button
                type="button"
                onClick={handlePay}
                disabled={processing}
                className="w-full max-w-2xl flex items-center justify-between min-h-[2.75rem] px-6 py-2 rounded font-medium transition-colors shadow-lg bg-reg-accent-button text-reg-accent-button-text hover:bg-reg-accent-button-hover disabled:bg-reg-button-disabled disabled:text-reg-text-disabled disabled:cursor-not-allowed"
              >
                <span className="text-sm">
                  {processing ? (promptLookup(context, 'pleaseWait') || 'Please wait...') : (promptLookup(context, 'offeringClick') || 'Click here to make an offering')}
                </span>
                <span className="text-sm tabular-nums">{formatAmount(checkoutTotalCents, currency)}</span>
              </button>
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
              <HtmlPrompt html={offeringIntro} className="mb-4 text-base text-reg-text italic" />
              )
            ) : (
              <div className="flex items-baseline justify-between mb-4 gap-4">
                {headerLabel && (
                  <h3 className="text-lg font-semibold text-reg-accent">{headerLabel}</h3>
                )}
                {offeringIntro && (
                  <HtmlPrompt html={offeringIntro} className="text-base text-reg-muted max-w-xs text-right italic" />
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
                      const isHeartGift = isHeartGiftConfig(oc);
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
                          {isHeartGift ? (
                            <button
                              type="button"
                              onClick={() => openHeartGiftCard(pIdx, subName, promptKey, oc)}
                              className={`min-w-[8rem] px-4 py-2 rounded text-sm font-medium transition-colors shadow-lg ${
                                isSelected
                                  ? 'bg-reg-accent-button text-reg-accent-button-text hover:bg-reg-accent-button-hover text-right'
                                  : 'bg-reg-card border border-reg-border text-reg-text hover:border-reg-border-light hover:bg-reg-card-muted text-center'
                              }`}
                            >
                              {isSelected && typeof current?.offeringAmount === 'number'
                                ? formatAmount(current.offeringAmount, currency)
                                : (promptLookup(context, heartGiftButtonPromptKey(promptKey)) || heartGiftButtonPromptKey(promptKey))}
                            </button>
                          ) : isOwyaa ? (
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
