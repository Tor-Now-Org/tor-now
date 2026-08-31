import { describe, expect, it } from "vitest";
import { loadConfig, SESSION_LIFETIME_SECONDS } from "./config.ts";

const secret = "x".repeat(32);
const minimal = {
  SUPABASE_DB_URL: "postgres://localhost/tor_now",
  SUPABASE_JWT_SECRET: secret,
};

const twilio = {
  TWILIO_ACCOUNT_SID: "AC123",
  TWILIO_AUTH_TOKEN: "token",
  TWILIO_WHATSAPP_FROM: "+972500000000",
};

describe("loadConfig", () => {
  it("runs on the log transports with nothing but a database and a secret", () => {
    const config = loadConfig(minimal);
    expect(config.verificationTransport).toBe("LOG");
    expect(config.notificationTransport).toBe("LOG");
    expect(config.twilio).toBeNull();
  });

  it("returns the code to the caller when no transport can deliver it", () => {
    // Otherwise the deployment has no way to authenticate anyone at all.
    expect(loadConfig(minimal).exposeVerificationCode).toBe(true);
  });

  it("stops returning the code as soon as a real transport is configured", () => {
    const config = loadConfig({
      ...minimal,
      ...twilio,
      VERIFICATION_TRANSPORT: "WHATSAPP",
    });
    expect(config.exposeVerificationCode).toBe(false);
  });

  it("can be forced off, locking a credential-less deployment out of sign-in", () => {
    const config = loadConfig({ ...minimal, EXPOSE_VERIFICATION_CODE: "false" });
    expect(config.exposeVerificationCode).toBe(false);
  });

  it("refuses to boot without a database url", () => {
    expect(() => loadConfig({ SUPABASE_JWT_SECRET: secret })).toThrow(
      /SUPABASE_DB_URL/,
    );
  });

  it("refuses a short signing secret", () => {
    expect(() =>
      loadConfig({ ...minimal, SUPABASE_JWT_SECRET: "too-short" }),
    ).toThrow(/SUPABASE_JWT_SECRET must be at least 32/);
  });

  it("refuses a real transport with no credentials behind it", () => {
    expect(() =>
      loadConfig({ ...minimal, VERIFICATION_TRANSPORT: "WHATSAPP" }),
    ).toThrow(/Twilio credentials are absent/);
  });

  it("accepts a real transport once credentials are present", () => {
    const config = loadConfig({
      ...minimal,
      ...twilio,
      VERIFICATION_TRANSPORT: "WHATSAPP",
    });
    expect(config.twilio?.accountSid).toBe("AC123");
  });

  it("refuses to expose verification codes alongside a real transport", () => {
    expect(() =>
      loadConfig({
        ...minimal,
        ...twilio,
        VERIFICATION_TRANSPORT: "WHATSAPP",
        EXPOSE_VERIFICATION_CODE: "true",
      }),
    ).toThrow(/development only/);
  });

  it("refuses an SMS notification transport with no SMS sender", () => {
    expect(() =>
      loadConfig({ ...minimal, ...twilio, NOTIFICATION_TRANSPORT: "SMS" }),
    ).toThrow(/TWILIO_SMS_FROM/);
  });

  it("reads a comma-separated CORS allowlist", () => {
    const config = loadConfig({
      ...minimal,
      CORS_ORIGINS: "https://a.example, https://b.example ,",
    });
    expect(config.corsOrigins).toEqual(["https://a.example", "https://b.example"]);
  });

  it("falls back to the service role key when no JWT secret is provisioned", () => {
    const config = loadConfig({
      SUPABASE_DB_URL: "postgres://localhost/tor_now",
      SUPABASE_SERVICE_ROLE_KEY: "s".repeat(64),
    });
    expect(config.jwtSecretSource).toBe("SUPABASE_SERVICE_ROLE_KEY");
    expect(config.jwtSecret).toBe("s".repeat(64));
  });

  it("prefers an explicit JWT secret over the fallback", () => {
    const config = loadConfig({
      ...minimal,
      SUPABASE_SERVICE_ROLE_KEY: "s".repeat(64),
    });
    expect(config.jwtSecretSource).toBe("SUPABASE_JWT_SECRET");
    expect(config.jwtSecret).toBe(secret);
  });

  it("refuses to boot with neither a JWT secret nor a service role key", () => {
    expect(() =>
      loadConfig({ SUPABASE_DB_URL: "postgres://localhost/tor_now" }),
    ).toThrow(/SUPABASE_JWT_SECRET/);
  });

  it("fixes the session lifetime at thirty days, per ADR 0009", () => {
    expect(SESSION_LIFETIME_SECONDS).toBe(30 * 24 * 60 * 60);
  });
});
