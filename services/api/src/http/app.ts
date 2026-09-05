import { Hono } from "hono";
import { cors } from "hono/cors";
import { forbidden } from "@tor-now/domain";
import type { Services } from "../composition.ts";
import {
  parseBody,
  parseQuery,
  readActor,
  idParam,
  parse,
  photoSlotParam,
} from "./context.ts";
import { toErrorResponse } from "./errors.ts";
import * as schema from "./schemas.ts";
import * as wire from "./wire.ts";
import type { Actor } from "../ports/unit-of-work.ts";

const equalsInConstantTime = (left: string, right: string): boolean => {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
};

/**
 * ADR 0007: a single Edge Function with internal Hono routing hosts the domain
 * layer. Every route reads the caller's identity, delegates to an application
 * service, and serialises the result — no rule lives here.
 */

type Variables = { actor: Actor };

export const createApp = (services: Services) => {
  const app = new Hono<{ Variables: Variables }>();

  app.use(
    "*",
    cors({
      origin: (origin) =>
        services.config.corsOrigins.length === 0
          ? origin
          : services.config.corsOrigins.includes(origin)
            ? origin
            : null,
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      maxAge: 86400,
    }),
  );

  app.onError((error, context) =>
    // Hono types the Context it hands an error handler with `any` for the
    // route input, because an error can come from any route. The narrowing
    // this rule wants is not available to us here.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    toErrorResponse(context, error, services.config.exposeInternalErrors),
  );

  app.use("*", async (context, next) => {
    // Same reason as above: a wildcard middleware's Context is typed `any` for
    // the matched path, since it matches every one of them.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    context.set("actor", await readActor(context, services.tokens));
    await next();
  });

  const actorOf = (context: { get: (key: "actor") => Actor }) => context.get("actor");

  // ---------------------------------------------------------------------------
  // Health. Reports which transports are live, because "did my code send?" is
  // the first question anyone asks of a deployment with a vendor behind a flag.
  // ---------------------------------------------------------------------------
  app.get("/health", (context) =>
    context.json({
      status: "ok",
      verificationTransport: services.config.verificationTransport,
      signingKeyDerivedFrom: services.config.jwtSecretSource,
      notificationTransport: services.config.notificationTransport,
      exposesVerificationCode: services.config.exposeVerificationCode,
      // Which photo store is live. The in-function one forgets every picture
      // when the isolate restarts, so this is never something to guess at.
      photoStore: services.photos.kind,
    }),
  );

  /**
   * Where the time goes. Latency to the database dominates this system and is
   * invisible from outside — a slow endpoint and a distant database look the
   * same from a browser. Returns timings only, never data.
   */
  app.get("/health/database", async (context) =>
    context.json(await services.measureDatabase()),
  );

  // ---------------------------------------------------------------------------
  // Verification (ADR 0004). Registering and logging in are the same act.
  // ---------------------------------------------------------------------------
  app.post("/auth/request-code", async (context) => {
    const { phone } = await parseBody(context, schema.requestCodeSchema);
    return context.json(await services.auth.requestCode(phone));
  });

  app.post("/auth/verify", async (context) => {
    const body = await parseBody(context, schema.verifyCodeSchema);
    const result = await services.auth.verifyCode(body.phone, body.code, body.name);
    return context.json({
      token: result.token,
      isNewUser: result.isNewUser,
      user: wire.userOut(result.user),
    });
  });

  // ---------------------------------------------------------------------------
  // The signed-in User
  // ---------------------------------------------------------------------------
  app.get("/me", async (context) =>
    context.json(wire.userOut(await services.profile.me(actorOf(context)))),
  );

  app.patch("/me", async (context) => {
    const changes = await parseBody(context, schema.updateProfileSchema);
    return context.json(
      wire.userOut(await services.profile.updateProfile(actorOf(context), changes)),
    );
  });

  app.delete("/me", async (context) => {
    await services.profile.deleteAccount(actorOf(context));
    return context.body(null, 204);
  });

  app.get("/me/appointments", async (context) => {
    const page = parseQuery(context, schema.pageSchema);
    const appointments = await services.booking.myAppointments(actorOf(context), page);
    return context.json(appointments.map(wire.appointmentWithBusinessOut));
  });

  app.get("/me/businesses", async (context) => {
    const businesses = await services.business.listMine(actorOf(context));
    return context.json(businesses.map(wire.businessOut));
  });

  // ---------------------------------------------------------------------------
  // Discovery and availability (ADR 0011, ADR 0012)
  // ---------------------------------------------------------------------------
  app.get("/businesses/search", async (context) => {
    const { q } = parseQuery(context, schema.searchSchema);
    const businesses = await services.discovery.search(actorOf(context), q);
    return context.json(businesses.map(wire.businessOut));
  });

  app.get("/businesses/:businessId", async (context) => {
    // `from`/`to` are optional: with them the response also carries the times
    // the screen draws first, which saves the client a second round trip it
    // could not start until this one answered.
    const range = parseQuery(context, schema.optionalDateRangeSchema);
    const profile = await services.discovery.profile(
      actorOf(context),
      idParam(context, "businessId"),
      range.from === undefined || range.to === undefined
        ? undefined
        : { from: range.from as never, to: range.to as never },
    );
    return context.json({
      business: wire.businessOut(profile.business),
      services: profile.services.map(wire.serviceOut),
      resources: profile.resources.map(wire.resourceOut),
      photos: profile.photos.map((photo) =>
        wire.businessPhotoOut(photo, services.photos.urlFor),
      ),
      ...(profile.availability === undefined
        ? {}
        : { availability: profile.availability }),
    });
  });

  /**
   * The bytes, for the deployment that has no Storage behind it and serves its
   * own. With Storage the URLs point at the bucket's CDN and nothing reaches
   * this route at all; it answers 404 there rather than pretending.
   */
  app.get("/photos/:path{.+}", (context) => {
    const held = services.photos.read?.(context.req.param("path"));
    if (held === undefined || held === null) return context.notFound();
    return context.body(held.bytes as unknown as ArrayBuffer, 200, {
      "Content-Type": held.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
    });
  });

  app.get("/businesses/:businessId/availability", async (context) => {
    const query = parseQuery(context, schema.availabilitySchema);
    const days = await services.availability.forRange(actorOf(context), {
      businessId: idParam(context, "businessId"),
      serviceId: query.serviceId as never,
      resourceId: query.resourceId as never,
      from: query.from as never,
      to: query.to as never,
    });
    return context.json(days);
  });

  // ---------------------------------------------------------------------------
  // Booking
  // ---------------------------------------------------------------------------
  app.post("/appointments", async (context) => {
    const body = await parseBody(context, schema.bookingSchema);
    const appointment = await services.booking.book(actorOf(context), {
      businessId: body.businessId as never,
      serviceId: body.serviceId as never,
      resourceId: body.resourceId as never,
      startAt: body.startAt,
      customerNote: body.customerNote,
      bookingAnotherOfTheSame: body.bookingAnotherOfTheSame,
    });
    return context.json(wire.appointmentOut(appointment), 201);
  });

  app.post("/appointments/:appointmentId/cancel", async (context) =>
    context.json(
      wire.appointmentOut(
        await services.booking.cancel(actorOf(context), idParam(context, "appointmentId")),
      ),
    ),
  );

  app.put("/appointments/:appointmentId/note", async (context) => {
    const { customerNote } = await parseBody(context, schema.customerNoteSchema);
    return context.json(
      wire.appointmentOut(
        await services.booking.setCustomerNote(
          actorOf(context),
          idParam(context, "appointmentId"),
          // A cleared field and an absent note are the same thing.
          customerNote === "" ? null : customerNote,
        ),
      ),
    );
  });

  app.post("/appointments/:appointmentId/reschedule", async (context) => {
    const { startAt } = await parseBody(context, schema.rescheduleSchema);
    return context.json(
      wire.appointmentOut(
        await services.booking.reschedule(
          actorOf(context),
          idParam(context, "appointmentId"),
          startAt,
        ),
      ),
    );
  });

  app.post("/appointments/:appointmentId/no-show", async (context) =>
    context.json(
      wire.appointmentOut(
        await services.booking.markNoShow(
          actorOf(context),
          idParam(context, "appointmentId"),
        ),
      ),
    ),
  );

  app.delete("/appointments/:appointmentId/no-show", async (context) =>
    context.json(
      wire.appointmentOut(
        await services.booking.clearNoShow(
          actorOf(context),
          idParam(context, "appointmentId"),
        ),
      ),
    ),
  );

  app.route("/businesses", ownerRoutes(services));
  app.route("/admin", adminRoutes(services));
  app.route("/jobs", jobRoutes(services));

  return app;
};

