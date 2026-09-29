import type { Hono } from "hono";
import { asId, parseLocalDate, type Money } from "@tor-now/domain";
import type { Services } from "../composition.ts";
import type { FairUseView } from "../application/fair-use-service.ts";
import type { Actor } from "../ports/unit-of-work.ts";
import { parse, parseBody, parseQuery } from "./context.ts";
import * as schema from "./cost-schemas.ts";
import { calculatorOut, monthCostsOut, referenceBusinessOut, runningCostOut } from "./cost-wire.ts";

/**
 * The Catalogue's Cost tab and Fair Use (ADR 0023), on the administrators'
 * router. Every figure is worked out when asked for; nothing here schedules or
 * stores a reading.
 */

type AdminRouter = Hono<{ Variables: { actor: Actor } }>;
type Context = { get: (key: "actor") => Actor; req: { param: (name: string) => string | undefined } };

const actorOf = (context: Context) => context.get("actor");
const uuidParam = <T extends string>(context: Context, name: string) =>
  asId<T>(parse(schema.uuidParamSchema, context.req.param(name)));

const fairUseOut = (view: FairUseView) => ({
  month: view.span.first.slice(0, 7),
  through: view.span.through,
  limits: view.limits,
  signIn: view.signIn,
  sources: view.sources,
});

export const costRoutes = (admin: AdminRouter, services: Services): void => {
  admin.get("/costs/month", async (context) => {
    const { month } = parseQuery(context, schema.monthQuerySchema);
    const first = month === undefined ? null : parseLocalDate(`${month}-01`);
    return context.json(monthCostsOut(await services.costs.month(actorOf(context), first)));
  });

  admin.get("/costs/calculator", async (context) =>
    context.json(calculatorOut(await services.costs.calculator(actorOf(context)))),
  );

  admin.post("/costs/reference-businesses", async (context) => {
    const body = await parseBody(context, schema.saveReferenceSchema);
    return context.json((await services.costs.saveReference(actorOf(context), body)).map(referenceBusinessOut));
  });

  admin.put("/costs/reference-businesses/:id", async (context) => {
    const body = await parseBody(context, schema.updateReferenceSchema);
    const saved = await services.costs.updateReference(actorOf(context), uuidParam(context, "id"), body);
    return context.json(saved.map(referenceBusinessOut));
  });

  admin.patch("/costs/reference-businesses/:id", async (context) => {
    const body = await parseBody(context, schema.renameReferenceSchema);
    const saved = await services.costs.renameReference(actorOf(context), uuidParam(context, "id"), body);
    return context.json(saved.map(referenceBusinessOut));
  });

  admin.delete("/costs/reference-businesses/:id", async (context) => {
    const saved = await services.costs.deleteReference(actorOf(context), uuidParam(context, "id"));
    return context.json(saved.map(referenceBusinessOut));
  });

  admin.get("/costs/running", async (context) =>
    context.json((await services.costs.runningCosts(actorOf(context))).map(runningCostOut)),
  );

  admin.post("/costs/running", async (context) => {
    const body = await parseBody(context, schema.addRunningCostSchema);
    const costs = await services.costs.addRunningCost(actorOf(context), {
      name: body.name,
      amount: { effectiveFrom: parseLocalDate(body.effectiveFrom), amount: body.amountMinor as Money, source: body.source },
    });
    return context.json(costs.map(runningCostOut));
  });

  admin.post("/costs/running/:id/amounts", async (context) => {
    const body = await parseBody(context, schema.runningCostAmountSchema);
    const costs = await services.costs.setRunningCostAmount(actorOf(context), uuidParam(context, "id"), {
      effectiveFrom: parseLocalDate(body.effectiveFrom),
      amount: body.amountMinor as Money,
      source: body.source,
    });
    return context.json(costs.map(runningCostOut));
  });

  admin.get("/fair-use", async (context) =>
    context.json(fairUseOut(await services.fairUse.fairUse(actorOf(context)))),
  );

  admin.get("/fair-use/alerts", async (context) =>
    context.json(await services.fairUse.alerts(actorOf(context))),
  );

  admin.put("/fair-use/limits/:source", async (context) => {
    const source = parse(schema.fairUseSourceParamSchema, context.req.param("source"));
    const { amountMinor } = await parseBody(context, schema.businessLimitSchema);
    return context.json(fairUseOut(await services.fairUse.setBusinessLimit(actorOf(context), source, amountMinor)));
  });

  admin.put("/fair-use/sign-in", async (context) => {
    const { codesPerDay } = await parseBody(context, schema.signInLimitSchema);
    return context.json(fairUseOut(await services.fairUse.setSignInLimit(actorOf(context), codesPerDay)));
  });

  admin.get("/businesses/:businessId/usage", async (context) => {
    const usage = await services.fairUse.businessUsage(actorOf(context), uuidParam<"Business">(context, "businessId"));
    return context.json({
      month: usage.span.first.slice(0, 7),
      through: usage.span.through,
      readings: usage.readings,
      whatsapp: usage.whatsapp,
      smsMessages: usage.smsMessages,
      total: usage.total,
      unpricedUnits: usage.unpricedUnits,
      monthlyPriceMinor: usage.monthlyPrice,
    });
  });
};
