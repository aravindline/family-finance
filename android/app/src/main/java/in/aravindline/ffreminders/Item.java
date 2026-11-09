package in.aravindline.ffreminders;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.format.TextStyle;
import java.util.Locale;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * One reminder on the checklist. Plain Java (no Android calls) so the date rules can be tested on a laptop.
 *
 * Repeat:
 *  DAILY   - every day at the time.
 *  MONTHLY - every month from day `from` to day `to` (1-31; a short month uses its last day), starting `before` days early.
 *  YEARLY  - every year on `month`/`day`, starting `before` days early.
 * Ticking closes the current turn (that day, that month's run, that year's date) until the next one starts.
 */
final class Item {
    static final String DAILY = "daily", MONTHLY = "monthly", YEARLY = "yearly";
    String id, name, repeat = DAILY;
    int hour = 20, minute = 45, from = 1, to = 1, month = 1, day = 1, before = 0;
    boolean on = true;
    String done = "";      // key of the turn that was ticked (the turn's last day, yyyy-mm-dd)
    String notified = "";  // the day a notification was last shown (yyyy-mm-dd), so it shows once a day

    /** Last day of the turn that is running today or comes next (today or later). */
    LocalDate turnEnd(LocalDate today) {
        switch (repeat) {
            case MONTHLY: {
                LocalDate end = clampDay(today.withDayOfMonth(1), Math.max(from, to));
                if (end.isBefore(today)) end = clampDay(today.withDayOfMonth(1).plusMonths(1), Math.max(from, to));
                return end;
            }
            case YEARLY: {
                LocalDate d = yearDate(today.getYear());
                return d.isBefore(today) ? yearDate(today.getYear() + 1) : d;
            }
            default: return today;
        }
    }
    /** First day reminders start for the turn ending on `end`. */
    LocalDate turnStart(LocalDate end) {
        switch (repeat) {
            case MONTHLY: return clampDay(end.withDayOfMonth(1), Math.min(from, to)).minusDays(Math.max(0, before));
            case YEARLY: return end.minusDays(Math.max(0, before));
            default: return end;
        }
    }
    private static LocalDate clampDay(LocalDate firstOfMonth, int d) { return firstOfMonth.withDayOfMonth(Math.min(Math.max(d, 1), firstOfMonth.lengthOfMonth())); }
    private LocalDate yearDate(int y) { LocalDate f = LocalDate.of(y, Math.min(Math.max(month, 1), 12), 1); return clampDay(f, day); }

    String turnKey(LocalDate today) { return turnEnd(today).toString(); }
    /** Due today: inside the turn's days and not ticked. */
    boolean dueOn(LocalDate today) { if (!on) return false; LocalDate end = turnEnd(today); return !today.isBefore(turnStart(end)) && !done.equals(end.toString()); }
    boolean tickedNow(LocalDate today) { return done.equals(turnKey(today)); }
    void tick(LocalDate today, boolean v) { done = v ? turnKey(today) : ""; }

    /** Next moment a notification should show, after `now`; null if switched off. */
    LocalDateTime nextAlarm(LocalDateTime now) {
        if (!on) return null;
        LocalTime t = LocalTime.of(hour, minute);
        for (int i = 0; i < 800; i++) {
            LocalDate d = now.toLocalDate().plusDays(i);
            LocalDateTime at = d.atTime(t);
            if (!at.isAfter(now)) continue;
            if (dueOn(d) && !notified.equals(d.toString())) return at;
        }
        return null;
    }
    /** Should show now: due today, its time has come, not shown yet today. */
    boolean showNow(LocalDateTime now) {
        LocalDate d = now.toLocalDate();
        return dueOn(d) && !now.toLocalTime().isBefore(LocalTime.of(hour, minute)) && !notified.equals(d.toString());
    }

    String timeText() { int h = hour % 12 == 0 ? 12 : hour % 12; return String.format(Locale.ENGLISH, "%d:%02d %s", h, minute, hour < 12 ? "am" : "pm"); }
    String ruleText() {
        switch (repeat) {
            case MONTHLY: {
                String days = from == to ? "on day " + from : "days " + Math.min(from, to) + " to " + Math.max(from, to);
                return "Every month, " + days + " · " + timeText() + (before > 0 ? " · from " + before + (before == 1 ? " day" : " days") + " before" : "");
            }
            case YEARLY: return "Every year, " + day + " " + java.time.Month.of(Math.min(Math.max(month, 1), 12)).getDisplayName(TextStyle.SHORT, Locale.ENGLISH) + " · " + timeText()
                    + (before > 0 ? " · from " + before + (before == 1 ? " day" : " days") + " before" : "");
            default: return "Every day · " + timeText();
        }
    }
    /** Short status for the list: "Due now", "Done for today", "Next: 1 Dec". */
    String statusText(LocalDate today) {
        if (!on) return "Switched off";
        LocalDate end = turnEnd(today);
        if (done.equals(end.toString())) {
            String what = DAILY.equals(repeat) ? "today" : MONTHLY.equals(repeat) ? "this month" : "this year";
            return "Done for " + what;
        }
        LocalDate start = turnStart(end);
        if (!today.isBefore(start)) return DAILY.equals(repeat) ? "Due today" : "Due now · until " + end.getDayOfMonth() + " " + end.getMonth().getDisplayName(TextStyle.SHORT, Locale.ENGLISH);
        return "Next: " + start.getDayOfMonth() + " " + start.getMonth().getDisplayName(TextStyle.SHORT, Locale.ENGLISH);
    }

    JSONObject toJson() throws JSONException {
        return new JSONObject().put("id", id).put("name", name).put("repeat", repeat).put("hour", hour).put("minute", minute)
                .put("from", from).put("to", to).put("month", month).put("day", day).put("before", before).put("on", on)
                .put("done", done).put("notified", notified);
    }
    static Item fromJson(JSONObject o) {
        Item i = new Item();
        i.id = o.optString("id"); i.name = o.optString("name"); i.repeat = o.optString("repeat", DAILY);
        i.hour = o.optInt("hour", 20); i.minute = o.optInt("minute", 45); i.from = o.optInt("from", 1); i.to = o.optInt("to", 1);
        i.month = o.optInt("month", 1); i.day = o.optInt("day", 1); i.before = o.optInt("before", 0); i.on = o.optBoolean("on", true);
        i.done = o.optString("done", ""); i.notified = o.optString("notified", "");
        return i;
    }
    static Item of(String id, String name, String repeat, int hour, int minute) { Item i = new Item(); i.id = id; i.name = name; i.repeat = repeat; i.hour = hour; i.minute = minute; return i; }
}
