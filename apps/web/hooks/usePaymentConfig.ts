'use client';

/**
 * FRIGAT — Payment capability probe
 *
 * Asks the API whether the sandbox payment endpoints exist. They are only
 * registered outside production, so the cashier UI has to ask rather than
 * assume — offering a "Simulate deposit" button that 404s would be worse than
 * not offering one.
 *
 * The answer is fixed for the lifetime of the server process, so it is fetched
 * once per page load and shared by both modals through a module-level cache.
 * Without that, opening the deposit and withdraw dialogs would each issue their
 * own request for the same constant.
 */

import { useEffect, useState } from 'react';

import { apiJson } from '@/lib/api';
import { API_URL } from '@/lib/token';
export interface PaymentConfig {
  sandbox: boolean;
  currencies: string[];
}

const FALLBACK: PaymentConfig = { sandbox: false, currencies: [] };

let cache: PaymentConfig | null = null;
let inFlight: Promise<PaymentConfig> | null = null;

function loadConfig(): Promise<PaymentConfig> {
  if (cache) return Promise.resolve(cache);
  if (inFlight) return inFlight;

  inFlight = apiJson<PaymentConfig>(`${API_URL}/api/payments/config`)
    .then((result) => {
      cache = {
        sandbox: result.sandbox === true,
        currencies: Array.isArray(result.currencies) ? result.currencies : [],
      };
      return cache;
    })
    .catch(() => FALLBACK)
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

export function usePaymentConfig(): PaymentConfig {
  const [config, setConfig] = useState<PaymentConfig>(cache ?? FALLBACK);

  useEffect(() => {
    if (cache) return;
    let active = true;
    void loadConfig().then((result) => {
      if (active) setConfig(result);
    });
    return () => {
      active = false;
    };
  }, []);

  return config;
}
