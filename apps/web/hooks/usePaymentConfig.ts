'use client';

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
