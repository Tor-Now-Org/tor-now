import {
  notFound,
  type BusinessId,
  type MembershipRole,
  type UserId,
} from "@tor-now/domain";
import { SEARCH } from "../../config.ts";
import type {
  AdministratorAllowlistRepository,
  BusinessPhotoRepository,
  BusinessRepository,
  BusinessSearchResult,
  MembershipRepository,
  Page,
  UserRepository,
} from "../../ports/repositories.ts";
import type { Transaction } from "./client.ts";
import {
  toBusiness,
  toBusinessPhoto,
  toMembership,
  toUser,
  type Row,
} from "./mappers.ts";

const one = <T>(rows: readonly Row[], map: (row: Row) => T, entity: string): T => {
  const row = rows[0];
  if (row === undefined) throw notFound(entity);
  return map(row);
};

export const userRepository = (tx: Transaction): UserRepository => ({
  async findById(id) {
    const rows = await tx<Row[]>`
      select * from app_user where id = ${id} and deleted_at is null`;
    const row = rows[0];
    return row === undefined ? null : toUser(row);
  },

  async findByPhone(phone) {
    // Deleted rows are returned here on purpose: ADR 0008 keeps the phone, and
    // the sign-in path has to be able to tell "deleted" from "unknown".
    const rows = await tx<Row[]>`select * from app_user where phone = ${phone}`;
    const row = rows[0];
    return row === undefined ? null : toUser(row);
  },

  async create({ phone, givenName, familyName, birthDate }) {
    const rows = await tx<Row[]>`
      insert into app_user (phone, given_name, family_name, birth_date)
      values (${phone}, ${givenName}, ${familyName}, ${birthDate})
      returning *`;
    return one(rows, toUser, "User");
  },

  async update(id, changes) {
    const rows = await tx<Row[]>`
      update app_user set
        given_name = coalesce(${changes.givenName ?? null}, given_name),
        family_name = ${changes.familyName === undefined ? tx`family_name` : changes.familyName},
        birth_date = ${changes.birthDate === undefined ? tx`birth_date` : changes.birthDate}
      where id = ${id} and deleted_at is null
      returning *`;
    return one(rows, toUser, "User");
  },

  async softDelete(id) {
    const rows = await tx<Row[]>`
      update app_user set deleted_at = now()
      where id = ${id} and deleted_at is null returning *`;
    return one(rows, toUser, "User");
  },

  async restore(id) {
    const rows = await tx<Row[]>`
      update app_user set deleted_at = null where id = ${id} returning *`;
    return one(rows, toUser, "User");
  },

  async anonymise(id) {
    // The clearing itself lives in app.anonymise_user, so the exact set of
    // fields erased is stated once, next to the constraints that permit it.
    await tx`select app.anonymise_user(${id})`;
    const rows = await tx<Row[]>`select * from app_user where id = ${id}`;
    return one(rows, toUser, "User");
  },

  async setAdministrator(id, isAdministrator) {
    const rows = await tx<Row[]>`
      update app_user set is_administrator = ${isAdministrator}
      where id = ${id} returning *`;
    return one(rows, toUser, "User");
  },

  async list(page: Page, query) {
    const rows = await tx<Row[]>`
      select * from app_user
      where ${
        query === null
          ? tx`true`
          : tx`(given_name ilike ${"%" + query + "%"}
                or coalesce(family_name, '') ilike ${"%" + query + "%"}
                or phone like ${"%" + query + "%"})`
      }
      order by created_at desc
      limit ${page.limit} offset ${page.offset}`;
    return rows.map(toUser);
  },
});

export const businessRepository = (tx: Transaction): BusinessRepository => ({
  async findById(id) {
    const rows = await tx<Row[]>`select * from business where id = ${id}`;
    const row = rows[0];
    return row === undefined ? null : toBusiness(row);
  },

  /**
   * ADR 0011: trigram similarity, with a boost for prefix matches so an exact
   * beginning outranks a merely similar middle. Character-based, so it behaves
   * the same in Hebrew and English.
   */
  async search(query): Promise<readonly BusinessSearchResult[]> {
    // pg_trgm lives in `extensions`, not `public` — an extension does not
    // belong in the schema PostgREST exposes — so its function and operator are
    // schema-qualified rather than left to the connection's search_path.
    const rows = await tx<Row[]>`
      select *,
             extensions.similarity(name, ${query})
               + case when name ilike ${query + "%"} then ${SEARCH.prefixBoost}::real else 0 end
             as score
      from business
      where active
        and (name operator(extensions.%) ${query} or name ilike ${"%" + query + "%"})
      order by score desc, name asc
      limit ${SEARCH.maxResults}`;
    return rows.map((row) => ({
      business: toBusiness(row),
      score: Number(row["score"]),
    }));
  },

  async create(business) {
    const rows = await tx<Row[]>`
      insert into business (name, phone, time_zone, description, address)
      values (${business.name}, ${business.phone}, ${business.timeZone},
              ${business.description}, ${business.address})
      returning *`;
    return one(rows, toBusiness, "Business");
  },

  async update(id, changes) {
    const rows = await tx<Row[]>`
      update business set
        name = coalesce(${changes.name ?? null}, name),
        phone = coalesce(${changes.phone ?? null}, phone),
        time_zone = coalesce(${changes.timeZone ?? null}, time_zone),
        description = ${changes.description === undefined ? tx`description` : changes.description},
        address = ${changes.address === undefined ? tx`address` : changes.address},
        instagram = ${changes.instagram === undefined ? tx`instagram` : changes.instagram},
        whatsapp = ${changes.whatsapp === undefined ? tx`whatsapp` : changes.whatsapp},
        default_buffer_minutes = coalesce(${changes.defaultBufferMinutes ?? null}, default_buffer_minutes),
        minimum_notice_minutes = coalesce(${changes.minimumNoticeMinutes ?? null}, minimum_notice_minutes),
        booking_horizon_days = coalesce(${changes.bookingHorizonDays ?? null}, booking_horizon_days),
        cancellation_window_hours = coalesce(${changes.cancellationWindowHours ?? null}, cancellation_window_hours)
      where id = ${id}
      returning *`;
    return one(rows, toBusiness, "Business");
  },

  async setActive(id, active) {
    const rows = await tx<Row[]>`
      update business set active = ${active} where id = ${id} returning *`;
    return one(rows, toBusiness, "Business");
  },

  async list(page, query) {
    const rows = await tx<Row[]>`
      select * from business
      where ${query === null ? tx`true` : tx`name ilike ${"%" + query + "%"}`}
      order by created_at desc
      limit ${page.limit} offset ${page.offset}`;
    return rows.map(toBusiness);
  },
});

