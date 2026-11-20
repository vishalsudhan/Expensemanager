import { useQueryClient } from '@tanstack/react-query';
import {
  getListCounterpartiesQueryKey,
  useCreateCounterparty,
  useListCounterparties,
} from '@workspace/api-client-react';
import type { Counterparty } from '@workspace/api-client-react';

/** Active people and companies, plus a create that refreshes every list using them. */
export function useCounterparties() {
  const queryClient = useQueryClient();
  const query = useListCounterparties({ status: 'active' });
  const create = useCreateCounterparty();

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: getListCounterpartiesQueryKey() });

  const createCounterparty = (name: string) =>
    new Promise<Counterparty>((resolve, reject) => {
      create.mutate(
        { data: { name } },
        {
          onSuccess: async (created) => {
            // Put it in the cached list straight away so a select can show it.
            queryClient.setQueryData<Counterparty[]>(
              getListCounterpartiesQueryKey({ status: 'active' }),
              (current) =>
                [...(current ?? []), created].sort((a, b) => a.name.localeCompare(b.name)),
            );
            await refresh();
            resolve(created);
          },
          onError: reject,
        },
      );
    });

  return {
    counterparties: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    createCounterparty,
    creating: create.isPending,
    refresh,
  };
}
