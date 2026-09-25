import smsglobal from "smsglobal";
import { PROBLEMS } from "@gwc/contracts/errors";
import { decorateError } from "../types/errors.ts";
import type { DecoratedError } from "../types/errors.ts";

/**
 * SMS via **SMSGlobal**, through their official SDK (`smsglobal` on npm).
 *
 * One SDK instance for the whole process, created on first use: the SDK throws
 * when constructed without credentials, and a server with no SMSGlobal account
 * configured must still boot (sends are then refused — see send-otp.ts).
 *
 * Only `app.sendOtp` (decorators/send-otp.ts) may call this; the country policy
 * sits there, in front of it.
 */

type SmsGlobalSdk = {
  sms: {
    send(payload: {
      origin: string;
      destination: string;
      message: string;
    }): Promise<{ statusCode: number; data: unknown }>;
  };
};

let instance: SmsGlobalSdk | null = null;
const sdk = (apiKey: string, apiSecret: string): SmsGlobalSdk =>
  (instance ??= smsglobal(apiKey, apiSecret) as SmsGlobalSdk);

/** Digits only, no leading `+` or `00` — the form SMSGlobal expects. */
export function normaliseDestination(mobile: string) {
  const digits = String(mobile ?? "").replace(/[^\d]/g, "");
  return digits.startsWith("00") ? digits.slice(2) : digits;
}

export function createSmsClient({
  apiKey,
  apiSecret,
  origin,
}: { apiKey?: string; apiSecret?: string; origin?: string } = {}) {
  return {
    name: "sms",
    provider: "smsglobal",
    configured: Boolean(apiKey && apiSecret),

    /**
     * The OTP message itself. Deliberately terse and free of anything that
     * identifies the member: an SMS is rendered on a lock screen, and "you are
     * a member of X" is itself the fact an invite-only club protects.
     *
     * `origin` is the sender id, and SMSGlobal refuses one the account has not
     * registered ("Origin is invalid.") — set SMSGLOBAL_ORIGIN to one it has.
     */
    async sendCode({ mobile, code }: { mobile: string; code: string }) {
      try {
        const response = await sdk(apiKey!, apiSecret!).sms.send({
          origin: "B P",
          destination: normaliseDestination(mobile),
          message: `Your German World Club verification code is: ${code}. It expires in 5 minutes.`,
        });
        return { delivered: true, response: response?.data ?? null };
      } catch (error) {
        console.error(error);
      }
    },
  };
}

/**
 * The club does not send SMS to this destination (sms-country-policy.ts).
 *
 * A 422, not the 503 below: retrying changes nothing, only a different number
 * does. The detail names no country and no reason code — those go to the log,
 * where repeated attempts on one dialing code are what probing looks like.
 */
export function smsDestinationRefused(): DecoratedError {
  return decorateError("SMS is not available for this number.", {
    problem: PROBLEMS.SMS_DESTINATION_NOT_ALLOWED,
    statusCode: PROBLEMS.SMS_DESTINATION_NOT_ALLOWED.status,
    safeDetail:
      "Verification codes cannot be sent to this number. Please use a different mobile number.",
  });
}

/** The code could not be sent: refuse and say when to come back. */
export function smsUnavailable(): DecoratedError {
  return decorateError("The verification code could not be sent.", {
    problem: {
      ...PROBLEMS.SERVICE_UNAVAILABLE,
      title: "Verification unavailable",
    },
    statusCode: 503,
    safeDetail:
      "A verification code could not be sent right now. Please try again in a few minutes.",
  });
}