export const membershipRepository = (tx: Transaction): MembershipRepository => ({
  async find(userId, businessId) {
    const rows = await tx<Row[]>`
      select * from membership
      where user_id = ${userId} and business_id = ${businessId}`;
    const row = rows[0];
    return row === undefined ? null : toMembership(row);
  },

  async listForUser(userId: UserId) {
    const rows = await tx<Row[]>`
      select * from membership where user_id = ${userId} order by created_at`;
    return rows.map(toMembership);
  },

  async listForBusiness(businessId: BusinessId, role: MembershipRole) {
    const rows = await tx<Row[]>`
      select * from membership
      where business_id = ${businessId} and role = ${role}
      order by created_at desc`;
    return rows.map(toMembership);
  },

  async create(userId, businessId, role) {
    const rows = await tx<Row[]>`
      insert into membership (user_id, business_id, role)
      values (${userId}, ${businessId}, ${role})
      returning *`;
    return one(rows, toMembership, "Membership");
  },

  /**
   * Booking makes the customer relationship, and a customer who books twice
   * must not create a second one. The unique pair constraint settles the race
   * between two concurrent first bookings.
   *
   * `do nothing` rather than a no-op `do update`: a role is granted or
   * removed, never edited in place. It also means an owner booking at their
   * own business keeps the OWNER role rather than being demoted by their own
   * booking — and that a blocked customer re-booking does not clear the block.
   */
  async ensureCustomer(userId, businessId) {
    const inserted = await tx<Row[]>`
      insert into membership (user_id, business_id, role)
      values (${userId}, ${businessId}, 'CUSTOMER')
      on conflict (user_id, business_id) do nothing
      returning *`;
    const created = inserted[0];
    if (created !== undefined) return toMembership(created);

    const existing = await tx<Row[]>`
      select * from membership
      where user_id = ${userId} and business_id = ${businessId}`;
    return one(existing, toMembership, "Membership");
  },

  async setBlocked(userId, businessId, blockedAt) {
    const rows = await tx<Row[]>`
      update membership
      set blocked_at = ${blockedAt === null ? null : new Date(blockedAt)}
      where user_id = ${userId} and business_id = ${businessId}
      returning *`;
    return one(rows, toMembership, "Membership");
  },
});

export const administratorAllowlistRepository = (
  tx: Transaction,
): AdministratorAllowlistRepository => ({
  async contains(phone) {
    const rows = await tx<Row[]>`
      select 1 from administrator_allowlist where phone = ${phone}`;
    return rows.length > 0;
  },

  async list() {
    const rows = await tx<Row[]>`
      select phone, note from administrator_allowlist order by added_at`;
    return rows.map((row) => ({
      phone: String(row["phone"]),
      note: row["note"] === null ? null : String(row["note"] as string),
    }));
  },

  async add(phone, note, addedBy) {
    await tx`
      insert into administrator_allowlist (phone, note, added_by)
      values (${phone}, ${note}, ${addedBy})
      on conflict (phone) do update set note = excluded.note`;
  },

  async remove(phone) {
    await tx`delete from administrator_allowlist where phone = ${phone}`;
  },
});

/**
 * The record of a photo, not its bytes. Which slot a row claims is the whole of
 * the "one cover, at most three others" rule, and the database refuses a second
 * row in a taken slot — so a race between two uploads ends as a unique
 * violation rather than as a fifth photo.
 */
export const businessPhotoRepository = (
  tx: Transaction,
): BusinessPhotoRepository => ({
  async listForBusiness(businessId) {
    const rows = await tx<Row[]>`
      select * from business_photo
      where business_id = ${businessId}
      order by position`;
    return rows.map(toBusinessPhoto);
  },

  async findById(id) {
    const rows = await tx<Row[]>`select * from business_photo where id = ${id}`;
    const row = rows[0];
    return row === undefined ? null : toBusinessPhoto(row);
  },

  async create({ businessId, slot, storagePath, contentType, byteSize }) {
    const rows = await tx<Row[]>`
      insert into business_photo
        (business_id, position, storage_path, content_type, byte_size)
      values (${businessId}, ${slot}, ${storagePath}, ${contentType}, ${byteSize})
      returning *`;
    return one(rows, toBusinessPhoto, "BusinessPhoto");
  },

  async delete(id) {
    await tx`delete from business_photo where id = ${id}`;
  },
});