// -----------------------------------------------------------------------------
// Owner routes. Every one of these authorizes against a Membership explicitly
// (ADR 0007) on top of the Row Level Security that already covers them.
// -----------------------------------------------------------------------------
const ownerRoutes = (services: Services) => {
  const owner = new Hono<{ Variables: { actor: Actor } }>();
  const actorOf = (context: { get: (key: "actor") => Actor }) => context.get("actor");

  owner.post("/", async (context) => {
    const body = await parseBody(context, schema.registerBusinessSchema);
    const business = await services.business.register(actorOf(context), body);
    return context.json(wire.businessOut(business), 201);
  });

  owner.patch("/:businessId", async (context) => {
    const changes = await parseBody(context, schema.updateBusinessSchema);
    return context.json(
      wire.businessOut(
        await services.business.update(
          actorOf(context),
          idParam(context, "businessId"),
          changes,
        ),
      ),
    );
  });

  owner.get("/:businessId/services", async (context) => {
    const list = await services.business.listServices(
      actorOf(context),
      idParam(context, "businessId"),
    );
    return context.json(list.map(wire.serviceOut));
  });

  owner.post("/:businessId/services", async (context) => {
    const body = await parseBody(context, schema.serviceSchema);
    return context.json(
      wire.serviceOut(
        await services.business.createService(
          actorOf(context),
          idParam(context, "businessId"),
          body,
        ),
      ),
      201,
    );
  });

  owner.patch("/:businessId/services/:serviceId", async (context) => {
    const body = await parseBody(context, schema.serviceUpdateSchema);
    return context.json(
      wire.serviceOut(
        await services.business.updateService(
          actorOf(context),
          idParam(context, "businessId"),
          idParam(context, "serviceId"),
          body,
        ),
      ),
    );
  });

  owner.delete("/:businessId/services/:serviceId", async (context) => {
    await services.business.deleteService(
      actorOf(context),
      idParam(context, "businessId"),
      idParam(context, "serviceId"),
    );
    return context.body(null, 204);
  });

  // ---------------------------------------------------------------------------
  // Photos
  //
  // The bytes arrive as the request body rather than as a JSON field, because
  // base64 costs a third more of everything for nothing, and the content type
  // is already a header. The slot is in the path, so which picture is being
  // replaced is never inferred.
  // ---------------------------------------------------------------------------

  owner.get("/:businessId/photos", async (context) => {
    const list = await services.business.listPhotos(
      actorOf(context),
      idParam(context, "businessId"),
    );
    return context.json(
      list.map((photo) => wire.businessPhotoOut(photo, services.photos.urlFor)),
    );
  });

  owner.put("/:businessId/photos/:slot", async (context) => {
    const slot = photoSlotParam(context);
    const contentType = (context.req.header("content-type") ?? "").split(";")[0]?.trim() ?? "";
    const bytes = new Uint8Array(await context.req.arrayBuffer());
    const photo = await services.business.putPhoto(
      actorOf(context),
      idParam(context, "businessId"),
      { slot, bytes, contentType },
    );
    return context.json(wire.businessPhotoOut(photo, services.photos.urlFor), 201);
  });

  owner.delete("/:businessId/photos/:photoId", async (context) => {
    await services.business.deletePhoto(
      actorOf(context),
      idParam(context, "businessId"),
      idParam(context, "photoId"),
    );
    return context.body(null, 204);
  });

  owner.get("/:businessId/resources", async (context) => {
    const list = await services.business.listResources(
      actorOf(context),
      idParam(context, "businessId"),
    );
    return context.json(list.map(wire.resourceOut));
  });

  owner.post("/:businessId/resources", async (context) => {
    const { name } = await parseBody(context, schema.resourceSchema);
    return context.json(
      wire.resourceOut(
        await services.business.createResource(
          actorOf(context),
          idParam(context, "businessId"),
          name,
        ),
      ),
      201,
    );
  });

  owner.patch("/:businessId/resources/:resourceId", async (context) => {
    const body = await parseBody(context, schema.resourceUpdateSchema);
    return context.json(
      wire.resourceOut(
        await services.business.updateResource(
          actorOf(context),
          idParam(context, "businessId"),
          idParam(context, "resourceId"),
          body,
        ),
      ),
    );
  });

  owner.delete("/:businessId/resources/:resourceId", async (context) => {
    await services.business.deleteResource(
      actorOf(context),
      idParam(context, "businessId"),
      idParam(context, "resourceId"),
    );
    return context.body(null, 204);
  });

  owner.get("/:businessId/resources/:resourceId/working-hours", async (context) => {
    const hours = await services.business.listWorkingHours(
      actorOf(context),
      idParam(context, "businessId"),
      idParam(context, "resourceId"),
    );
    return context.json(hours.map(wire.workingHoursOut));
  });

  owner.post("/:businessId/resources/:resourceId/working-hours", async (context) => {
    const body = await parseBody(context, schema.workingHoursSchema);
    return context.json(
      wire.workingHoursOut(
        await services.business.addWorkingHours(
          actorOf(context),
          idParam(context, "businessId"),
          idParam(context, "resourceId"),
          body,
        ),
      ),
      201,
    );
  });

  owner.patch("/:businessId/working-hours/:id", async (context) => {
    const body = await parseBody(context, schema.workingHoursUpdateSchema);
    return context.json(
      wire.workingHoursOut(
        await services.business.updateWorkingHours(
          actorOf(context),
          idParam(context, "businessId"),
          idParam(context, "id"),
          body,
        ),
      ),
    );
  });

  owner.delete("/:businessId/working-hours/:id", async (context) => {
    await services.business.deleteWorkingHours(
      actorOf(context),
      idParam(context, "businessId"),
      idParam(context, "id"),
    );
    return context.body(null, 204);
  });

  owner.get("/:businessId/resources/:resourceId/overrides", async (context) => {
    const { from, to } = parseQuery(context, schema.dateRangeSchema);
    const overrides = await services.business.listOverrides(
      actorOf(context),
      idParam(context, "businessId"),
      idParam(context, "resourceId"),
      from,
      to,
    );
    return context.json(overrides.map(wire.overrideOut));
  });

  owner.put("/:businessId/resources/:resourceId/overrides", async (context) => {
    const body = await parseBody(context, schema.overrideSchema);
    return context.json(
      wire.overrideOut(
        await services.business.putOverride(
          actorOf(context),
          idParam(context, "businessId"),
          idParam(context, "resourceId"),
          body,
        ),
      ),
    );
  });

  owner.delete("/:businessId/overrides/:id", async (context) => {
    await services.business.deleteOverride(
      actorOf(context),
      idParam(context, "businessId"),
      idParam(context, "id"),
    );
    return context.body(null, 204);
  });

  owner.get("/:businessId/appointments", async (context) => {
    const { q } = parseQuery(context, schema.appointmentSearchSchema);
    const found = await services.calendar.search(
      actorOf(context),
      idParam(context, "businessId"),
      q ?? "",
    );
    return context.json(
      found.map((match) =>
        wire.appointmentWithCustomerOut({
          ...match.appointment,
          customerName: match.customerName,
          customerPhone: match.customerPhone,
        }),
      ),
    );
  });

  owner.get("/:businessId/resources/:resourceId/calendar", async (context) => {
    const { date } = parseQuery(context, schema.calendarDaySchema);
    const day = await services.calendar.day(
      actorOf(context),
      idParam(context, "businessId"),
      idParam(context, "resourceId"),
      date,
    );
    return context.json({
      date: day.date,
      appointments: day.appointments.map(wire.appointmentWithCustomerOut),
      blocks: day.blocks.map(wire.blockOut),
    });
  });

  owner.get("/:businessId/resources/:resourceId/calendar/month", async (context) => {
    const { firstOfMonth } = parseQuery(context, schema.calendarMonthSchema);
    const days = await services.calendar.month(
      actorOf(context),
      idParam(context, "businessId"),
      idParam(context, "resourceId"),
      firstOfMonth,
    );
    return context.json(days);
  });

  owner.post("/:businessId/resources/:resourceId/blocks", async (context) => {
    const body = await parseBody(context, schema.blockSchema);
    return context.json(
      wire.blockOut(
        await services.calendar.createBlock(
          actorOf(context),
          idParam(context, "businessId"),
          idParam(context, "resourceId"),
          body,
        ),
      ),
      201,
    );
  });

  owner.delete("/:businessId/blocks/:blockId", async (context) => {
    await services.calendar.deleteBlock(
      actorOf(context),
      idParam(context, "businessId"),
      idParam(context, "blockId"),
    );
    return context.body(null, 204);
  });

  // ADR: Billing → Scheduling is one-way; an owner reads what they owe and
  // records nothing, which is why there is no matching write here.
  owner.get("/:businessId/subscription", async (context) => {
    const result = await services.business.subscription(
      actorOf(context),
      idParam(context, "businessId"),
    );
    return context.json({
      subscription: wire.subscriptionOut(result.subscription),
      payments: result.payments.map(wire.paymentOut),
      state: result.state,
    });
  });

  owner.get("/:businessId/customers", async (context) => {
    const customers = await services.calendar.customers(
      actorOf(context),
      idParam(context, "businessId"),
    );
    return context.json(customers.map(wire.customerOut));
  });

  owner.patch("/:businessId/customers/:customerId/blocked", async (context) => {
    const { blocked } = await parseBody(context, schema.blockedFlagSchema);
    const membership = await services.calendar.setCustomerBlocked(
      actorOf(context),
      idParam(context, "businessId"),
      idParam(context, "customerId"),
      blocked,
    );
    return context.json({ blocked: membership.blockedAt !== null });
  });

  owner.get("/:businessId/customers/:customerId", async (context) => {
    const record = await services.calendar.customerRecord(
      actorOf(context),
      idParam(context, "businessId"),
      idParam(context, "customerId"),
    );
    return context.json({
      user: wire.userOut(record.user),
      blocked: record.blocked,
      blockable: record.blockable,
      appointments: record.appointments.map(wire.appointmentOut),
      lateCancellations: record.lateCancellations,
      noShows: record.noShows,
    });
  });

  return owner;
};

