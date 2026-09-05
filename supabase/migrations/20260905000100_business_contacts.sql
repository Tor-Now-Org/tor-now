-- Where else a business can be reached.
--
-- Two facts a Business already has and the system had nowhere to keep: the
-- Instagram it posts its work to, and the WhatsApp it answers on — which is
-- often, but not always, the number it takes calls on. Both optional: a
-- Business with neither is complete.
--
-- The handle is stored bare, without the @ or a URL. What Instagram considers
-- a handle is theirs to define and ours to compose a link from; storing a URL
-- would let two rows disagree about the same account, and storing "@name"
-- would put punctuation in the data to be stripped at every use.
alter table business
  add column if not exists instagram text,
  add column if not exists whatsapp  text;

comment on column business.instagram is
  'Instagram handle, bare: no @, no URL. The link is composed on the way out.';
comment on column business.whatsapp is
  'The number this business answers WhatsApp on, E.164. Often the same as phone, deliberately separate: many businesses publish one number for calls and another for messages.';

alter table business
  add constraint business_instagram_handle
    check (instagram is null or instagram ~ '^[A-Za-z0-9._]{1,30}$'),
  add constraint business_whatsapp_e164
    check (whatsapp is null or whatsapp ~ '^\+[1-9][0-9]{7,14}$');
