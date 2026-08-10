import type { NeonQueryFunction } from "@neondatabase/serverless";
import { materializeContextDates } from "./context-materialization";

type GoogleCalendarCredentials = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
};

type GoogleCalendarEvent = {
  id?: string;
  status?: string;
  summary?: string;
  eventType?: string;
  transparency?: string;
  recurringEventId?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  attendees?: Array<{ self?: boolean; responseStatus?: string }>;
};

type GoogleEventsPage = {
  items?: GoogleCalendarEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
};

type CalendarObservationRow = {
  observation_id: string;
  operation: "upsert" | "delete";
  metric_key: string;
  observed_start: string | null;
  observed_end: string | null;
  numeric_value: number | null;
  unit: string;
  text_value: string | null;
  metadata_json: Record<string, string | number | boolean>;
};

export type GoogleCalendarSyncResult = {
  changedEvents: number;
  fullSync: boolean;
};

export async function syncGoogleCalendar(
  sql: NeonQueryFunction<boolean, boolean>,
  ownerId: string,
  timeZone: string,
  credentials: GoogleCalendarCredentials,
): Promise<GoogleCalendarSyncResult> {
  const accessToken = await refreshAccessToken(credentials);
  const connectionResult = await sql`SELECT sync_token AS "syncToken"
    FROM google_calendar_connections WHERE owner_id = ${ownerId}`;
  const connectionRows = connectionResult as unknown as Array<{ syncToken: string | null }>;
  let syncToken = connectionRows[0]?.syncToken ?? null;
  let fullSync = !syncToken;
  let pageToken: string | null = null;
  let nextSyncToken: string | null = null;
  const events: GoogleCalendarEvent[] = [];

  for (;;) {
    const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    url.searchParams.set("maxResults", "2500");
    url.searchParams.set("showDeleted", "true");
    url.searchParams.set("singleEvents", "true");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    if (syncToken) {
      url.searchParams.set("syncToken", syncToken);
    } else {
      const timeMin = new Date();
      timeMin.setUTCDate(timeMin.getUTCDate() - 120);
      url.searchParams.set("timeMin", timeMin.toISOString());
    }

    const response = await fetch(url, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 410 && syncToken) {
      syncToken = null;
      fullSync = true;
      pageToken = null;
      events.length = 0;
      continue;
    }
    if (!response.ok) {
      throw new Error(`Google Calendar returned ${response.status}`);
    }
    const page = (await response.json()) as GoogleEventsPage;
    events.push(...(page.items ?? []));
    pageToken = page.nextPageToken ?? null;
    nextSyncToken = page.nextSyncToken ?? nextSyncToken;
    if (!pageToken) break;
  }

  const eventIds = events.flatMap((event) => event.id ? [event.id] : []);
  const existingResult = eventIds.length === 0
    ? []
    : await sql`SELECT observation_id AS id, observed_start AS "observedStart",
                       observed_end AS "observedEnd"
        FROM context_observations
        WHERE owner_id = ${ownerId} AND source_system = 'google_calendar'
          AND observation_id IN (
            SELECT jsonb_array_elements_text(${JSON.stringify(eventIds)}::jsonb)
          )`;
  const affectedDates = (existingResult as unknown as Array<{
    observedStart: Date | null;
    observedEnd: Date | null;
  }>).flatMap((row) => [row.observedStart, row.observedEnd].flatMap((date) => date ? [date] : []));

  const rows = events.flatMap((event) => normalizeEvent(event, affectedDates));
  if (rows.length > 0) {
    await sql`WITH incoming AS (
        SELECT * FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS entry(
          observation_id text, operation text, metric_key text,
          observed_start timestamptz, observed_end timestamptz,
          numeric_value double precision, unit text, text_value text, metadata_json jsonb
        )
      )
      INSERT INTO context_observations (
        owner_id, device_id, source_system, observation_id, operation, metric_key,
        observed_start, observed_end, numeric_value, unit, text_value, metadata_json
      )
      SELECT ${ownerId}, 'server-calendar', 'google_calendar', observation_id, operation,
             metric_key, observed_start, observed_end, numeric_value, unit, text_value, metadata_json
      FROM incoming
      ON CONFLICT (owner_id, device_id, source_system, observation_id) DO UPDATE SET
        operation = EXCLUDED.operation,
        metric_key = EXCLUDED.metric_key,
        observed_start = COALESCE(EXCLUDED.observed_start, context_observations.observed_start),
        observed_end = COALESCE(EXCLUDED.observed_end, context_observations.observed_end),
        numeric_value = EXCLUDED.numeric_value,
        unit = EXCLUDED.unit,
        text_value = EXCLUDED.text_value,
        metadata_json = EXCLUDED.metadata_json,
        received_at = now()`;
  }

  await sql`INSERT INTO google_calendar_connections (
      owner_id, sync_token, token_updated_at, last_synced_at, last_error
    ) VALUES (${ownerId}, ${nextSyncToken}, now(), now(), NULL)
    ON CONFLICT (owner_id) DO UPDATE SET
      sync_token = COALESCE(EXCLUDED.sync_token, google_calendar_connections.sync_token),
      token_updated_at = now(),
      last_synced_at = now(),
      last_error = NULL`;

  if (affectedDates.length > 0) {
    const dates = affectedDates.map((date) => localDate(date, timeZone));
    const from = dates.reduce((minimum, value) => value < minimum ? value : minimum);
    const through = dates.reduce((maximum, value) => value > maximum ? value : maximum);
    await materializeContextDates(sql, ownerId, timeZone, from, through);
  }
  return { changedEvents: rows.length, fullSync };
}

async function refreshAccessToken(credentials: GoogleCalendarCredentials): Promise<string> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Google OAuth returned ${response.status}`);
  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) throw new Error("Google OAuth response did not include an access token");
  return payload.access_token;
}

function normalizeEvent(
  event: GoogleCalendarEvent,
  affectedDates: Date[],
): CalendarObservationRow[] {
  if (!event.id) return [];
  const start = parseGoogleDate(event.start);
  const end = parseGoogleDate(event.end);
  if (start) affectedDates.push(start);
  if (end) affectedDates.push(end);
  if (event.status === "cancelled") {
    return [{
      observation_id: event.id,
      operation: "delete",
      metric_key: "calendar.event_minutes",
      observed_start: start?.toISOString() ?? null,
      observed_end: end?.toISOString() ?? null,
      numeric_value: null,
      unit: "min",
      text_value: null,
      metadata_json: { provider: "google_calendar" },
    }];
  }
  if (!start || !end || end <= start) return [];
  const self = event.attendees?.find((attendee) => attendee.self);
  return [{
    observation_id: event.id,
    operation: "upsert",
    metric_key: "calendar.event_minutes",
    observed_start: start.toISOString(),
    observed_end: end.toISOString(),
    numeric_value: (end.getTime() - start.getTime()) / 60_000,
    unit: "min",
    text_value: event.summary ?? null,
    metadata_json: {
      aggregation: "sum",
      provider: "google_calendar",
      allDay: Boolean(event.start?.date),
      eventType: event.eventType ?? "default",
      transparency: event.transparency ?? "opaque",
      recurring: Boolean(event.recurringEventId),
      attendeeCount: event.attendees?.length ?? 0,
      selfResponseStatus: self?.responseStatus ?? "organizer_or_unknown",
    },
  }];
}

function parseGoogleDate(value: GoogleCalendarEvent["start"]): Date | null {
  const text = value?.dateTime ?? (value?.date ? `${value.date}T06:00:00.000Z` : null);
  if (!text) return null;
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date : null;
}

function localDate(value: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}
