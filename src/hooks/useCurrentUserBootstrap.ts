import { useEffect, useRef, useState } from "react";

import type { LanguageCode } from "../i18n/translations";
import { LEGAL_VERSION } from "../legal/legalContent";
import {
  clearStoredLegalAcceptance,
  getStoredLegalAcceptance,
} from "../legal/legalAcceptanceStorage";
import { getErrorMessage } from "../utils/auth";

type UpsertCurrentUser = (args: {
  email?: string;
  name?: string;
  preferredLanguage?: LanguageCode;
  termsAcceptedAt?: number;
  termsVersion?: string;
}) => Promise<unknown>;

const BOOTSTRAP_RETRY_DELAYS_MS = [250, 500, 1000];
const wait = (delayMs: number) =>
  new Promise((resolve) => setTimeout(resolve, delayMs));

export function useCurrentUserBootstrap({
  onStart,
  onError,
  profileEmail,
  preferredLanguage,
  profileName,
  upsertCurrentUser,
  userId,
}: {
  onStart: () => void;
  onError: (message: string) => void;
  preferredLanguage: LanguageCode;
  profileEmail: string | undefined;
  profileName: string | undefined;
  upsertCurrentUser: UpsertCurrentUser;
  userId: string | undefined;
}) {
  const [readyUserId, setReadyUserId] = useState<string | null>(null);
  const onErrorRef = useRef(onError);
  const onStartRef = useRef(onStart);
  const preferredLanguageRef = useRef(preferredLanguage);
  const upsertCurrentUserRef = useRef(upsertCurrentUser);

  useEffect(() => {
    onErrorRef.current = onError;
    onStartRef.current = onStart;
    preferredLanguageRef.current = preferredLanguage;
    upsertCurrentUserRef.current = upsertCurrentUser;
  }, [onError, onStart, preferredLanguage, upsertCurrentUser]);

  useEffect(() => {
    if (!userId) {
      setReadyUserId(null);
      return;
    }

    let cancelled = false;

    const bootstrap = async () => {
      setReadyUserId((current) => (current === userId ? null : current));
      onStartRef.current();

      for (
        let attempt = 0;
        attempt <= BOOTSTRAP_RETRY_DELAYS_MS.length;
        attempt += 1
      ) {
        try {
          const legalAcceptance = await getStoredLegalAcceptance();
          const termsAcceptedAt = legalAcceptance?.acceptedAt ?? Date.now();
          await upsertCurrentUserRef.current({
            email: profileEmail,
            name: profileName,
            preferredLanguage: preferredLanguageRef.current,
            termsAcceptedAt,
            termsVersion: LEGAL_VERSION,
          });

          if (legalAcceptance) {
            await clearStoredLegalAcceptance();
          }

          if (!cancelled) {
            setReadyUserId(userId);
          }
          return;
        } catch (error) {
          if (cancelled) return;

          const retryDelay = BOOTSTRAP_RETRY_DELAYS_MS[attempt];
          if (retryDelay !== undefined) {
            await wait(retryDelay);
            continue;
          }

          onErrorRef.current(getErrorMessage(error));
          setReadyUserId(userId);
          return;
        }
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [profileEmail, profileName, userId]);

  return !userId || readyUserId === userId;
}
