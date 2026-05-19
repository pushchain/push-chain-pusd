/**
 * analytics — thin wrapper over the gtag.js global loaded in index.html.
 *
 * Goals:
 *   - No-op cleanly when gtag isn't on the page (ad-blockers, dev, tests).
 *   - Single typed event name list so a typo becomes a compile error.
 *   - Never throw into caller code — analytics outages must not break the UI.
 *
 * Cardinality / privacy notes baked into the call sites (not enforced here):
 *   - Never pass full wallet addresses or tx hashes — they explode GA
 *     cardinality and tie a session to an on-chain identity. Short prefixes
 *     are fine; chain keys + symbols are preferred.
 *   - BigInt amounts are converted to plain numbers via {@link toAmountNumber};
 *     precision loss is acceptable for analytics aggregation.
 */

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

export type AnalyticsEvent =
  // page + wallet
  | 'page_view'
  | 'wallet_connect_clicked'
  | 'wallet_connected'
  | 'wallet_disconnected'
  | 'wallet_switch_clicked'
  // convert
  | 'convert_product_switch'
  | 'convert_tab_switch'
  | 'convert_route_toggle'
  | 'convert_basket_toggle'
  | 'convert_token_selector_open'
  | 'convert_token_select'
  | 'convert_amount_max_clicked'
  | 'convert_exact_out_clicked'
  | 'convert_recipient_overridden'
  | 'convert_recipient_reset'
  | 'convert_wrap_mode_exit'
  | 'convert_submit'
  | 'convert_signed'
  | 'convert_confirmed'
  | 'convert_step2_confirmed'
  | 'convert_failed'
  | 'convert_faucet_link_clicked_inline'
  // nav
  | 'nav_click'
  | 'masthead_logo_click'
  | 'masthead_menu_toggle'
  | 'masthead_drawer_link_click'
  // home
  | 'home_view_switch'
  | 'home_promise_curtain_open'
  | 'home_promise_curtain_close'
  | 'home_proof_switch'
  // reserves + docs
  | 'reserves_view_switch'
  | 'docs_view_switch'
  | 'docs_anchor_click'
  // mint / faucet
  | 'faucet_link_clicked'
  // dashboard
  | 'dashboard_balance_action'
  | 'dashboard_queue_claim_clicked'
  | 'dashboard_queue_claim_confirmed'
  | 'dashboard_queue_claim_failed'
  // activity
  | 'activity_page_changed'
  // generic
  | 'explorer_link_clicked'
  | 'external_link_clicked'
  | 'connect_gate_connect_clicked'
  | 'footer_link_clicked'
  // admin
  | 'admin_action_submit'
  | 'admin_action_confirmed'
  | 'admin_action_failed';

type EventParams = Record<string, string | number | boolean | undefined | null>;

function send(name: string, params?: EventParams): void {
  if (typeof window === 'undefined') return;
  const gtag = window.gtag;
  if (typeof gtag !== 'function') return;

  let clean: Record<string, string | number | boolean> | undefined;
  if (params) {
    clean = {};
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      clean[k] = v;
    }
  }

  try {
    gtag('event', name, clean);
  } catch {
    // analytics must never throw into the caller
  }
}

/** Convert a BigInt amount to a plain number for analytics aggregation. */
export function toAmountNumber(amount: bigint, decimals: number): number {
  if (amount === 0n) return 0;
  const base = 10n ** BigInt(decimals);
  const whole = Number(amount / base);
  const fracStr = (amount % base).toString().padStart(decimals, '0');
  const frac = Number(`0.${fracStr}`);
  return whole + frac;
}

export const analytics = {
  pageView(path: string, title?: string): void {
    send('page_view', {
      page_path: path,
      page_title: title,
      page_location: typeof window !== 'undefined' ? window.location.href : undefined,
    });
  },

  event(name: AnalyticsEvent, params?: EventParams): void {
    send(name, params);
  },
};
