import {
  addDays,
  classifyChanges,
  compareLocalDate,
  datesBetween,
  dayOfWeekOf,
  forbidden,
  instantToZoned,
  interval,
  manages,
  normalize,
  notFound,
  parseChangeId,
  parseLocalDate,
  parseLocalTime,
  todayIn,
  validationFailed,
  zonedToInstant,
  END_OF_DAY,
  MAX_CHANGE_DAYS,
  MIDNIGHT,
  type Appointment,
  type Block,
  type Business,
  type BusinessId,
  type CalendarChange,
  type ChangeOutcome,
  type ChangeScope,
  type Clock,
  type LocalDate,
  type LocalInterval,
  type LocalTimeRangeValue,
  type ResourceId,
} from "@tor-now/domain";
import { loadStaffedBusiness } from "./authorization.ts";
import {
  bookedInside,
  cancelAndTell,
  strandedByHours,
  writeBlocks,
  writeOverrides,
  type BlockSpan,
} from "./schedule-writes.ts";
import { namedFor, type StrandedAppointment, type Upcoming } from "./stranded.ts";
import { markManyForRecheck } from "./waiting-service.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { Actor, Session, UnitOfWork } from "../ports/unit-of-work.ts";

/**
 * "שינוי ביומן": one way to change a day, whatever door it was opened from.
 *
 * The owner says who it is for — one calendar or the whole business — and what
 * happens on those days: not working at all, not working some hours of them,
 * or working other hours. Each answer is written as the record that already
 * does that job (see the classifier in the domain), so availability, the
 * waiting list and every customer-facing rule read what they always read.
 *
 * What this adds is the decision as one thing: permission by scope rather than
 * by record, the people a change strands named before it is made, and an edit
 * saved as one replacement, never a moment with both versions or neither.
 */

export type ChangePlan = {
  readonly scope: ChangeScope;
  readonly fromDate: string;
  readonly toDate: string;
  readonly outcome: ChangeOutcome;
  readonly ranges: readonly { start: string; end: string }[];
  readonly note: string | null;
};

export type ChangePreview = {
  readonly days: number;
  readonly calendars: number;
  readonly appointments: readonly StrandedAppointment[];
  /** Earlier changes on these days the new one would write over. */
  readonly replaces: readonly CalendarChange[];
  /** What the first day usually keeps, for this scope: where "other hours" starts from. */
  readonly usual: readonly LocalTimeRangeValue[];
  /** Other hours that are exactly what every calendar keeps on every one of these days anyway. */
  readonly sameAsUsual: boolean;
};

export type ChangeResult = {
  readonly days: number;
  readonly calendars: number;
  readonly cancelled: number;
};

type Context = {
  readonly business: Business;
  /** Every calendar on offer, in the business's order. */
  readonly calendars: readonly ResourceId[];
  readonly manages: boolean;
  /** The calendars this caller keeps; all of them for an owner or a manager. */
  readonly mine: ReadonlySet<ResourceId>;
};

const contextOf = async (
  repositories: Repositories,
  actor: Actor,
  businessId: BusinessId,
): Promise<Context> => {
  const { membership, business } = await loadStaffedBusiness(repositories, actor, businessId);
  const calendars = (await repositories.resources.listForBusiness(businessId))
    .filter((resource) => resource.active)
    .map((resource) => resource.id);
  // An administrator arrives without a membership, unrestricted (ADR 0010).
  const managing = membership === null || manages(membership);
  const mine = managing
    ? new Set(calendars)
    : new Set(
        (await repositories.membershipResources.listForMembership(membership.id)).map(
          (assignment) => assignment.resourceId,
        ),
      );
  return { business, calendars, manages: managing, mine };
};

/** ADR 0016: the whole business is an owner's or a manager's; a calendar, whoever keeps it. */
const authorize = (context: Context, scope: ChangeScope): void => {
  if (scope.kind === "BUSINESS") {
    if (!context.manages) throw forbidden("Only an owner or a manager changes the whole business");
    return;
  }
  if (!context.calendars.includes(scope.resourceId)) throw notFound("Resource", scope.resourceId);
  if (!context.mine.has(scope.resourceId)) throw forbidden("This calendar is not yours");
};

