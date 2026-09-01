import { ApiError, type ApiErrorCode } from "./errors.ts";
import type {
  AllowlistEntryDto,
  AppointmentDto,
  AuditEntryDto,
  BlockDto,
  BusinessDto,
  BusinessPhotoDto,
  BusinessProfileDto,
  BusinessSummaryDto,
  MonthDayDto,
  CalendarDayDto,
  CustomerRecordDto,
  DayAvailabilityDto,
  OverrideDto,
  PaymentDto,
  RequestCodeDto,
  ResourceDto,
  ServiceDto,
  SessionDto,
  SubscriptionDto,
  SubscriptionState,
  UserDto,
  WorkingHoursDto,
} from "./types.ts";

/**
 * The one place the browser talks to the API. Every call goes through `request`,
 * so the session header, the error translation and the JSON handling are each
 * written once.
 */

/**
 * The API's own address. Public by nature — it is the URL a browser calls — so
 * it is configuration rather than a secret, and has a working default so the
 * app runs against the deployed API with nothing set.
 */
export const API_BASE_URL =
  process.env["NEXT_PUBLIC_API_URL"] ??
  "https://kbybnveitlxkffqptvqm.supabase.co/functions/v1/api";

export type Session = { token: string; user: UserDto };

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  token?: string | null;
  query?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
  /**
   * Sent as-is, with its own content type. A photo is bytes: putting it through
   * JSON would cost a third more of every one of them to say nothing extra.
   */
  raw?: { bytes: Blob; contentType: string };
};

