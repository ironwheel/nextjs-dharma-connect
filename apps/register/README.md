# Register app

## Anonymous heart gift links

Shared Zoom links use URL parameters only (no student `pid` / `hash`):

```
https://register.slsupport.link/?mode=heartGift&eventCode={eventAid}&subEvent={subEventKey}
```

### Environment

Set on the register deployment (and local `.env`):

- `NEXT_PUBLIC_HEART_GIFT_PID` — service `auth` record id permitted on `register.slsupport.link`
- `NEXT_PUBLIC_HEART_GIFT_HASH` — HMAC for that pid using the register host secret from `APP_ACCESS_JSON`

Generate the hash with the same algorithm as registration links (`generateAuthHash(pid, registerSecret)` in `packages/api/lib/authUtils.ts`).

### Operations

1. Create an `auth` row for the service pid with `permitted-hosts` including `register.slsupport.link`.
2. Ensure the register app actions profile allows: read `events`, `prompts`, `offering-config`; `GET/stripe/config`, `POST/stripe/create`, `POST/offering/complete`, `GET/table/offering-transactions`.
3. On each subevent, set `heartGiftOfferingMode` to an offering-config oid with `config.mode === 'variable'` (main `offeringMode` can stay a fixed-tier config for registration).
4. Copy links from event-manager (Heart Gift button per subevent), e.g.  
   `?mode=heartGift&eventCode=mr20260527&subEvent=retreat`

### Example `NEWOFFERING-heart-gift` offering-config

```json
{
  "oid": "NEWOFFERING-heart-gift",
  "amounts": [27, 54, 108, 162],
  "fees": [0, 0, 0, 0],
  "prompts": ["offeringHeartGift"],
  "config": {
    "mode": "variable",
    "minDollars": 1,
    "initialAmount": 27
  }
}
```

- `config.mode: "variable"` — required for heart gift detection.
- `amounts` — shortcut button labels (dollars); anonymous UI uses these when present.
- `minDollars` / `initialAmount` — free-amount stepper bounds and default.

### Heart gift prompts (event `aid` + language)

| Prompt key | Where used |
|------------|------------|
| `title` | Page heading (unchanged) |
| `heartGiftTitle` | HTML below `title`, above offering card / image (same typography via wrapper; use `<em>`, `<i>`, `<br>`, etc.) |
| `heartGiftOfferingIntroduction` | Intro inside offering card (replaces `offeringIntroduction` in heart gift mode) |
| `offeringHeartGiftBody` | Body copy beside amount stepper |
| `heartGiftOfferingCompleteTitle` | Thank-you card heading after payment |
| `heartGiftOfferingCompleteBody` | Thank-you card body after payment |
| `receiptEmail` | HTML for receipt-email step (e.g. `<h2>…</h2><p>…</p>` with your classes) |
| `receiptEmailRequired` | Error when email is empty on Continue |
| `receiptEmailInvalid` | Error when email format is invalid |
| `continueToPayment` | Primary button on receipt-email step |
| `back` | Back button (shared with registration flow) |

Payments write `offering-transactions` with `anonymousHeartGift`, `subEvent`, and `skuSummary`; student `offeringHistory` is not updated. Receipts use `payerEmail` collected before Stripe checkout.

Heart gift Stripe PaymentIntent metadata (in addition to `aid` and service `pid`):

| Key | Value |
|-----|--------|
| `heartGift` | `true` |
| `payerEmail` | Receipt email from checkout |
| `subEvent` | Subevent key from URL (e.g. `retreat`) |