const mayRead = (context: Context, change: CalendarChange): boolean =>
  change.scope.kind === "BUSINESS" || context.mine.has(change.scope.resourceId);

const targetsOf = (context: Context, scope: ChangeScope): readonly ResourceId[] =>
  scope.kind === "BUSINESS" ? context.calendars : [scope.resourceId];

const hoursOf = (ranges: readonly { start: string; end: string }[]): LocalInterval[] => {
  const hours = ranges.map((range) => {
    const start = parseLocalTime(range.start);
    const end = parseLocalTime(range.end);
    if (end <= start) throw validationFailed("Hours must end after they start");
    return interval(start, end);
  });
  const ordered = [...hours].sort((left, right) => left.start - right.start);
  if (ordered.some((range, index) => index > 0 && range.start < ordered[index - 1]!.end)) {
    throw validationFailed("The hours overlap");
  }
  // Stretches that only meet are one stretch, typed in two.
  return normalize(ordered);
};

type Checked = {
  readonly dates: readonly LocalDate[];
  readonly hours: readonly LocalInterval[];
  readonly note: string | null;
};

/** The plan, read in full before anything is written. */
const check = (plan: ChangePlan, today: LocalDate): Checked => {
  const from = parseLocalDate(plan.fromDate);
  const to = parseLocalDate(plan.toDate);
  if (compareLocalDate(to, from) < 0) throw validationFailed("A change cannot end before it starts");
  if (compareLocalDate(from, today) < 0) throw validationFailed("A day that has passed cannot be changed");
  const dates = datesBetween(from, to);
  if (dates.length > MAX_CHANGE_DAYS) throw validationFailed(`A change covers at most ${MAX_CHANGE_DAYS} days`);
  const hours = hoursOf(plan.ranges);
  if (plan.outcome === "OFF_ALL_DAY" && hours.length > 0) {
    throw validationFailed("A day off keeps no hours");
  }
  if (plan.outcome !== "OFF_ALL_DAY" && hours.length === 0) {
    throw validationFailed("Say which hours");
  }
  const note = plan.note?.trim() ?? "";
  return { dates, hours, note: note === "" ? null : note };
};

/**
 * Whether this plan is written as Overrides, which replace a day's hours, or as
 * Blocks carved out of them. A day off is a day with no hours — for one calendar
 * exactly as for the business — so it reads the same way through every edit and
 * replaces other hours set for that day; only some hours off are Blocks.
 */
const writesOverrides = (plan: Pick<ChangePlan, "outcome">): boolean => plan.outcome !== "OFF_PART";

/** The Blocks some hours off come to, before any is written. */
const spansOf = (business: Business, targets: readonly ResourceId[], checked: Checked): BlockSpan[] =>
  targets.flatMap((resourceId) =>
    checked.dates.flatMap((date) =>
      checked.hours.map((range) => ({
        resourceId,
        startAt: zonedToInstant(date, range.start, business.timeZone),
        endAt: zonedToInstant(date, range.end, business.timeZone),
      })),
    ),
  );

/** Every change the records come to, read wide enough that none is cut short. */
const changesAround = async (
  repositories: Repositories,
  context: Context,
  from: LocalDate,
  to: LocalDate,
): Promise<readonly CalendarChange[]> => {
  const reachFrom = addDays(from, -MAX_CHANGE_DAYS);
  const reachTo = addDays(to, MAX_CHANGE_DAYS);
  const zone = context.business.timeZone;
  const [overrides, blocks] = await Promise.all([
    repositories.dateOverrides.listForResources(context.calendars, reachFrom, reachTo),
    repositories.blocks.listForResourcesBetween(
      context.calendars,
      zonedToInstant(reachFrom, MIDNIGHT, zone),
      zonedToInstant(reachTo, END_OF_DAY, zone),
    ),
  ]);
  return classifyChanges({ calendars: context.calendars, overrides, blocks, timeZone: zone }).filter(
    (change) => compareLocalDate(change.toDate, from) >= 0 && compareLocalDate(change.fromDate, to) <= 0,
  );
};

