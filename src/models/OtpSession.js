import mongoose from 'mongoose';

/**
 * One row per phone number, holding everything the OTP flow needs to remember
 * between requests.
 *
 * When the shared SMS gateway is on it owns the code, so `code` stays null and
 * this doc is purely the throttle ledger: when we last texted, how many texts
 * this hour, how many wrong guesses. With the gateway off (savshka sender or the
 * dev mock) the locally-issued code lives here too.
 */
const otpSessionSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, index: true },
    /** Locally-issued code. Null whenever the gateway is the one verifying. */
    code: { type: String, default: null },
    /** When a locally-issued code stops being accepted. */
    codeExpiresAt: { type: Date, default: null },
    /** Doc lifetime — outlives the rate-limit window so throttling survives. */
    expiresAt: { type: Date, required: true },
    verified: { type: Boolean, default: false },
    /** Wrong guesses since the last send; reset on every fresh code. */
    attempts: { type: Number, default: 0 },
    /** Codes sent inside the current window. */
    sendCount: { type: Number, default: 0 },
    windowStartedAt: { type: Date, default: null },
    lastSentAt: { type: Date, default: null },
  },
  { timestamps: true },
);

otpSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const OtpSession = mongoose.model('OtpSession', otpSessionSchema);