const buildUrl = (path: string, query: RequestOptions["query"]): string => {
  const url = new URL(`${API_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
};

const KNOWN_CODES: ReadonlySet<string> = new Set<ApiErrorCode>([
  "VALIDATION_FAILED",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "SLOT_TAKEN",
  "ALREADY_CANCELLED",
  "OUTSIDE_BOOKING_WINDOW",
  "OUTSIDE_WORKING_HOURS",
  "BUSINESS_INACTIVE",
  "VERIFICATION_FAILED",
  "RATE_LIMITED",
  "INTERNAL",
]);

const request = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
  const { method = "GET", body, token, query, signal, raw } = options;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      signal: signal ?? null,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(raw === undefined ? {} : { "Content-Type": raw.contentType }),
        ...(token === undefined || token === null
          ? {}
          : { Authorization: `Bearer ${token}` }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(raw === undefined ? {} : { body: raw.bytes }),
    });
  } catch (cause) {
    // A failed fetch is the network, not the API. The interface says so rather
    // than reporting a server error the server never sent.
    throw new ApiError(
      "NETWORK",
      cause instanceof Error ? cause.message : "Request failed",
      0,
    );
  }

  if (response.status === 204) return undefined as T;

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const error =
      typeof payload === "object" && payload !== null && "error" in payload
        ? (payload as { error: { code?: string; message?: string; details?: Record<string, unknown> } }).error
        : {};
    const code = KNOWN_CODES.has(error.code ?? "")
      ? (error.code as ApiErrorCode)
      : "INTERNAL";
    throw new ApiError(
      code,
      error.message ?? `Request failed with ${response.status}`,
      response.status,
      error.details ?? {},
    );
  }

  return payload as T;
};

export const api = {
  health: () =>
    request<{
      status: string;
      verificationTransport: string;
      notificationTransport: string;
      exposesVerificationCode: boolean;
    }>("/health"),

  // ADR 0004: registering and signing in are the same act.
  requestCode: (phone: string) =>
    request<RequestCodeDto>("/auth/request-code", {
      method: "POST",
      body: { phone },
    }),

  verifyCode: (
    phone: string,
    code: string,
    name: { givenName: string; familyName: string | null } | null,
  ) =>
    request<SessionDto>("/auth/verify", {
      method: "POST",
      body: { phone, code, name },
    }),

  me: (token: string) => request<UserDto>("/me", { token }),

  updateProfile: (
    token: string,
    changes: {
      givenName?: string;
      familyName?: string | null;
      birthDate?: string | null;
    },
  ) => request<UserDto>("/me", { method: "PATCH", body: changes, token }),

  calendarMonth: (
    token: string,
    businessId: string,
    resourceId: string,
    firstOfMonth: string,
  ) =>
    request<MonthDayDto[]>(
      `/businesses/${businessId}/resources/${resourceId}/calendar/month`,
      { token, query: { firstOfMonth } },
    ),

  businessPhotos: (token: string, businessId: string) =>
    request<BusinessPhotoDto[]>(`/businesses/${businessId}/photos`, { token }),

  uploadBusinessPhoto: (
    token: string,
    businessId: string,
    slot: number,
    file: Blob,
  ) =>
    request<BusinessPhotoDto>(`/businesses/${businessId}/photos/${slot}`, {
      method: "PUT",
      token,
      raw: { bytes: file, contentType: file.type },
    }),

  deleteBusinessPhoto: (token: string, businessId: string, photoId: string) =>
    request<void>(`/businesses/${businessId}/photos/${photoId}`, {
      method: "DELETE",
      token,
    }),

  deleteAccount: (token: string) =>
    request<void>("/me", { method: "DELETE", token }),

  myAppointments: (token: string) =>
    request<AppointmentDto[]>("/me/appointments", { token }),

  myBusinesses: (token: string) =>
    request<BusinessDto[]>("/me/businesses", { token }),

  // ADR 0011: the front door.
  search: (query: string, signal?: AbortSignal) =>
    request<BusinessDto[]>("/businesses/search", {
      query: { q: query },
      ...(signal === undefined ? {} : { signal }),
    }),

  /**
   * Optionally carries the first day's availability, which saves the booking
   * screen a second round trip it could not begin until this one answered.
   */
  businessProfile: (businessId: string, range?: { from: string; to: string }) =>
    request<BusinessProfileDto>(`/businesses/${businessId}`, {
      ...(range === undefined ? {} : { query: range }),
    }),

  availability: (
    businessId: string,
    params: { serviceId: string; resourceId: string; from: string; to: string },
  ) =>
    request<DayAvailabilityDto[]>(`/businesses/${businessId}/availability`, {
      query: params,
    }),

  book: (
    token: string,
    booking: {
      businessId: string;
      serviceId: string;
      resourceId: string;
      startAt: string;
      customerNote: string | null;
    },
  ) =>
    request<AppointmentDto>("/appointments", {
      method: "POST",
      body: booking,
      token,
    }),

  cancel: (token: string, appointmentId: string) =>
    request<AppointmentDto>(`/appointments/${appointmentId}/cancel`, {
      method: "POST",
      token,
    }),

  reschedule: (token: string, appointmentId: string, startAt: string) =>
    request<AppointmentDto>(`/appointments/${appointmentId}/reschedule`, {
      method: "POST",
      body: { startAt },
      token,
    }),

  markNoShow: (token: string, appointmentId: string) =>
    request<AppointmentDto>(`/appointments/${appointmentId}/no-show`, {
      method: "POST",
      token,
    }),

  clearNoShow: (token: string, appointmentId: string) =>
    request<AppointmentDto>(`/appointments/${appointmentId}/no-show`, {
      method: "DELETE",
      token,
    }),

  // --- Owner -------------------------------------------------------------

  registerBusiness: (
    token: string,
    input: {
      name: string;
      phone: string;
      description: string | null;
      address: string | null;
      resourceNames: string[];
      services: {
        name: string;
        durationMinutes: number;
        priceMinor: number;
        bufferMinutes: number | null;
      }[];
      workingHours: { dayOfWeek: number; start: string; end: string }[];
    },
  ) =>
    request<BusinessDto>("/businesses", { method: "POST", body: input, token }),

  updateBusiness: (
    token: string,
    businessId: string,
    changes: Record<string, unknown>,
  ) =>
    request<BusinessDto>(`/businesses/${businessId}`, {
      method: "PATCH",
      body: changes,
      token,
    }),

  listServices: (token: string, businessId: string) =>
    request<ServiceDto[]>(`/businesses/${businessId}/services`, { token }),

  createService: (
    token: string,
    businessId: string,
    input: {
      name: string;
      durationMinutes: number;
      priceMinor: number;
      bufferMinutes: number | null;
    },
  ) =>
    request<ServiceDto>(`/businesses/${businessId}/services`, {
      method: "POST",
      body: input,
      token,
    }),

  updateService: (
    token: string,
    businessId: string,
    serviceId: string,
    changes: Record<string, unknown>,
  ) =>
    request<ServiceDto>(`/businesses/${businessId}/services/${serviceId}`, {
      method: "PATCH",
      body: changes,
      token,
    }),

  deleteService: (token: string, businessId: string, serviceId: string) =>
    request<void>(`/businesses/${businessId}/services/${serviceId}`, {
      method: "DELETE",
      token,
    }),

  listResources: (token: string, businessId: string) =>
    request<ResourceDto[]>(`/businesses/${businessId}/resources`, { token }),

  createResource: (token: string, businessId: string, name: string) =>
    request<ResourceDto>(`/businesses/${businessId}/resources`, {
      method: "POST",
      body: { name },
      token,
    }),

  updateResource: (
    token: string,
    businessId: string,
    resourceId: string,
    changes: { name?: string; active?: boolean },
  ) =>
    request<ResourceDto>(`/businesses/${businessId}/resources/${resourceId}`, {
      method: "PATCH",
      body: changes,
      token,
    }),

  deleteResource: (token: string, businessId: string, resourceId: string) =>
    request<void>(`/businesses/${businessId}/resources/${resourceId}`, {
      method: "DELETE",
      token,
    }),

  listWorkingHours: (token: string, businessId: string, resourceId: string) =>
    request<WorkingHoursDto[]>(
      `/businesses/${businessId}/resources/${resourceId}/working-hours`,
      { token },
    ),

  addWorkingHours: (
    token: string,
    businessId: string,
    resourceId: string,
    input: { dayOfWeek: number; start: string; end: string },
  ) =>
    request<WorkingHoursDto>(
      `/businesses/${businessId}/resources/${resourceId}/working-hours`,
      { method: "POST", body: input, token },
    ),

  updateWorkingHours: (
    token: string,
    businessId: string,
    id: string,
    input: { start: string; end: string },
  ) =>
    request<WorkingHoursDto>(`/businesses/${businessId}/working-hours/${id}`, {
      method: "PATCH",
      body: input,
      token,
    }),

  deleteWorkingHours: (token: string, businessId: string, id: string) =>
    request<void>(`/businesses/${businessId}/working-hours/${id}`, {
      method: "DELETE",
      token,
    }),

  listOverrides: (
    token: string,
    businessId: string,
    resourceId: string,
    range: { from: string; to: string },
  ) =>
    request<OverrideDto[]>(
      `/businesses/${businessId}/resources/${resourceId}/overrides`,
      { token, query: range },
    ),

  /** ADR 0002: an override replaces the whole date; an empty list is a day off. */
  putOverride: (
    token: string,
    businessId: string,
    resourceId: string,
    input: {
      date: string;
      note: string | null;
      ranges: { start: string; end: string }[];
    },
  ) =>
    request<OverrideDto>(
      `/businesses/${businessId}/resources/${resourceId}/overrides`,
      { method: "PUT", body: input, token },
    ),

  deleteOverride: (token: string, businessId: string, id: string) =>
    request<void>(`/businesses/${businessId}/overrides/${id}`, {
      method: "DELETE",
      token,
    }),

  calendarDay: (
    token: string,
    businessId: string,
    resourceId: string,
    date: string,
  ) =>
    request<CalendarDayDto>(
      `/businesses/${businessId}/resources/${resourceId}/calendar`,
      { token, query: { date } },
    ),

  createBlock: (
    token: string,
    businessId: string,
    resourceId: string,
    input: { startAt: string; endAt: string; reason: string },
  ) =>
    request<BlockDto>(
      `/businesses/${businessId}/resources/${resourceId}/blocks`,
      { method: "POST", body: input, token },
    ),

  deleteBlock: (token: string, businessId: string, blockId: string) =>
    request<void>(`/businesses/${businessId}/blocks/${blockId}`, {
      method: "DELETE",
      token,
    }),

  /** What the owner owes the platform. Read-only: only an administrator writes. */
  subscription: (token: string, businessId: string) =>
    request<{
      subscription: SubscriptionDto;
      payments: PaymentDto[];
      state: SubscriptionState;
    }>(`/businesses/${businessId}/subscription`, { token }),

  listCustomers: (token: string, businessId: string) =>
    request<UserDto[]>(`/businesses/${businessId}/customers`, { token }),

  customerRecord: (token: string, businessId: string, customerId: string) =>
    request<CustomerRecordDto>(
      `/businesses/${businessId}/customers/${customerId}`,
      { token },
    ),

  // --- Administrator (ADR 0010) -------------------------------------------

  adminBusinesses: (token: string, query: string | null) =>
    request<BusinessSummaryDto[]>("/admin/businesses", {
      token,
      query: query === null ? {} : { q: query },
    }),

  adminSetBusinessActive: (token: string, businessId: string, active: boolean) =>
    request<BusinessDto>(`/admin/businesses/${businessId}/active`, {
      method: "PATCH",
      body: { active },
      token,
    }),

  adminUpdateBusiness: (
    token: string,
    businessId: string,
    changes: Record<string, unknown>,
    reason: string,
  ) =>
    request<BusinessDto>(`/admin/businesses/${businessId}`, {
      method: "PATCH",
      body: { ...changes, reason },
      token,
    }),

  adminSubscription: (token: string, businessId: string) =>
    request<{
      subscription: SubscriptionDto;
      payments: PaymentDto[];
      state: SubscriptionState;
    }>(`/admin/businesses/${businessId}/subscription`, { token }),

  adminUpdateSubscription: (
    token: string,
    businessId: string,
    changes: {
      plan?: "FREE" | "STANDARD";
      amountMinor?: number;
      billingPeriod?: "MONTHLY" | "YEARLY";
    },
  ) =>
    request<SubscriptionDto>(`/admin/businesses/${businessId}/subscription`, {
      method: "PATCH",
      body: changes,
      token,
    }),

  adminRecordPayment: (
    token: string,
    businessId: string,
    input: { amountMinor: number; paidOn: string; note: string | null },
  ) =>
    request<PaymentDto>(`/admin/businesses/${businessId}/payments`, {
      method: "POST",
      body: input,
      token,
    }),

  adminUsers: (token: string, query: string | null) =>
    request<UserDto[]>("/admin/users", {
      token,
      query: query === null ? {} : { q: query },
    }),

  /** ADR 0006: opening this is itself audited. */
  adminUserRecord: (token: string, userId: string) =>
    request<{ user: UserDto; appointments: AppointmentDto[] }>(
      `/admin/users/${userId}`,
      { token },
    ),

  adminSetUserActive: (token: string, userId: string, active: boolean) =>
    request<UserDto>(`/admin/users/${userId}/active`, {
      method: "PATCH",
      body: { active },
      token,
    }),

  adminSetAdministrator: (
    token: string,
    userId: string,
    isAdministrator: boolean,
  ) =>
    request<UserDto>(`/admin/users/${userId}/administrator`, {
      method: "PATCH",
      body: { isAdministrator },
      token,
    }),

  /**
   * ADR 0008's erasure. Irreversible, so it takes an explicit confirmation and
   * a reason that is written to the audit trail.
   */
  adminAnonymiseUser: (token: string, userId: string, reason: string) =>
    request<UserDto>(`/admin/users/${userId}`, {
      method: "DELETE",
      body: { reason, confirm: true },
      token,
    }),

  adminAdministrators: (token: string) =>
    request<UserDto[]>("/admin/administrators", { token }),

  adminAllowlist: (token: string) =>
    request<AllowlistEntryDto[]>("/admin/allowlist", { token }),

  adminAddToAllowlist: (token: string, phone: string, note: string | null) =>
    request<void>("/admin/allowlist", {
      method: "POST",
      body: { phone, note },
      token,
    }),

  adminRemoveFromAllowlist: (token: string, phone: string) =>
    request<void>(`/admin/allowlist/${encodeURIComponent(phone)}`, {
      method: "DELETE",
      token,
    }),

  adminAudit: (token: string) =>
    request<AuditEntryDto[]>("/admin/audit", { token, query: { limit: 100 } }),
};