const findChange = async (
  repositories: Repositories,
  context: Context,
  id: string,
): Promise<CalendarChange> => {
  const ref = parseChangeId(id);
  if (ref === null) throw notFound("Change", id);
  const found =
    ref.kind === "BLOCKS"
      ? classifyChanges({
          calendars: context.calendars,
          overrides: [],
          blocks: await repositories.blocks.listGroup(context.business.id, ref.groupId),
          timeZone: context.business.timeZone,
        })[0]
      : (await changesAround(repositories, context, ref.fromDate, ref.toDate)).find(
          (change) => change.id === id,
        );
  if (found === undefined) throw notFound("Change", id);
  return found;
};

/** What the first day usually keeps, for this scope. */
const usualHours = async (
  repositories: Repositories,
  targets: readonly ResourceId[],
  date: LocalDate,
): Promise<LocalTimeRangeValue[]> => {
  const weekday = dayOfWeekOf(date);
  const week = await repositories.workingHours.listForResources(targets);
  return normalize(
    week.filter((entry) => entry.dayOfWeek === weekday).map((entry) => interval(entry.start, entry.end)),
  ).map((range) => ({ start: range.start, end: range.end }));
};

const shapeOf = (ranges: readonly { start: number; end: number }[]) =>
  normalize(ranges.map((range) => interval(range.start, range.end)))
    .map((range) => `${range.start}-${range.end}`)
    .join(",");

/**
 * Whether these hours are what each of these calendars keeps on each of these
 * days by its usual week — in which case "other hours" would change nothing.
 */
const keepsTheUsual = async (
  repositories: Repositories,
  targets: readonly ResourceId[],
  dates: readonly LocalDate[],
  hours: readonly LocalInterval[],
): Promise<boolean> => {
  const week = await repositories.workingHours.listForResources(targets);
  const wanted = shapeOf(hours);
  return targets.every((resourceId) =>
    dates.every((date) => {
      const weekday = dayOfWeekOf(date);
      return shapeOf(week.filter((entry) => entry.resourceId === resourceId && entry.dayOfWeek === weekday)) === wanted;
    }),
  );
};

/** A Block, less the days being given back; what is left of it stays in its group. */
const trimBlock = async (
  repositories: Repositories,
  block: Block,
  dates: ReadonlySet<LocalDate>,
  business: Business,
): Promise<readonly LocalDate[]> => {
  const zone = business.timeZone;
  const first = instantToZoned(block.startAt, zone).date;
  const last = instantToZoned(block.endAt, zone).date;
  const touched = datesBetween(first, last).filter((date) => dates.has(date));
  if (touched.length === 0) return [];

  await repositories.blocks.delete(block.id);
  let keep = [interval(block.startAt, block.endAt)];
  for (const date of touched) {
    const day = interval(
      zonedToInstant(date, MIDNIGHT, zone),
      zonedToInstant(addDays(date, 1), MIDNIGHT, zone),
    );
    keep = keep.flatMap((span) =>
      span.end <= day.start || span.start >= day.end
        ? [span]
        : [
            ...(span.start < day.start ? [interval(span.start, day.start)] : []),
            ...(span.end > day.end ? [interval(day.end, span.end)] : []),
          ],
    );
  }
  for (const span of keep) {
    await repositories.blocks.create({
      resourceId: block.resourceId,
      businessId: block.businessId,
      startAt: span.start,
      endAt: span.end,
      reason: block.reason,
      groupId: block.groupId,
    });
  }
  return touched;
};

/** A change's records on some of its days, removed; the days return to the week's own hours. */
const removeDays = async (
  repositories: Repositories,
  context: Context,
  change: CalendarChange,
  dates: readonly LocalDate[],
): Promise<number> => {
  if (dates.length === 0) return 0;
  const ref = parseChangeId(change.id);
  /* istanbul ignore next -- a change found by its id always has one */
  if (ref === null) return 0;
  const wanted = new Set(dates);

  if (ref.kind === "BLOCKS") {
    const marks: { resourceId: ResourceId; onDate: LocalDate }[] = [];
    for (const block of await repositories.blocks.listGroup(context.business.id, ref.groupId)) {
      const freed = await trimBlock(repositories, block, wanted, context.business);
      marks.push(...freed.map((onDate) => ({ resourceId: block.resourceId, onDate })));
    }
    await markManyForRecheck(repositories, marks);
    return dates.length;
  }

  // Every calendar for the shop's days, not only the ones on offer: a withdrawn
  // calendar's Override would otherwise outlive the change that made it.
  const calendars =
    ref.kind === "CLOSURE"
      ? (await repositories.resources.listForBusiness(context.business.id)).map((resource) => resource.id)
      : [ref.resourceId];
  const removed = [];
  for (const date of dates) {
    removed.push(...(await repositories.dateOverrides.deleteBetween(calendars, date, date)));
  }
  await markManyForRecheck(
    repositories,
    removed.map((override) => ({ resourceId: override.resourceId, onDate: override.date })),
  );
  return dates.length;
};

