package in.aravindline.ffreminders;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.List;

/** Shows the reminders and books the next alarm (inexact, within 10 minutes, so no special alarm permission is needed). */
final class Notify {
    static final String CHANNEL = "reminders";

    static void ensureChannel(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Reminders", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Daily entries, month-end update, renewals and card due dates");
            nm.createNotificationChannel(ch);
        }
    }
    static int notifId(Item i) { return 1000 + (i.id.hashCode() & 0xFFFF); }

    static PendingIntent openApp(Context c) {
        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse(Store.URL)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(c, 2, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void show(Context c, Item i) {
        ensureChannel(c);
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (!nm.areNotificationsEnabled()) return;
        Intent done = new Intent(c, DoneReceiver.class).putExtra("id", i.id);
        PendingIntent donePi = PendingIntent.getBroadcast(c, notifId(i), done, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String text = Item.DAILY.equals(i.repeat) ? "Tap to open Family Finance. Tick Done when it's in." : i.statusText(LocalDate.now()) + ". Tap to open Family Finance.";
        Notification n = new Notification.Builder(c, CHANNEL)
                .setSmallIcon(R.drawable.ic_notify)
                .setContentTitle(i.name)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setContentIntent(openApp(c))
                .addAction(new Notification.Action.Builder(null, "Done", donePi).build())
                .setAutoCancel(true)
                .setCategory(Notification.CATEGORY_REMINDER)
                .build();
        nm.notify(notifId(i), n);
    }
    static void cancel(Context c, Item i) { c.getSystemService(NotificationManager.class).cancel(notifId(i)); }

    /** Shows whatever is due now and not shown today, then books the next alarm. */
    static void run(Context c) {
        List<Item> l = Store.load(c);
        LocalDateTime now = LocalDateTime.now();
        boolean changed = false;
        for (Item i : l) if (i.showNow(now)) { show(c, i); i.notified = now.toLocalDate().toString(); changed = true; }
        if (changed) Store.save(c, l);
        schedule(c, l);
    }

    static PendingIntent alarmIntent(Context c) {
        return PendingIntent.getBroadcast(c, 1, new Intent(c, AlarmReceiver.class), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    static void schedule(Context c, List<Item> l) {
        AlarmManager am = c.getSystemService(AlarmManager.class);
        PendingIntent pi = alarmIntent(c);
        am.cancel(pi);
        LocalDateTime now = LocalDateTime.now(), next = null;
        for (Item i : l) { LocalDateTime t = i.nextAlarm(now); if (t != null && (next == null || t.isBefore(next))) next = t; }
        if (next == null) return;
        long at = next.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
        am.setWindow(AlarmManager.RTC_WAKEUP, at, 10 * 60 * 1000L, pi);
    }
}
