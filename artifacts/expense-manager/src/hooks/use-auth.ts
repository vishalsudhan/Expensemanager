import { useEffect } from 'react';
import { useLocation } from 'wouter';
import {
  useGetAuthState,
  useLogin,
  useLogout,
  useSetupAccount,
} from '@workspace/api-client-react';
import type { LoginRequest, SetupAccountRequest } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Reads the sign-in state the server reports.
 *
 * `needsSetup` only ever goes from true to false: the server refuses a second
 * setup call with 409 once an account exists, so this cannot be used to add or
 * replace the account later.
 */
export function useAuthState() {
  const query = useGetAuthState();
  return {
    isLoading: query.isLoading,
    needsSetup: query.data?.needsSetup === true,
    authenticated: query.data?.authenticated === true,
    error: query.error,
  };
}

export function useLoginMutation() {
  const queryClient = useQueryClient();
  const mutation = useLogin();
  return {
    ...mutation,
    async mutateAsync(input: LoginRequest) {
      const result = await mutation.mutateAsync({ data: input });
      // Financial data may already be cached from a previous session on this
      // device, so drop it rather than flashing it before the redirect.
      await queryClient.invalidateQueries();
      return result;
    },
  };
}

export function useSetupMutation() {
  const queryClient = useQueryClient();
  const mutation = useSetupAccount();
  return {
    ...mutation,
    async mutateAsync(input: SetupAccountRequest) {
      const result = await mutation.mutateAsync({ data: input });
      await queryClient.invalidateQueries();
      return result;
    },
  };
}

export function useLogoutMutation() {
  const queryClient = useQueryClient();
  const mutation = useLogout();
  return {
    ...mutation,
    async mutateAsync() {
      const result = await mutation.mutateAsync();
      // Wipe every cached response, otherwise the previous owner's totals stay
      // in memory and flash on the next sign-in.
      queryClient.clear();
      await queryClient.invalidateQueries();
      return result;
    },
  };
}

/** Redirects to the right screen whenever the session state changes. */
export function useAuthRedirect(options: { requireAuth?: boolean } = {}) {
  const { requireAuth = true } = options;
  const { isLoading, needsSetup, authenticated } = useAuthState();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (isLoading) return;
    if (needsSetup) {
      navigate('/setup', { replace: true });
      return;
    }
    if (requireAuth && !authenticated) {
      navigate('/login', { replace: true });
    }
  }, [isLoading, needsSetup, authenticated, requireAuth, navigate]);
}