export const changeService = ({ unitOfWork, clock }: { unitOfWork: UnitOfWork; clock: Clock }) => {
  const todayFor = (business: Business) => todayIn(clock.now(), business.timeZone);

  /** Who a plan would leave holding an appointment. */
  const stranded = async (
    repositories: Repositories,
    context: Context,
    plan: ChangePlan,
    checked: Checked,
  ): Promise<readonly Appointment[]> => {
    const targets = targetsOf(context, plan.scope);
    return writesOverrides(plan)
      ? strandedByHours(
          repositories,
          context.business,
          targets,
          checked.dates,
          plan.outcome === "OFF_ALL_DAY" ? [] : checked.hours,
          clock.now(),
        )
      : bookedInside(repositories, context.business.id, spansOf(context.business, targets, checked), clock.now());
  };

  /** The earlier changes these days already carry that writing this plan would overwrite. */
  const overwritten = async (
    repositories: Repositories,
    context: Context,
    plan: ChangePlan,
    checked: Checked,
    replacing: string | null,
  ): Promise<readonly CalendarChange[]> => {
    if (!writesOverrides(plan)) return [];
    const first = checked.dates[0]!;
    const last = checked.dates[checked.dates.length - 1]!;
    const dates = new Set(checked.dates);
    const targets = new Set(targetsOf(context, plan.scope));
    return (await changesAround(repositories, context, first, last)).filter(
      (change) =>
        change.id !== replacing &&
        !change.id.startsWith("blocks:") &&
        change.days.some((day) => dates.has(day.date)) &&
        (change.scope.kind === "BUSINESS" || targets.has(change.scope.resourceId)) &&
        mayRead(context, change),
    );
  };

  /** The plan, written. Shared by a new change and by the second half of an edit. */
  const write = async (
    session: Session,
    context: Context,
    plan: ChangePlan,
    checked: Checked,
    upcoming: Upcoming,
  ): Promise<ChangeResult> => {
    const { repositories } = session;
    const targets = targetsOf(context, plan.scope);
    const calledOff = upcoming === "CANCEL" ? await stranded(repositories, context, plan, checked) : [];
    await cancelAndTell(session, context.business, calledOff, clock.now());

    if (writesOverrides(plan)) {
      const hours = plan.outcome === "OFF_ALL_DAY" ? [] : checked.hours;
      await writeOverrides(repositories, context.business.id, targets, checked.dates, checked.note, hours);
      // ADR 0018: other hours can hand time back as easily as take it away. A
      // day off only takes it, so there is nothing for anybody waiting to hear.
      if (plan.outcome === "OTHER_HOURS") {
        await markManyForRecheck(
          repositories,
          targets.flatMap((resourceId) => checked.dates.map((onDate) => ({ resourceId, onDate }))),
        );
      }
    } else {
      // One decision, one group, across every calendar it stands on.
      const groupId = crypto.randomUUID();
      const spans = spansOf(context.business, targets, checked);
      for (const resourceId of targets) {
        await writeBlocks(
          repositories,
          context.business.id,
          resourceId,
          spans.filter((span) => span.resourceId === resourceId),
          checked.note ?? "",
          groupId,
        );
      }
    }
    return { days: checked.dates.length, calendars: targets.length, cancelled: calledOff.length };
  };

  return {
    /** The changes this caller may see between two dates: the business's, and their calendars'. */
    async list(actor: Actor, businessId: BusinessId, from: string, to: string): Promise<readonly CalendarChange[]> {
      return unitOfWork.run(actor, async ({ repositories }) => {
        const context = await contextOf(repositories, actor, businessId);
        const first = parseLocalDate(from);
        const last = parseLocalDate(to);
        if (compareLocalDate(last, first) < 0) throw validationFailed("The range ends before it starts");
        if (datesBetween(first, last).length > MAX_CHANGE_DAYS) {
          throw validationFailed(`A range covers at most ${MAX_CHANGE_DAYS} days`);
        }
        return (await changesAround(repositories, context, first, last)).filter((change) =>
          mayRead(context, change),
        );
      });
    },

    async get(actor: Actor, businessId: BusinessId, id: string): Promise<CalendarChange> {
      return unitOfWork.run(actor, async ({ repositories }) => {
        const context = await contextOf(repositories, actor, businessId);
        const change = await findChange(repositories, context, id);
        if (!mayRead(context, change)) throw notFound("Change", id);
        return change;
      });
    },

    /**
     * What a plan would do, before anything is written: who it strands, by
     * name, and what it would write over. The outcome may still be unanswered,
     * in which case only the usual hours come back.
     */
    async preview(
      actor: Actor,
      businessId: BusinessId,
      plan: Omit<ChangePlan, "outcome" | "note"> & { outcome: ChangeOutcome | null },
      replacing: string | null,
    ): Promise<ChangePreview> {
      return unitOfWork.run(actor, async ({ repositories }) => {
        const context = await contextOf(repositories, actor, businessId);
        authorize(context, plan.scope);
        if (replacing !== null) authorize(context, (await findChange(repositories, context, replacing)).scope);
        const targets = targetsOf(context, plan.scope);
        const first = parseLocalDate(plan.fromDate);
        const usual = await usualHours(repositories, targets, first);
        if (plan.outcome === null) {
          const days = datesBetween(first, parseLocalDate(plan.toDate)).length;
          return { days, calendars: targets.length, appointments: [], replaces: [], usual, sameAsUsual: false };
        }
        const full = { ...plan, outcome: plan.outcome, note: null };
        const checked = check(full, todayFor(context.business));
        return {
          days: checked.dates.length,
          calendars: targets.length,
          appointments: await namedFor(repositories, [...(await stranded(repositories, context, full, checked))]),
          replaces: await overwritten(repositories, context, full, checked, replacing),
          usual,
          sameAsUsual: full.outcome === "OTHER_HOURS" && (await keepsTheUsual(repositories, targets, checked.dates, checked.hours)),
        };
      });
    },

    /**
     * The change, made — or, given the one it replaces, the edit: the old one's
     * days from today on are removed and the new one written in the same
     * transaction, so there is never a moment with both versions or neither.
     */
    async apply(
      actor: Actor,
      businessId: BusinessId,
      plan: ChangePlan,
      upcoming: Upcoming,
      replacing: string | null,
    ): Promise<ChangeResult> {
      return unitOfWork.run(actor, async (session) => {
        const context = await contextOf(session.repositories, actor, businessId);
        authorize(context, plan.scope);
        const today = todayFor(context.business);
        const checked = check(plan, today);
        // Other hours that are the usual ones change nothing: a day back to its
        // usual hours is a change removed, not one written.
        if (plan.outcome === "OTHER_HOURS" && (await keepsTheUsual(session.repositories, targetsOf(context, plan.scope), checked.dates, checked.hours))) {
          throw validationFailed("Those are the usual hours: nothing would change");
        }
        if (replacing !== null) {
          const old = await findChange(session.repositories, context, replacing);
          authorize(context, old.scope);
          // What has already happened stays as it was lived.
          const ahead = old.days.map((day) => day.date).filter((date) => compareLocalDate(date, today) >= 0);
          await removeDays(session.repositories, context, old, ahead);
        }
        return write(session, context, plan, checked, upcoming);
      });
    },

    /** A change given back, whole or for one of its days. */
    async remove(actor: Actor, businessId: BusinessId, id: string, onDate: string | null): Promise<number> {
      return unitOfWork.run(actor, async ({ repositories }) => {
        const context = await contextOf(repositories, actor, businessId);
        const change = await findChange(repositories, context, id);
        if (!mayRead(context, change)) throw notFound("Change", id);
        authorize(context, change.scope);
        const all = change.days.map((day) => day.date);
        if (onDate === null) return removeDays(repositories, context, change, all);
        const date = parseLocalDate(onDate);
        if (!all.includes(date)) throw validationFailed("That day is not part of this change");
        return removeDays(repositories, context, change, [date]);
      });
    },
  };
};