// -----------------------------------------------------------------------------
// Administrator routes (ADR 0010). Bounded, and audited without exception.
// -----------------------------------------------------------------------------
const adminRoutes = (services: Services) => {
  const admin = new Hono<{ Variables: { actor: Actor } }>();
  const actorOf = (context: { get: (key: "actor") => Actor }) => context.get("actor");

  admin.get("/businesses", async (context) => {
    const page = parseQuery(context, schema.pageSchema);
    const { q } = parseQuery(context, schema.queryTextSchema);
    const summaries = await services.admin.listBusinesses(actorOf(context), q, page);
    return context.json(
      summaries.map((summary) => ({
        business: wire.businessOut(summary.business),
        subscription:
          summary.subscription === null ? null : wire.subscriptionOut(summary.subscription),
        subscriptionState: summary.subscriptionState,
        ownerName: summary.ownerName,
      })),
    );
  });

  admin.patch("/businesses/:businessId/active", async (context) => {
    const { active } = await parseBody(context, schema.activeFlagSchema);
    return context.json(
      wire.businessOut(
        await services.admin.setBusinessActive(
          actorOf(context),
          idParam(context, "businessId"),
          active,
        ),
      ),
    );
  });

  admin.patch("/businesses/:businessId", async (context) => {
    const { reason, ...changes } = await parseBody(
      context,
      schema.adminBusinessUpdateSchema,
    );
    return context.json(
      wire.businessOut(
        await services.admin.updateBusiness(
          actorOf(context),
          idParam(context, "businessId"),
          changes,
          reason,
        ),
      ),
    );
  });

  admin.get("/businesses/:businessId/subscription", async (context) => {
    const result = await services.admin.subscriptionFor(
      actorOf(context),
      idParam(context, "businessId"),
    );
    return context.json({
      subscription: wire.subscriptionOut(result.subscription),
      payments: result.payments.map(wire.paymentOut),
      state: result.state,
    });
  });

  admin.patch("/businesses/:businessId/subscription", async (context) => {
    const body = await parseBody(context, schema.subscriptionUpdateSchema);
    return context.json(
      wire.subscriptionOut(
        await services.admin.updateSubscription(
          actorOf(context),
          idParam(context, "businessId"),
          body,
        ),
      ),
    );
  });

  admin.post("/businesses/:businessId/payments", async (context) => {
    const body = await parseBody(context, schema.paymentSchema);
    return context.json(
      wire.paymentOut(
        await services.admin.recordPayment(
          actorOf(context),
          idParam(context, "businessId"),
          body,
        ),
      ),
      201,
    );
  });

  admin.get("/users", async (context) => {
    const page = parseQuery(context, schema.pageSchema);
    const { q } = parseQuery(context, schema.queryTextSchema);
    const users = await services.admin.listUsers(actorOf(context), q, page);
    return context.json(users.map(wire.userOut));
  });

  admin.get("/users/:userId", async (context) => {
    const record = await services.admin.readCustomerRecord(
      actorOf(context),
      idParam(context, "userId"),
    );
    return context.json({
      user: wire.userOut(record.user),
      memberships: record.memberships,
      appointments: record.appointments.map(wire.appointmentOut),
    });
  });

  admin.patch("/users/:userId/active", async (context) => {
    const { active } = await parseBody(context, schema.activeFlagSchema);
    return context.json(
      wire.userOut(
        await services.admin.setUserActive(
          actorOf(context),
          idParam(context, "userId"),
          active,
        ),
      ),
    );
  });

  admin.patch("/users/:userId/administrator", async (context) => {
    const { isAdministrator } = await parseBody(context, schema.administratorFlagSchema);
    return context.json(
      wire.userOut(
        await services.admin.setAdministrator(
          actorOf(context),
          idParam(context, "userId"),
          isAdministrator,
        ),
      ),
    );
  });

  // ADR 0008. A DELETE rather than a PATCH, because it removes rather than
  // toggles — and it demands an explicit confirmation in the body, since no
  // amount of undo will bring the data back.
  admin.delete("/users/:userId", async (context) => {
    const { reason } = await parseBody(context, schema.erasureSchema);
    return context.json(
      wire.userOut(
        await services.admin.anonymiseUser(
          actorOf(context),
          idParam(context, "userId"),
          reason,
        ),
      ),
    );
  });

  admin.get("/administrators", async (context) => {
    const list = await services.admin.listAdministrators(actorOf(context));
    return context.json(list.map(wire.userOut));
  });

  admin.get("/allowlist", async (context) =>
    context.json(await services.admin.listAllowlist(actorOf(context))),
  );

  admin.post("/allowlist", async (context) => {
    const body = await parseBody(context, schema.allowlistSchema);
    await services.admin.addToAllowlist(actorOf(context), body.phone, body.note);
    return context.body(null, 204);
  });

  admin.delete("/allowlist/:phone", async (context) => {
    const phone = parse(schema.phoneSchema, context.req.param("phone"));
    await services.admin.removeFromAllowlist(actorOf(context), phone);
    return context.body(null, 204);
  });

  admin.get("/audit", async (context) => {
    const page = parseQuery(context, schema.pageSchema);
    const entries = await services.admin.auditLog(actorOf(context), page);
    return context.json(
      entries.map((entry) => ({
        ...entry,
        occurredAt: new Date(entry.occurredAt).toISOString(),
      })),
    );
  });

  return admin;
};

