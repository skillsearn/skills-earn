import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, qs } from './api';
import type { Paged } from './types';

/** Paginated list bound to an API path + filter object. */
export function usePaged<T>(key: string, path: string, filters: Record<string, string | number | undefined>, pageSize = 20) {
  const [page, setPage] = useState(1);
  const filterKey = JSON.stringify(filters);
  useEffect(() => setPage(1), [filterKey]);
  const query = useQuery({
    queryKey: [key, path, filterKey, page, pageSize],
    queryFn: () => api.get<Paged<T>>(`${path}${qs({ ...filters, page, pageSize })}`),
    placeholderData: keepPreviousData,
  });
  return { ...query, page, setPage, pageSize };
}

export function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export interface PublicSettings {
  registration: { referralRequired: boolean };
  commission: { maxGenerations: number };
}

/** Public platform settings (referral rule, turnover depth). */
export function usePublicSettings() {
  return useQuery({ queryKey: ['public-settings'], queryFn: () => api.get<PublicSettings>('/settings/public'), staleTime: 5 * 60_000 });
}
