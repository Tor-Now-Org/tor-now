import { request } from "./client.ts";
import type {
  BusinessUsageDto,
  CalculatorBasisDto,
  CalculatorUseDto,
  FairUseAlertsDto,
  FairUseDto,
  FairUseSourceName,
  MonthCostsDto,
  ReferenceBusinessDto,
  RunningCostAmountDto,
  RunningCostDto,
} from "./cost-types.ts";
import type { DirectoryRowDto } from "./types.ts";

/** The Cost tab and Fair Use (ADR 0023). Every read is worked out when asked for. */
export const costApi = {
  month: (token: string, month: string | null) =>
    request<MonthCostsDto>("/admin/costs/month", { token, ...(month === null ? {} : { query: { month } }) }),

  calculator: (token: string) => request<CalculatorBasisDto>("/admin/costs/calculator", { token }),

  saveReference: (token: string, input: { name: string; use: CalculatorUseDto }) =>
    request<ReferenceBusinessDto[]>("/admin/costs/reference-businesses", { method: "POST", body: input, token }),

  updateReference: (token: string, id: string, use: CalculatorUseDto) =>
    request<ReferenceBusinessDto[]>(`/admin/costs/reference-businesses/${id}`, { method: "PUT", body: { use }, token }),

  renameReference: (token: string, id: string, name: string) =>
    request<ReferenceBusinessDto[]>(`/admin/costs/reference-businesses/${id}`, { method: "PATCH", body: { name }, token }),

  deleteReference: (token: string, id: string) =>
    request<ReferenceBusinessDto[]>(`/admin/costs/reference-businesses/${id}`, { method: "DELETE", token }),

  runningCosts: (token: string) => request<RunningCostDto[]>("/admin/costs/running", { token }),

  addRunningCost: (token: string, input: RunningCostAmountDto & { name: string }) =>
    request<RunningCostDto[]>("/admin/costs/running", { method: "POST", body: input, token }),

  setRunningCostAmount: (token: string, id: string, amount: RunningCostAmountDto) =>
    request<RunningCostDto[]>(`/admin/costs/running/${id}/amounts`, { method: "POST", body: amount, token }),

  fairUse: (token: string) => request<FairUseDto>("/admin/fair-use", { token }),

  fairUseAlerts: (token: string) => request<FairUseAlertsDto>("/admin/fair-use/alerts", { token }),

  setBusinessLimit: (token: string, source: FairUseSourceName, amountMinor: number) =>
    request<FairUseDto>(`/admin/fair-use/limits/${source}`, { method: "PUT", body: { amountMinor }, token }),

  setSignInLimit: (token: string, codesPerDay: number) =>
    request<FairUseDto>("/admin/fair-use/sign-in", { method: "PUT", body: { codesPerDay }, token }),

  businessUsage: (token: string, businessId: string) =>
    request<BusinessUsageDto>(`/admin/businesses/${businessId}/usage`, { token }),

  businessRow: (token: string, businessId: string) =>
    request<DirectoryRowDto>(`/admin/businesses/${businessId}`, { token }),
};