// -----------------------------------------------------------------------------
// Scheduled work (ADR 0005, ADR 0006). Serverless functions do not run
// unprompted, so Supabase Cron calls these. They are guarded by a shared secret
// rather than a session: cron has no user, and ADR 0010 forbids giving it one.
// -----------------------------------------------------------------------------
const jobRoutes = (services: Services) => {
  const jobs = new Hono<{ Variables: { actor: Actor } }>();

  jobs.use("*", async (context, next) => {
    const expected = await services.jobCredential.read();
    const presented = (context.req.header("Authorization") ?? "").replace(
      /^Bearer\s+/i,
      "",
    );
    // Compared in constant time: a timing oracle here would leak the credential
    // one byte at a time.
    if (expected === null || !equalsInConstantTime(presented, expected)) {
      throw forbidden("This endpoint is for scheduled work");
    }
    await next();
  });

  jobs.post("/outbox", async (context) =>
    context.json(await services.outboxWorker.drain()),
  );

  jobs.post("/reminders", async (context) =>
    context.json(await services.reminders.send()),
  );

  jobs.post("/audit-retention", async (context) =>
    context.json({ removed: await services.pruneAuditLog() }),
  );

  jobs.post("/billing-deactivation", async (context) =>
    context.json({ deactivated: await services.deactivateLapsedBusinesses() }),
  );

  return jobs;
};
